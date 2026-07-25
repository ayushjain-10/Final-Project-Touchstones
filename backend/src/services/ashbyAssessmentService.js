/**
 * ashbyAssessmentService — the Ashby Assessments Partner integration (assessment provider side).
 *
 * Reuses the existing engine end-to-end (NO forked scoring/credential logic):
 *   • assessment.list  -> the real assessment_templates library (migration 031 seeds + the account's own).
 *   • assessment.start -> materialize a work_sample FROM the chosen template + create an UNSTARTED
 *                         work_sample_submissions assignment for the candidate (minted by email via
 *                         userProvisioning) + persist an ashby_assessments mapping. The mapping row id
 *                         IS the assessment_id we return to Ashby (and that Ashby echoes back).
 *                         Start gate (TOU-150, migration 107): the assignment goes through the shared
 *                         createSubmission helper, so started_at/deadline_at stay NULL until the
 *                         candidate explicitly presses Start, same as every other candidate.
 *   • assessment.cancel-> soft-archive the screen (never hard-delete evidence) + mark the mapping.
 *   • reportToAshby    -> OUTBOUND POST https://api.ashbyhq.com/assessment.update (Basic auth: key as
 *                         username, blank password; Accept: application/json; version=1), SSRF-guarded,
 *                         with retry on transient failures. Lifecycle: started -> complete (sending
 *                         assessment_result signals completion) / cancelled.
 *
 * Completion is driven by the EXISTING scoring path: proofScoringService.deliverScore() calls
 * reportCompletionForSubmission() fire-and-forget for any submission linked to an Ashby assessment.
 *
 * Result blobs use Ashby's flexible format { identifier, label, type, value, description? } with the
 * EXACT type enum: numeric_score | numeric_duration_minutes | url | string | boolean_success.
 */
const { supabaseAdmin } = require('../config/supabase');
const cryptoVault = require('./cryptoVault');
const { assertPublicHttpsUrl } = require('./ssrfGuard');
const { ensureAuthUser } = require('./userProvisioning');
const integrityDigestService = require('./integrityDigestService');
const verifyService = require('./verifyService');
const calibrationService = require('./calibrationService');

const ASHBY_API_BASE = (process.env.ASHBY_API_BASE || 'https://api.ashbyhq.com').replace(/\/+$/, '');
const ASHBY_ACCEPT = 'application/json; version=1';
// api.ashbyhq.com sits behind Cloudflare, which returns 403 "error 1010 (browser signature banned)"
// for a default/empty User-Agent (Node fetch / urllib). Send an explicit UA so the call gets through
// — verified against the real Ashby sandbox (200 with UA, 403/1010 without).
const ASHBY_USER_AGENT = 'Touchstones-Integration/1.0';
const OUTBOUND_TIMEOUT_MS = 10000;
const RETRY_BACKOFF_MS = [400, 1500, 4000];

/** Typed error the route maps to Ashby's HTTP semantics (422 with {message}, etc.). */
class AshbyStartError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AshbyStartError';
    this.httpStatus = status;
  }
}

