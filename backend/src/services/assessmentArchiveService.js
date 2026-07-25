/**
 * assessmentArchiveService — ADR-002: archive every assessment session as one JSON bundle in
 * the owner's Azure Blob storage, for review-without-copy-paste and a from-day-one scoring
 * corpus. Sweep idiom mirrors deadlineSweep: in-process interval, batch-limited, idempotent.
 *
 * The first enabled sweep IS the backfill: every historical terminal submission still has
 * archived_at NULL (migration 097), so history drains oldest-first at SWEEP_BATCH per tick.
 *
 * OFF by default: requires ASSESSMENT_ARCHIVE_ENABLED=true AND a configured storageClient.
 * Bundles carry candidate_id (opaque UUID) but no candidate name/email; right-to-erasure
 * deletes the blobs (see portal.js delete-account).
 */
const { supabaseAdmin } = require('../config/supabase');
const storageClient = require('./storageClient');

const CONTAINER = () => process.env.ASSESSMENT_ARCHIVE_CONTAINER || 'assessment-archive';
const SWEEP_MS = () => {
  const min = Number(process.env.ARCHIVE_SWEEP_MINUTES);
  // Guard NaN/zero: setInterval(fn, NaN) clamps to ~1ms and would hammer the DB.
  return (Number.isFinite(min) && min >= 1 ? min : 15) * 60000;
};
const SWEEP_BATCH = 50;
// Only SETTLED sessions are archived. 'submitted' is deliberately NOT here: scoring flips it to
// 'scored'/'needs_review' asynchronously, and a bundle snapshotted in that window would freeze
// score-less (the sweep never revisits stamped rows — markStale() is the re-archive path).
const TERMINAL = ['scored', 'needs_review', 'expired'];

const enabled = () => process.env.ASSESSMENT_ARCHIVE_ENABLED === 'true' && storageClient.isConfigured();

const submissionBlobName = (ownerId, submissionId) => `tenants/${ownerId}/submissions/${submissionId}.json`;
const workSampleBlobName = (ownerId, workSampleId) => `tenants/${ownerId}/work-samples/${workSampleId}.json`;

// One self-contained record of everything that happened in a session. Also served live by
// GET /api/admin/assessments/:id/bundle, so keep it pure DB→JSON with no storage dependency.
async function buildBundle(submissionId) {
  const { data: sub, error } = await supabaseAdmin
    .from('work_sample_submissions')
    .select('id, work_sample_id, candidate_id, job_id, status, started_at, submitted_at, deadline_at, created_at, response_text, response_code, execution_result, test_results, input_hash')
    .eq('id', submissionId)
    .single();
  // PGRST116 = .single() found no row (genuinely absent) — anything else is a query failure.
  // Callers key off the "not found" phrasing to pick 404 vs 503.
  if (error && error.code !== 'PGRST116') throw new Error(`bundle query work_sample_submissions failed: ${error.message}`);
  if (!sub) throw new Error(`submission ${submissionId} not found`);

  const [ws, transcript, events, scores, direction] = await Promise.all([
    supabaseAdmin.from('work_samples')
      .select('id, owner_id, title, role_family, response_type, language, languages, duration_minutes, prompt_md, prompt_version, rubric, rubric_version, scoring_strategy, tests, baseline, starter_files, status, created_at, updated_at')
      .eq('id', sub.work_sample_id).single(),
    supabaseAdmin.from('ai_interactions')
      .select('seq, role, content, disposition, source, client_ts')
      .eq('submission_id', submissionId).order('seq', { ascending: true }),
    supabaseAdmin.from('submission_integrity_events')
      .select('*').eq('submission_id', submissionId).order('seq', { ascending: true }),
    supabaseAdmin.from('proof_scores')
      .select('*').eq('submission_id', submissionId).order('created_at', { ascending: true }),
    supabaseAdmin.from('ai_direction_scores')
      .select('*').eq('submission_id', submissionId).order('created_at', { ascending: true }),
  ]);

  // supabase-js resolves failures as {data:null, error} — it never throws. A transient error on
  // ANY part must fail the whole build (the sweep retries next tick): a silently degraded bundle
  // would be stamped archived_at and frozen forever, and a missing work_sample would mis-tenant
  // the blob where the erase hook can never find it. work_sample_id is NOT NULL + FK, so a
  // legitimately absent work sample cannot happen — null here always means a failed read.
  for (const [name, r] of [['work_samples', ws], ['ai_interactions', transcript], ['submission_integrity_events', events], ['proof_scores', scores], ['ai_direction_scores', direction]]) {
    if (r.error) throw new Error(`bundle query ${name} failed: ${r.error.message}`);
  }
  if (!ws.data) throw new Error(`work sample ${sub.work_sample_id} unreadable`);

  return {
    bundle_version: 1,
    built_at: new Date().toISOString(),
    submission: sub,
    work_sample: ws.data,
    ai_transcript: transcript.data || [],
    integrity_events: events.data || [],
    scores: scores.data || [],
    direction_scores: direction.data || [],
  };
}

