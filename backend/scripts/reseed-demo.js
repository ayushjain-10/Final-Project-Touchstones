#!/usr/bin/env node
/**
 * reseed-demo.js — make the demo recruiter (demo@touchstones.ai) read like a REAL account to a
 * buyer, not a smoke-test dumping ground.
 *
 * WHAT IT DOES (idempotent, NON-destructive):
 *   1. ARCHIVES junk screens left by smoke/verify runs — the "Verification <hash>" screens (all
 *      100/100), "Smoke: add(a,b)", and "Backend (v3 smoke)". Archiving (status='archived') is the
 *      app's own delete semantics (proof.js DELETE archives too): it removes them from every
 *      recruiter list (.neq('status','archived')) and candidate view (.eq('status','published'))
 *      WITHOUT destroying the evidence chain, and it's trivially reversible.
 *   2. REVOKES the junk candidate-facing credentials tied to those screens (verified_credentials
 *      .revoked_at = now()), which the public /apply + get_credential path already hide.
 *   3. SEEDS 4 realistically-titled, scored screens with a believable score SPREAD (57–91) and
 *      real-looking rubric evidence, so the Dashboard shows range, not a wall of 100s. The existing
 *      good "[Demo] Senior Backend … 84/100" row (seedDemo.js) is the model and is left untouched.
 *
 * SAFETY: only rows OWNED BY the demo recruiter AND matching the junk patterns are touched, and
 * '[Demo]%' titles are always excluded. Writes are gated behind --apply; the default is a DRY RUN
 * that prints exactly what it would archive / revoke / seed and changes nothing.
 *
 *   node scripts/reseed-demo.js            # dry run (no writes) — prints the plan
 *   node scripts/reseed-demo.js --apply    # perform the reseed
 *
 * DO NOT run --apply against the shared dev DB without coordinating — it is meant to be batched
 * with a deploy.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in backend/.env'); process.exit(1); }
const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const APPLY = process.argv.includes('--apply');
const RECRUITER_EMAIL = 'demo@touchstones.ai';
const PW = process.env.DEMO_PASSWORD || 'TouchstonesDemo!2026';

// Demo candidates the seeded submissions are attributed to (round-robin, for a non-staged feel).
const CANDIDATES = [
  { email: 'candidate.demo@touchstones.ai', name: 'Jordan Lee' },
  { email: 'candidate.demo2@touchstones.ai', name: 'Priya Nair' },
];

// A junk title is smoke/verify detritus. '[Demo]%' is NEVER junk (that's the curated set).
function isJunkTitle(title) {
  const t = String(title || '');
  if (/^\[Demo\]/i.test(t)) return false;
  return (
    /^Verification\b/i.test(t) ||          // "Verification 9ff8f8da…" (Verify API smoke)
    /^Smoke\b/i.test(t) ||                  // "Smoke: add(a,b)"
    /\(v\d+\s*smoke\)/i.test(t) ||          // "Backend (v3 smoke)"
    /\badd\(a\s*,\s*b\)/i.test(t) ||        // the add(a,b) smoke task
    /^[0-9a-f]{6,}$/i.test(t.trim())        // bare-hash titles
  );
}

// The curated, realistic screens. Scores are set by per-criterion points; the spread is deliberate.
const SCREENS = [
  {
    title: 'Frontend — Accessible Data Table with Sorting',
    role_family: 'frontend', response_type: 'markdown', score: 91,
    prompt_md: 'Build an accessible, sortable data table component. **Keyboard navigation, ARIA, and correct sort semantics matter.** AI is allowed — use it well.',
    criteria: [
      { id: 'a11y', requirement: 'Keyboard + screen-reader accessible (ARIA sort, focus order)', pp: 40 },
      { id: 'correctness', requirement: 'Stable, correct multi-column sort', pp: 40 },
      { id: 'quality', requirement: 'Composable, no re-render thrash', pp: 20 },
    ],
    per_criterion: [
      { id: 'a11y', verdict: 'MET', awarded: 38, pp: 40, evidence: 'aria-sort toggles per column; roving tabindex on header cells; announced via aria-live.', explanation: 'Thorough, standards-correct accessibility.' },
      { id: 'correctness', verdict: 'MET', awarded: 37, pp: 40, evidence: 'Stable sort keyed on original index; handles mixed null/number/string.', explanation: 'Correct and defensive.' },
      { id: 'quality', verdict: 'MET', awarded: 16, pp: 20, evidence: 'Memoized comparator; header extracted to a pure component.', explanation: 'Clean; minor prop-drilling.' },
    ],
  },
  {
    title: 'Senior Backend — Fix a Flaky Rate Limiter',
    role_family: 'backend', response_type: 'markdown', score: 82,
    prompt_md: 'A token-bucket rate limiter intermittently lets bursts through under load. **Find the concurrency bug, fix it, and add a test that reproduces the burst.** AI is allowed.',
    criteria: [
      { id: 'root_cause', requirement: 'Identifies the read-modify-write race on the bucket', pp: 40 },
      { id: 'fix', requirement: 'Correct atomic fix (CAS / Lua / lock)', pp: 40 },
      { id: 'tests', requirement: 'Concurrent test reproducing the burst', pp: 20 },
    ],
    per_criterion: [
      { id: 'root_cause', verdict: 'MET', awarded: 36, pp: 40, evidence: 'Refill and decrement are separate round-trips; two callers both see capacity.', explanation: 'Nailed the non-atomic RMW race.' },
      { id: 'fix', verdict: 'MET', awarded: 33, pp: 40, evidence: 'Moved the check-and-decrement into a single Redis Lua script.', explanation: 'Correct atomic fix; alternatives noted.' },
      { id: 'tests', verdict: 'PARTIAL', awarded: 13, pp: 20, evidence: 'Spawns 50 concurrent requests, asserts <=N pass.', explanation: 'Good; flaky under CI timing, not pinned.' },
    ],
  },
  {
    title: 'Full-stack — Ship a Feature Slice (saved search filters)',
    role_family: 'fullstack', response_type: 'markdown', score: 69,
    prompt_md: 'Add "saved search filters": persist a user’s filter set and restore it. **End-to-end: schema, API, and UI state.** AI is allowed.',
    criteria: [
      { id: 'data', requirement: 'Sensible schema + migration (per-user, named)', pp: 35 },
      { id: 'api', requirement: 'CRUD API with authz + validation', pp: 35 },
      { id: 'ui', requirement: 'Restores state; handles empty/error', pp: 30 },
    ],
    per_criterion: [
      { id: 'data', verdict: 'MET', awarded: 27, pp: 35, evidence: 'saved_filters(user_id, name, query jsonb) with a unique (user_id,name).', explanation: 'Reasonable; no soft-delete considered.' },
      { id: 'api', verdict: 'PARTIAL', awarded: 22, pp: 35, evidence: 'CRUD present; ownership checked on read/delete but not on update.', explanation: 'Authz gap on update — flagged.' },
      { id: 'ui', verdict: 'PARTIAL', awarded: 20, pp: 30, evidence: 'Restores on load; no empty-state or error toast.', explanation: 'Happy-path only.' },
    ],
  },
  {
    title: 'Backend — Design an Idempotent Job Queue',
    role_family: 'backend', response_type: 'markdown', score: 57,
    prompt_md: 'Design a job queue that guarantees at-least-once with idempotent handlers. **Cover dedup, retries, and poison messages.** AI is allowed.',
    criteria: [
      { id: 'idempotency', requirement: 'Concrete dedup/idempotency key strategy', pp: 40 },
      { id: 'retries', requirement: 'Backoff + DLQ for poison messages', pp: 35 },
      { id: 'tradeoffs', requirement: 'Names real ordering/throughput tradeoffs', pp: 25 },
    ],
    per_criterion: [
      { id: 'idempotency', verdict: 'PARTIAL', awarded: 24, pp: 40, evidence: 'Proposes a processed_events table but leaves the claim/mutate ordering vague.', explanation: 'Right idea, under-specified.' },
      { id: 'retries', verdict: 'PARTIAL', awarded: 20, pp: 35, evidence: 'Exponential backoff mentioned; DLQ named but no threshold.', explanation: 'Partial.' },
      { id: 'tradeoffs', verdict: 'PARTIAL', awarded: 13, pp: 25, evidence: 'Notes FIFO-vs-throughput briefly.', explanation: 'Thin on tradeoffs.' },
    ],
  },
];

async function findUserId(email) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const u = data?.users?.find((x) => x.email === email);
    if (u) return u.id;
    if (!data || data.users.length < 200) break;
  }
  return null;
}

async function ensureCandidate({ email, name }) {
  let id = await findUserId(email);
  if (!id) {
    if (!APPLY) return `(would create ${email})`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { name } });
    if (error) throw new Error(`createUser ${email}: ${error.message}`);
    id = data.user.id;
    await admin.from('profiles').upsert(
      { id, email, first_name: name.split(' ')[0] || null, last_name: name.split(' ').slice(1).join(' ') || null },
      { onConflict: 'id' },
    );
  }
  return id;
}

function normalized(perCriterion) {
  const aw = perCriterion.reduce((s, c) => s + c.awarded, 0);
  const pp = perCriterion.reduce((s, c) => s + c.pp, 0);
  return { normalized_score: Math.round((aw / pp) * 100), raw_points_awarded: aw, raw_points_possible: pp };
}

async function main() {
  console.log(`reseed-demo → ${URL}  [${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}]\n`);

  const recruiterId = await findUserId(RECRUITER_EMAIL);
  if (!recruiterId) { console.error(`Demo recruiter ${RECRUITER_EMAIL} not found — run scripts/seedDemo.js first.`); process.exit(1); }
  console.log('recruiter:', recruiterId);

  // 1) ARCHIVE junk screens + REVOKE their credentials.
  const { data: owned, error: e0 } = await admin.from('work_samples')
    .select('id, title, status').eq('owner_id', recruiterId);
  if (e0) throw new Error('list work_samples: ' + e0.message);
  const junk = (owned || []).filter((w) => w.status !== 'archived' && isJunkTitle(w.title));
  console.log(`\nJunk screens to archive (${junk.length}):`);
  junk.forEach((w) => console.log('  -', w.title));

  if (junk.length) {
    const junkIds = junk.map((w) => w.id);
    const { data: junkSubs } = await admin.from('work_sample_submissions').select('id').in('work_sample_id', junkIds);
    const junkSubIds = (junkSubs || []).map((s) => s.id);
    if (APPLY) {
      if (junkSubIds.length) {
        await admin.from('verified_credentials').update({ revoked_at: new Date().toISOString() })
          .in('submission_id', junkSubIds).is('revoked_at', null);
      }
      await admin.from('work_samples').update({ status: 'archived', updated_at: new Date().toISOString() }).in('id', junkIds);
      console.log(`  → archived ${junkIds.length} screens; revoked credentials for ${junkSubIds.length} submissions.`);
    } else {
      console.log(`  → would archive ${junkIds.length} screens; would revoke credentials for ${junkSubIds.length} submissions.`);
    }
  }

  // 2) SEED the curated, realistic scored screens (idempotent by owner+title).
  const candidateIds = [];
  for (const c of CANDIDATES) candidateIds.push(await ensureCandidate(c));
  console.log('\nSeed screens (idempotent by owner+title):');

  for (let i = 0; i < SCREENS.length; i++) {
    const s = SCREENS[i];
    const { normalized_score, raw_points_awarded, raw_points_possible } = normalized(s.per_criterion);
    const per_criterion = s.per_criterion.map((c) => ({
      id: c.id, verdict: c.verdict, points_awarded: c.awarded, points_possible: c.pp, weight: 1,
      evidence_quote: c.evidence, explanation: c.explanation,
    }));
    console.log(`  - ${s.title}  → ${normalized_score}/100`);
    if (!APPLY) continue;

    // work_sample (upsert by owner+title)
    let { data: ws } = await admin.from('work_samples').select('id').eq('owner_id', recruiterId).eq('title', s.title).maybeSingle();
    if (!ws) {
      const { data, error } = await admin.from('work_samples').insert({
        owner_id: recruiterId, title: s.title, prompt_md: s.prompt_md,
        rubric: { criteria: s.criteria.map((c) => ({ id: c.id, requirement: c.requirement, points_possible: c.pp, weight: 1 })) },
        role_family: s.role_family, response_type: s.response_type, duration_minutes: 45,
        scoring_strategy: 'weighted_sum', status: 'published',
      }).select('id').single();
      if (error) throw new Error('work_sample ' + s.title + ': ' + error.message);
      ws = data;
    }

    // submission (idempotent by ws+candidate)
    const candidateId = candidateIds[i % candidateIds.length];
    const responseText = `Worked the "${s.title}" task end-to-end; reasoning and tradeoffs in the writeup.`;
    let { data: sub } = await admin.from('work_sample_submissions').select('id').eq('work_sample_id', ws.id).eq('candidate_id', candidateId).maybeSingle();
    if (!sub) {
      const { data, error } = await admin.from('work_sample_submissions').insert({
        work_sample_id: ws.id, candidate_id: candidateId, response_text: responseText,
        input_hash: crypto.createHash('sha256').update(responseText).digest('hex'),
        started_at: new Date(Date.now() - 42 * 60000).toISOString(), submitted_at: new Date().toISOString(), status: 'scored',
      }).select('id').single();
      if (error) throw new Error('submission ' + s.title + ': ' + error.message);
      sub = data;
    } else {
      await admin.from('work_sample_submissions').update({ status: 'scored' }).eq('id', sub.id);
    }

    // proof_score — INSERT-IF-ABSENT (never delete): proof_audit_log is immutable + ON DELETE CASCADE,
    // so once a score has an audit row it CANNOT be deleted. We only fill what's missing.
    let { data: existingScore } = await admin.from('proof_scores')
      .select('id').eq('submission_id', sub.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    let scoreId = existingScore?.id;
    if (!scoreId) {
      const { data: sc, error: scErr } = await admin.from('proof_scores').insert({
        submission_id: sub.id, rubric_version: 1, prompt_version: 1,
        model_id: 'claude-haiku-4-5', model_version: 'claude-haiku-4-5', scoring_method: 'llm',
        normalized_score, raw_points_awarded, raw_points_possible, threshold_applied: 60,
        outcome: normalized_score >= 60 ? 'advance' : 'reject',
        per_criterion, self_consistency_n: 3, score_variance: 1.4, injection_flag: false,
        overall_explanation: `Scored from the rubric in code: ${raw_points_awarded}/${raw_points_possible} points. Evidence is quoted per criterion.`,
      }).select('id').single();
      if (scErr) throw new Error('proof_score ' + s.title + ': ' + scErr.message);
      scoreId = sc.id;
    }

    // ── Backfill the result-card EVIDENCE (idempotent, insert-if-absent) so these submissions match
    //    the [Demo] model row: immutable audit record (fixes the audit.json 404), AI-direction score +
    //    transcript ("How they directed the AI"), and a handful of integrity events ("Integrity &
    //    activity"). Only touches these seeded-by-title submissions. ──
    const outcome = normalized_score >= 60 ? 'advance' : 'reject';
    const nowMs = Date.now();
    const tier = normalized_score >= 80 ? 'high' : (normalized_score >= 60 ? 'mid' : 'low');

    // 1) Immutable audit record → fixes GET /api/proof/scores/:id/audit.json (404 = missing row).
    const { data: existingAudit } = await admin.from('proof_audit_log').select('decision_id').eq('proof_score_id', scoreId).maybeSingle();
    if (!existingAudit) {
      const auditRow = {
        proof_score_id: scoreId, candidate_id: candidateId, job_id: null, work_sample_id: ws.id, assessment_version: 1,
        event_ts_start: new Date(nowMs - 3 * 60000).toISOString(), event_ts_end: new Date(nowMs - 2 * 60000).toISOString(),
        model_id: 'claude-haiku-4-5', model_version: 'claude-haiku-4-5', rubric_version: 1, prompt_version: 1,
        scoring_method: 'llm', input_hash: crypto.createHash('sha256').update(responseText).digest('hex'), input_ref: sub.id,
        overall_score: normalized_score, normalized_score, threshold_applied: 60, outcome,
        per_criterion, human_override: false, created_by: 'reseed-demo',
      };
      auditRow.row_hash = crypto.createHash('sha256').update(JSON.stringify(auditRow)).digest('hex');
      const { error: auErr } = await admin.from('proof_audit_log').insert(auditRow);
      if (auErr) throw new Error('audit ' + s.title + ': ' + auErr.message);
    }

    // 2) AI-interaction transcript (append-only; insert only if empty). Dispositions track the tier:
    //    stronger candidates catch + correct the AI (edited); weaker ones accept more readily.
    const { count: aiCount } = await admin.from('ai_interactions').select('id', { count: 'exact', head: true }).eq('submission_id', sub.id);
    if (!aiCount) {
      const reaction = tier === 'high'
        ? { content: `That skips an edge case for "${s.title}" — reorder so we validate inputs first, then handle the failure path.`, disposition: 'edited' }
        : tier === 'mid'
          ? { content: `Close, but tighten the error handling and add a regression test before I use it.`, disposition: 'edited' }
          : { content: `Looks reasonable — going with that.`, disposition: 'accepted' };
      const turns = [
        { role: 'user', content: `For "${s.title}", what's the cleanest approach and where might it break?`, disposition: null },
        { role: 'assistant', content: `Here's a first pass with the main structure and the key tradeoff called out.`, disposition: null },
        { role: 'user', content: reaction.content, disposition: reaction.disposition },
        { role: 'assistant', content: `Good catch — here's the corrected version addressing that.`, disposition: null },
      ];
      const rows = turns.map((t, k) => ({
        submission_id: sub.id, seq: k + 1, role: t.role, content: t.content, disposition: t.disposition,
        client_ts: new Date(nowMs - (turns.length - k) * 90000).toISOString(),
      }));
      const { error: aiErr } = await admin.from('ai_interactions').insert(rows);
      if (aiErr) throw new Error('ai_interactions ' + s.title + ': ' + aiErr.message);
    }

    // 3) AI-direction score (insert only if absent). Tracks the main score, clamped 55–90.
    const { data: existingDir } = await admin.from('ai_direction_scores').select('id').eq('submission_id', sub.id).maybeSingle();
    if (!existingDir) {
      const dir = Math.max(55, Math.min(90, normalized_score - 4));
      const pq = Math.min(95, dir + 3), vr = Math.max(50, dir - 5);
      const { error: dErr } = await admin.from('ai_direction_scores').insert({
        submission_id: sub.id, prompt_quality: pq, error_catching: dir, verification_rigor: vr,
        direction_score: dir, interaction_count: 4, model_id: 'claude-haiku-4-5',
        reasoning: tier === 'low'
          ? 'Prompted clearly but accepted the AI draft with limited verification.'
          : "Scoped, iterative prompts and — critically — caught the AI's mistake and corrected it rather than accepting the flawed draft.",
        per_dimension: {
          prompt_quality: { points: pq, evidence: `What's the cleanest approach and where might it break?` },
          error_catching: { points: dir, evidence: tier === 'low' ? 'Accepted the draft as-is.' : 'Caught the missed edge case and reordered validation.' },
          verification_rigor: { points: vr, evidence: tier === 'low' ? 'Limited verification.' : 'Asked for a regression test before using the output.' },
        },
      });
      if (dErr) throw new Error('ai_direction ' + s.title + ': ' + dErr.message);
    }

    // 4) Behavioral integrity events via the sanctioned chain writer (append only if the chain is
    //    empty). client_attested (honest — these are browser signals), so "Integrity & activity" shows
    //    events while the hash chain stays valid/verifiable.
    const { count: evCount } = await admin.from('submission_integrity_events').select('seq', { count: 'exact', head: true }).eq('submission_id', sub.id);
    if (!evCount) {
      const events = [
        { type: 'window_blur', meta: {} },
        { type: 'window_focus', meta: {} },
        { type: 'paste', meta: { chars: tier === 'low' ? 220 : 60 } },
        { type: 'tab_hidden', meta: {} },
        { type: 'tab_visible', meta: {} },
      ];
      for (let k = 0; k < events.length; k++) {
        const { error: evErr } = await admin.rpc('append_integrity_event', {
          p_submission_id: sub.id, p_type: events[k].type, p_category: 'behavioral',
          p_meta: events[k].meta, p_client_ts: new Date(nowMs - (events.length - k) * 120000).toISOString(),
          p_source: 'client_attested',
        });
        if (evErr) throw new Error('integrity ' + s.title + ': ' + evErr.message);
      }
    }
  }

  console.log(`\n${APPLY ? '✅ Reseed applied.' : 'ℹ️  Dry run complete — re-run with --apply to write.'}`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error('RESEED FAILED:', e.message); process.exit(1); });
}

// Exported for unit-testing the pure targeting/scoring logic without touching the DB.
module.exports = { isJunkTitle, normalized, SCREENS };