// --- result-data blob ---------------------------------------------------------------------------
const BLOB_TYPES = new Set(['numeric_score', 'numeric_duration_minutes', 'url', 'string', 'boolean_success']);
function blob(identifier, label, type, value, description) {
  if (!BLOB_TYPES.has(type)) throw new Error(`ashby blob: unsupported type "${type}"`);
  const b = { identifier, label, type, value };
  if (description) b.description = description;
  return b;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- per-tenant outbound Ashby key (encrypted at rest) ------------------------------------------
async function getTenantAshbyKey(accountId) {
  const { data } = await supabaseAdmin
    .from('ashby_integration_settings').select('api_key_enc').eq('account_id', accountId).maybeSingle();
  if (!data || !data.api_key_enc) return null;
  try { return cryptoVault.decrypt(data.api_key_enc); } catch { return null; }
}
async function setTenantAshbyKey(accountId, apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('api_key is required');
  const enc = cryptoVault.encrypt(key);
  const last4 = key.slice(-4);
  const { error } = await supabaseAdmin.from('ashby_integration_settings').upsert(
    { account_id: accountId, api_key_enc: enc, api_key_last4: last4, updated_at: new Date().toISOString() },
    { onConflict: 'account_id' },
  );
  if (error) throw error;
  return { configured: true, last4 };
}
async function getTenantSettings(accountId) {
  const { data } = await supabaseAdmin
    .from('ashby_integration_settings').select('api_key_last4').eq('account_id', accountId).maybeSingle();
  return { configured: !!(data && data.api_key_last4 != null), last4: data ? data.api_key_last4 : null };
}
async function clearTenantAshbyKey(accountId) {
  await supabaseAdmin.from('ashby_integration_settings').delete().eq('account_id', accountId);
  return { configured: false };
}

// --- outbound POST to the fixed Ashby host ------------------------------------------------------
async function postAshby(path, apiKey, body) {
  const url = ASHBY_API_BASE + path;
  // Host is fixed/trusted; assert anyway so an ASHBY_API_BASE override can never point at a private host.
  await assertPublicHttpsUrl(url);
  const auth = Buffer.from(`${apiKey}:`).toString('base64'); // key as Basic-auth username, blank password
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OUTBOUND_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          Accept: ASHBY_ACCEPT,
          'User-Agent': ASHBY_USER_AGENT,
        },
        body: JSON.stringify(body),
      });
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        return { success: true, status: resp.status, data };
      }
      // 4xx other than 429 are terminal (auth/validation) — do not retry.
      if (resp.status < 500 && resp.status !== 429) {
        const text = await resp.text().catch(() => '');
        return { success: false, status: resp.status, error: text.slice(0, 300) };
      }
      lastErr = `ashby ${resp.status}`;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e.message;
    }
    if (attempt < RETRY_BACKOFF_MS.length) await sleep(RETRY_BACKOFF_MS[attempt]);
  }
  return { success: false, error: `assessment.update failed: ${lastErr}` };
}

// --- assessment.list ----------------------------------------------------------------------------
async function listAssessmentTypes(accountId) {
  const { data } = await supabaseAdmin
    .from('assessment_templates')
    .select('id, title, summary, position')
    .or(`is_public.eq.true,created_by.eq.${accountId}`)
    .order('is_public', { ascending: false })
    .order('created_at', { ascending: false });
  return (data || []).map((t) => ({
    assessment_type_id: t.id,
    name: t.title,
    description: t.summary || `${t.position || 'Real-work'} screen`,
  }));
}

// --- url helpers --------------------------------------------------------------------------------
function candidateScreenUrl(mapping) {
  const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  return base && mapping.work_sample_id ? `${base}/candidate?ws=${mapping.work_sample_id}` : null;
}
function resultUrl(mapping) {
  const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  if (base && mapping.submission_id) return `${base}/app/result?submission=${mapping.submission_id}`;
  return candidateScreenUrl(mapping);
}