// Archive one submission (bundle + its question). Caller stamps archived_at on success.
// buildBundle guarantees work_sample.owner_id — the blob can never land outside its tenant.
async function archiveSubmission(submissionId) {
  const bundle = await buildBundle(submissionId);
  const ownerId = bundle.work_sample.owner_id;
  await storageClient.putJson(CONTAINER(), submissionBlobName(ownerId, submissionId), bundle);
  await storageClient.putJson(CONTAINER(), workSampleBlobName(ownerId, bundle.work_sample.id), bundle.work_sample);
  return bundle;
}

// Re-archive trigger: new scores (or a human override) landed after the bundle was stamped.
// Clearing archived_at puts the row back in the sweep's working set; next tick overwrites the
// blob with the scored version. Best-effort by design — called from the scoring hot path, and it
// must survive environments where migration 097 isn't applied yet.
async function markStale(submissionId) {
  try {
    await supabaseAdmin.from('work_sample_submissions')
      .update({ archived_at: null }).eq('id', submissionId);
  } catch (e) {
    console.warn(`assessmentArchive markStale(${submissionId}) failed (non-blocking):`, e.message);
  }
}

async function runSweep() {
  if (!enabled()) return;
  try {
    await storageClient.ensureContainer(CONTAINER());
    const { data: due, error: dueErr } = await supabaseAdmin
      .from('work_sample_submissions')
      .select('id')
      .in('status', TERMINAL)
      .is('archived_at', null)
      .order('created_at', { ascending: true })
      .limit(SWEEP_BATCH);
    if (dueErr) {
      // Loudest case: migration 097 not applied yet (archived_at missing) — say so every tick
      // rather than silently archiving nothing.
      console.warn('assessmentArchive: pending-select failed (is migration 097 applied?):', dueErr.message);
      return;
    }
    for (const row of due || []) {
      try {
        await archiveSubmission(row.id);
        // Stamp AFTER a successful upload; a crash in between re-archives the same content
        // next tick (idempotent overwrite), never skips one.
        await supabaseAdmin
          .from('work_sample_submissions')
          .update({ archived_at: new Date().toISOString() })
          .eq('id', row.id)
          .is('archived_at', null);
      } catch (e) {
        console.warn(`assessmentArchive: submission ${row.id} failed (will retry next sweep):`, e.message);
      }
    }
  } catch (e) {
    console.warn('assessmentArchive sweep failed (non-blocking):', e.message);
  }
}

// Right-to-erasure: delete the candidate's bundles. Called by portal.js delete-account with
// paths collected BEFORE erase_candidate runs (afterwards the rows are gone). Gated on
// isConfigured(), NOT on the sweep flag: blobs uploaded while archiving was on must remain
// deletable after the owner pauses the sweep. Returns the entries that could NOT be deleted so
// the caller can surface them durably (founder erasure email) instead of orphaning silently.
async function deleteSubmissionArchives(entries) {
  const failed = [];
  if (!storageClient.isConfigured()) return entries || [];
  for (const { ownerId, submissionId } of entries || []) {
    try {
      await storageClient.deleteBlob(CONTAINER(), submissionBlobName(ownerId, submissionId));
    } catch (e) {
      console.warn(`assessmentArchive: erase of ${submissionId} blob failed:`, e.message);
      failed.push({ ownerId, submissionId });
    }
  }
  return failed;
}

let timer = null;
function start() {
  if (timer) return;
  if (process.env.ASSESSMENT_ARCHIVE_ENABLED !== 'true') return; // silent when off (flag idiom)
  if (!storageClient.isConfigured()) {
    console.warn('assessmentArchive: enabled but AZURE_STORAGE_CONNECTION_STRING is missing — inert.');
    return;
  }
  timer = setInterval(runSweep, SWEEP_MS());
  if (typeof timer.unref === 'function') timer.unref();
  runSweep(); // drain begins immediately on boot, not one interval later
  console.log(`assessmentArchive: sweeping every ${SWEEP_MS() / 60000}m into container "${CONTAINER()}"`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { buildBundle, archiveSubmission, runSweep, deleteSubmissionArchives, markStale, start, stop, enabled };