// --- assessment.start (idempotent) --------------------------------------------------------------
async function startAssessment(accountId, payload) {
  const typeId = payload && payload.assessment_type_id;
  const cand = (payload && payload.candidate) || {};
  const app = (payload && payload.application) || {};
  const job = (payload && payload.job) || {};
  if (!typeId) throw new AshbyStartError(422, 'assessment_type_id is required');
  if (!cand.email) throw new AshbyStartError(422, 'candidate.email is required');

  // Idempotency: a retried start must not create a second assignment. Prefer the stable Ashby
  // application id; fall back to (assessment type, candidate email) when it's absent so we're
  // covered even if Ashby ever omits application.ashby_id on a retry.
  let existing = null;
  if (app.ashby_id) {
    ({ data: existing } = await supabaseAdmin.from('ashby_assessments').select('id')
      .eq('account_id', accountId).eq('ashby_application_id', app.ashby_id).eq('assessment_type_id', typeId).maybeSingle());
  } else {
    const { data: rows } = await supabaseAdmin.from('ashby_assessments').select('id, status, created_at')
      .eq('account_id', accountId).eq('assessment_type_id', typeId).eq('candidate_email', cand.email);
    existing = (rows || [])
      .filter((r) => r.status !== 'cancelled')
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
  }
  if (existing) return { assessment_id: existing.id, reused: true };

  // 1) Load the chosen template — must be PUBLIC or OWNED by this account (tenant boundary).
  const { data: tpl } = await supabaseAdmin.from('assessment_templates')
    .select('*').eq('id', typeId).or(`is_public.eq.true,created_by.eq.${accountId}`).maybeSingle();
  if (!tpl) throw new AshbyStartError(422, 'Unknown assessment type');

  // 2) Provision the candidate FIRST (the most failure-prone step — an external auth-admin call) so
  //    a failure here can't orphan a freshly-created screen. candidate_id is NOT NULL FK profiles(id).
  let candidateId;
  try {
    candidateId = await ensureAuthUser(cand.email, {
      first_name: cand.first_name, last_name: cand.last_name, source: 'ashby',
    });
  } catch (e) {
    throw new AshbyStartError(500, `could not provision candidate: ${e.message}`);
  }

  // 3) Materialize a concrete screen from the template, owned by the account.
  const { data: ws, error: wsErr } = await supabaseAdmin.from('work_samples').insert({
    owner_id: accountId,
    title: tpl.title,
    prompt_md: tpl.prompt_md,
    rubric: tpl.rubric,
    role_family: tpl.position || null,
    response_type: 'code',
    starter_files: Array.isArray(tpl.starter_files) ? tpl.starter_files : [],
    languages: Array.isArray(tpl.languages) ? tpl.languages : [],
    tests: tpl.tests || null,
    duration_minutes: tpl.time_limit_min || 60,
    status: 'published',
  }).select().single();
  if (wsErr) throw new AshbyStartError(500, `could not create screen: ${wsErr.message}`);

  // 4) Create the assignment through the SHARED start-gate helper (TOU-150, migration 107):
  //    status 'assigned' with NULL started_at/deadline_at, so an ATS-sourced candidate gets the
  //    same explicit Start gate as everyone else (POST /api/proof/submissions/:id/start stamps
  //    started_at + deadline_at from the screen's duration_minutes). Ashby needs no due date at
  //    creation: assessment.start returns only { assessment_id }, and assessment.update pushes
  //    status/result blobs on change. Lazy require: proof.js -> proofScoringService -> this
  //    service is a require cycle, and both files assign module.exports at the bottom, so a
  //    top-level require here would capture a stale partial export.
  const { createSubmission } = require('../routes/supabase/proof');
  const { data: sub, error: subErr } = await createSubmission(ws, candidateId);
  if (subErr) throw new AshbyStartError(500, `could not assign screen: ${subErr.message}`);

  // 5) Persist the mapping. Its id is the assessment_id we return to Ashby.
  const { data: row, error: mapErr } = await supabaseAdmin.from('ashby_assessments').insert({
    account_id: accountId, assessment_type_id: typeId, work_sample_id: ws.id, submission_id: sub.id,
    candidate_id: candidateId, candidate_email: cand.email, ashby_candidate_id: cand.ashby_id || null,
    ashby_application_id: app.ashby_id || null, ashby_job_id: job.ashby_id || null, status: 'started',
  }).select().single();
  if (mapErr) {
    // Concurrent-retry race on the unique index → return the winning row.
    if (mapErr.code === '23505' && app.ashby_id) {
      const { data: w } = await supabaseAdmin.from('ashby_assessments').select('id')
        .eq('account_id', accountId).eq('ashby_application_id', app.ashby_id).eq('assessment_type_id', typeId).maybeSingle();
      if (w) return { assessment_id: w.id, reused: true };
    }
    throw new AshbyStartError(500, `could not persist mapping: ${mapErr.message}`);
  }

  // 6) Signal "Started" to Ashby (non-blocking; graceful no-op when no outbound key is configured).
  reportToAshby(row, 'started').catch(() => {});
  return { assessment_id: row.id, reused: false };
}

// --- assessment.cancel --------------------------------------------------------------------------
async function cancelAssessment(accountId, assessmentId) {
  const { data: row } = await supabaseAdmin.from('ashby_assessments').select('*')
    .eq('id', assessmentId).eq('account_id', accountId).maybeSingle();
  if (!row) return { assessment_id: assessmentId, not_found: true };
  // Soft-cancel: ARCHIVE the screen (never hard-delete the immutable evidence) + mark the mapping.
  if (row.work_sample_id) {
    await supabaseAdmin.from('work_samples')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', row.work_sample_id).then(() => {}, () => {});
  }
  await supabaseAdmin.from('ashby_assessments')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', row.id);
  reportToAshby({ ...row, status: 'cancelled' }, 'cancelled', { reason: 'Cancelled in Ashby' }).catch(() => {});
  return { assessment_id: assessmentId };
}

// --- outbound lifecycle report (assessment.update) ----------------------------------------------
async function reportToAshby(mapping, kind, extra = {}) {
  const apiKey = await getTenantAshbyKey(mapping.account_id);
  if (!apiKey) return { skipped: true, reason: 'no_ashby_key' };

  // Strictly-increasing timestamp (ms since epoch) across this assessment's updates.
  const timestamp = Math.max(Date.now(), (mapping.last_reported_ms || 0) + 1);
  const body = { assessment_id: mapping.id, timestamp };

  if (kind === 'started') {
    body.assessment_status = blob('status', 'Status', 'string', 'Started');
    const url = candidateScreenUrl(mapping);
    if (url) body.assessment_profile_url = blob('assessment_url', 'Assessment', 'url', url);
  } else if (kind === 'complete') {
    // Sending assessment_result is what signals "complete" to Ashby.
    body.assessment_result = extra.result;
    body.metadata = extra.metadata || [];
    const url = extra.result_url || resultUrl(mapping);
    if (url) body.assessment_profile_url = blob('result_url', 'Result', 'url', url);
  } else if (kind === 'cancelled') {
    body.cancelled_reason = blob('cancelled_reason', 'Cancelled', 'string', extra.reason || 'Cancelled');
  }

  const r = await postAshby('/assessment.update', apiKey, body);
  await supabaseAdmin.from('ashby_assessments').update({ last_reported_ms: timestamp }).eq('id', mapping.id)
    .then(() => {}, () => {});
  return r;
}

// --- completion hook: called fire-and-forget by proofScoringService.deliverScore ----------------
async function reportCompletionForSubmission(submissionId, summary = {}) {
  try {
    const { data: mapping } = await supabaseAdmin.from('ashby_assessments').select('*')
      .eq('submission_id', submissionId).maybeSingle();
    if (!mapping) return { skipped: true, reason: 'not_linked' };
    if (mapping.status === 'complete' || mapping.status === 'cancelled') {
      return { skipped: true, reason: `already_${mapping.status}` };
    }
    const blobs = await buildCompletionBlobs(mapping, summary);
    const r = await reportToAshby(mapping, 'complete', blobs);
    await supabaseAdmin.from('ashby_assessments')
      .update({ status: 'complete', updated_at: new Date().toISOString() }).eq('id', mapping.id)
      .then(() => {}, () => {});
    return r;
  } catch (e) {
    return { skipped: true, error: e.message };
  }
}

// Build the Ashby result + metadata blobs from a scored submission. Best-effort on the trust signals
// (proof-of-human, calibrated percentile) — the headline score is always present.
async function buildCompletionBlobs(mapping, summary) {
  const score = Number(summary.score);
  const result = blob(
    'score', 'Touchstones score', 'numeric_score',
    Number.isFinite(score) ? Math.round(score) : 0,
    'Real-work screen score (0–100), computed in code from the rubric.',
  );
  const metadata = [blob('max_score', 'Max score', 'numeric_score', 100)];

  // proof-of-human (reuse the verify path): 'verified' | 'needs_review' | 'flagged'
  try {
    const digest = await integrityDigestService.computeDigest(mapping.submission_id);
    const state = verifyService.deriveProofOfHumanState(digest);
    metadata.push(blob('proof_of_human', 'Proof of human', 'string', state,
      'Server-computed from behavioral integrity signals.'));
  } catch { /* best effort — omit on failure */ }

  // calibrated percentile (omitted when the cohort is too small → null)
  try {
    let roleFamily = null;
    if (mapping.work_sample_id) {
      const { data: ws } = await supabaseAdmin.from('work_samples')
        .select('role_family').eq('id', mapping.work_sample_id).maybeSingle();
      roleFamily = ws ? ws.role_family || null : null;
    }
    const cal = await calibrationService.calibrationForScore({ score, roleFamily, accountId: mapping.account_id });
    if (cal && typeof cal.percentile === 'number') {
      metadata.push(blob('percentile', 'Percentile', 'numeric_score', cal.percentile,
        'Calibrated against same-role results.'));
    }
  } catch { /* best effort — omit on failure */ }

  if (typeof summary.direction_score === 'number') {
    metadata.push(blob('ai_direction', 'AI direction', 'numeric_score', Math.round(summary.direction_score),
      'How well the candidate directed the AI.'));
  }
  return { result, metadata, result_url: summary.result_url };
}

module.exports = {
  listAssessmentTypes,
  startAssessment,
  cancelAssessment,
  reportToAshby,
  reportCompletionForSubmission,
  buildCompletionBlobs,
  getTenantAshbyKey,
  setTenantAshbyKey,
  getTenantSettings,
  clearTenantAshbyKey,
  postAshby,
  blob,
  AshbyStartError,
  ASHBY_API_BASE,
};
