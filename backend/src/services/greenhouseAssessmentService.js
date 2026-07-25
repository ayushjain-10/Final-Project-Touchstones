/**
 * greenhouseAssessmentService - the Greenhouse Assessments (Take-Home Test) partner integration,
 * modeled step for step on ashbyAssessmentService (the architectural template). Contract:
 * https://developers.greenhouse.io/assessment.html
 *
 * Reuses the existing engine end-to-end (NO forked scoring/credential logic):
 *   • list_tests    -> the real assessment_templates library (public seeds + the account's own),
 *                      shaped as [{ partner_test_id, partner_test_name }].
 *   • send_test     -> materialize a work_sample FROM the chosen template + create an UNSTARTED
 *                      work_sample_submissions assignment (minted by email via userProvisioning) +
 *                      persist a greenhouse_assessments mapping. The row id IS the
 *                      partner_interview_id we return (and Greenhouse echoes back on test_status).
 *                      Start gate (TOU-150, migration 107): the assignment goes through the shared
 *                      createSubmission helper, so started_at/deadline_at stay NULL until the
 *                      candidate explicitly presses Start. Unlike Ashby, Greenhouse delivers no
 *                      link to the candidate, so WE send the invite email (the shared
 *                      workflowNotify.candidateAssignedToScreen path).
 *   • test_status   -> answers at ANY time (Greenhouse may poll until complete or 8 weeks):
 *                      { partner_status: 'sent' } until scored, then the completed shape with
 *                      partner_score + flat primitives-only metadata persisted at completion.
 *   • completion    -> proofScoringService.deliverScore() calls reportCompletionForSubmission()
 *                      fire-and-forget. We mark the mapping complete FIRST (Greenhouse fetches
 *                      test_status immediately after our PATCH), then PATCH the send_test-provided
 *                      url (empty body, Basic auth with the SAME org API key Greenhouse presents
 *                      to us - stored cryptoVault-encrypted for exactly this call).
 *
 * SSRF stance: the completion url is customer-flow data, so it is validated at send_test time AND
 * at PATCH time: https only, host exactly app.greenhouse.io, assertPublicHttpsUrl.
 */
const { supabaseAdmin } = require('../config/supabase');
const cryptoVault = require('./cryptoVault');
const { assertPublicHttpsUrl } = require('./ssrfGuard');
const { ensureAuthUser } = require('./userProvisioning');
const { generateKey, hashKey } = require('./apiKeyService');
const integrityDigestService = require('./integrityDigestService');
const verifyService = require('./verifyService');
const calibrationService = require('./calibrationService');
const workflowNotify = require('./workflowNotify');

// The ONLY host we will ever PATCH with the org credential. Fixed on purpose: a forged send_test
// must never make us send the customer's key to an attacker host.
const GREENHOUSE_APP_HOST = 'app.greenhouse.io';
const GREENHOUSE_USER_AGENT = 'Touchstones-Integration/1.0';
const OUTBOUND_TIMEOUT_MS = 10000;
const RETRY_BACKOFF_MS = [400, 1500, 4000];
const RETRY_AFTER_CAP_MS = 30000;

/** Feature flag - OFF by default. Read per call so tests can toggle it. */
function isEnabled() {
  return process.env.GREENHOUSE_ASSESSMENTS_ENABLED === 'true';
}

/** Typed error the route maps to Greenhouse's HTTP semantics (404 unknown resource, 400 bad request). */
class GreenhouseSendError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GreenhouseSendError';
    this.httpStatus = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/**
 * Validate the send_test completion url: https, host exactly app.greenhouse.io, publicly routable.
 * Returns { url, takeHomeTestId } (takeHomeTestId = trailing path segment, the idempotency key).
 */
async function validateCompletionUrl(rawUrl) {
  let parsed;
  try {
    parsed = await assertPublicHttpsUrl(String(rawUrl || ''));
  } catch (e) {
    throw new GreenhouseSendError(400, `url is not an acceptable https URL: ${e.message}`);
  }
  if (parsed.hostname.toLowerCase() !== GREENHOUSE_APP_HOST) {
    throw new GreenhouseSendError(400, `url host must be ${GREENHOUSE_APP_HOST}`);
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  const takeHomeTestId = segments.length ? segments[segments.length - 1] : null;
  return { url: parsed.toString(), takeHomeTestId };
}

/** Parse gh_candidate_id / gh_application_id out of greenhouse_profile_url. Never throws. */
function parseProfileUrl(profileUrl) {
  try {
    const u = new URL(String(profileUrl || ''));
    const m = /\/people\/(\d+)/.exec(u.pathname);
    const candidateId = m ? Number(m[1]) : null;
    const appRaw = u.searchParams.get('application_id');
    const applicationId = appRaw && /^\d+$/.test(appRaw) ? Number(appRaw) : null;
    return {
      gh_candidate_id: Number.isSafeInteger(candidateId) ? candidateId : null,
      gh_application_id: Number.isSafeInteger(applicationId) ? applicationId : null,
    };
  } catch {
    return { gh_candidate_id: null, gh_application_id: null };
  }
}

// --- per-tenant org Assessment API key (the credential Greenhouse presents to us AND we present
// --- back on the completion PATCH). Minted here; raw key stored cryptoVault-encrypted. ----------
async function getOrgApiKey(accountId) {
  const { data } = await supabaseAdmin
    .from('greenhouse_integration_settings').select('assessment_api_key_enc')
    .eq('account_id', accountId).maybeSingle();
  if (!data || !data.assessment_api_key_enc) return null;
  try { return cryptoVault.decrypt(data.assessment_api_key_enc); } catch { return null; }
}

async function getAssessmentKeySettings(accountId) {
  const key = await getOrgApiKey(accountId);
  return { configured: !!key, last4: key ? key.slice(-4) : null };
}

/**
 * Mint (or rotate) the per-org Assessment API key. The plaintext is returned ONCE for the customer
 * to hand to Greenhouse; thereafter only { configured, last4 }. Mint-first, revoke-after (the same
 * rotation order as /api/keys): a failed mint must never leave the org keyless.
 */
async function mintAssessmentKey(accountId) {
  const { data: settings } = await supabaseAdmin
    .from('greenhouse_integration_settings').select('assessment_api_key_id')
    .eq('account_id', accountId).maybeSingle();
  const previousKeyId = settings ? settings.assessment_api_key_id : null;

  const { plaintext, prefix, last4 } = generateKey('live');
  const { data: keyRow, error: keyErr } = await supabaseAdmin.from('api_keys').insert({
    account_id: accountId,
    name: 'Greenhouse Assessments',
    prefix,
    hashed_key: hashKey(plaintext),
    last4,
    mode: 'live',
    scopes: [],
  }).select('id').single();
  if (keyErr) throw new Error(`could not mint assessment key: ${keyErr.message}`);

  const { error: upsertErr } = await supabaseAdmin.from('greenhouse_integration_settings').upsert({
    account_id: accountId,
    assessment_api_key_enc: cryptoVault.encrypt(plaintext),
    assessment_api_key_id: keyRow.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'account_id' });
  if (upsertErr) throw new Error(`could not store assessment key: ${upsertErr.message}`);

  if (previousKeyId) {
    await supabaseAdmin.from('api_keys')
      .update({ revoked_at: new Date().toISOString() }).eq('id', previousKeyId)
      .then(() => {}, () => {});
  }
  return { key: plaintext, configured: true, last4 };
}

async function clearAssessmentKey(accountId) {
  const { data: settings } = await supabaseAdmin
    .from('greenhouse_integration_settings').select('assessment_api_key_id')
    .eq('account_id', accountId).maybeSingle();
  if (settings && settings.assessment_api_key_id) {
    await supabaseAdmin.from('api_keys')
      .update({ revoked_at: new Date().toISOString() }).eq('id', settings.assessment_api_key_id)
      .then(() => {}, () => {});
  }
  await supabaseAdmin.from('greenhouse_integration_settings').update({
    assessment_api_key_enc: null,
    assessment_api_key_id: null,
    updated_at: new Date().toISOString(),
  }).eq('account_id', accountId);
  return { configured: false };
}

// --- list_tests ---------------------------------------------------------------------------------
async function listTests(accountId) {
  const { data } = await supabaseAdmin
    .from('assessment_templates')
    .select('id, title, position')
    .or(`is_public.eq.true,created_by.eq.${accountId}`)
    .order('is_public', { ascending: false })
    .order('created_at', { ascending: false });
  const rows = data || [];
  // partner_test_name is the label in the Greenhouse stage picker; disambiguate duplicate titles.
  const counts = rows.reduce((m, t) => m.set(t.title, (m.get(t.title) || 0) + 1), new Map());
  return rows.map((t) => ({
    partner_test_id: t.id,
    partner_test_name: counts.get(t.title) > 1 ? `${t.title} (${String(t.id).slice(0, 8)})` : t.title,
  }));
}

// --- send_test (idempotent) ---------------------------------------------------------------------
async function sendTest(accountId, payload) {
  const typeId = payload && payload.partner_test_id;
  const cand = (payload && payload.candidate) || {};
  if (!typeId) throw new GreenhouseSendError(400, 'partner_test_id is required');
  if (!cand.email) throw new GreenhouseSendError(400, 'candidate.email is required');
  if (!payload.url) throw new GreenhouseSendError(400, 'url is required');

  // Validate + normalize the completion url BEFORE anything is written (SSRF boundary).
  const { url: patchUrl, takeHomeTestId } = await validateCompletionUrl(payload.url);

  // Idempotency: the trailing take_home_test id from the url is the natural retry key; fall back
  // to (test, candidate email) on non-terminal rows only when it is genuinely absent. When a
  // takeHomeTestId IS present it defines identity, so a miss means a genuinely NEW test (e.g. a
  // re-send after the first was never started): the email fallback must NOT run, or it would
  // hijack the stale row and drop the new completion url.
  let existing = null;
  if (takeHomeTestId) {
    ({ data: existing } = await supabaseAdmin.from('greenhouse_assessments').select('id')
      .eq('account_id', accountId).eq('gh_take_home_test_id', takeHomeTestId).maybeSingle());
  }
  if (!existing && !takeHomeTestId) {
    const { data: rows } = await supabaseAdmin.from('greenhouse_assessments')
      .select('id, status, created_at')
      .eq('account_id', accountId).eq('assessment_type_id', typeId).eq('candidate_email', cand.email);
    existing = (rows || [])
      .filter((r) => r.status === 'sent')
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
  }
  if (existing) return { partner_interview_id: existing.id, reused: true };

  // 1) Load the chosen template - must be PUBLIC or OWNED by this account (tenant boundary).
  //    Unknown test id is Greenhouse's documented "resource not found" (404).
  const { data: tpl } = await supabaseAdmin.from('assessment_templates')
    .select('*').eq('id', typeId).or(`is_public.eq.true,created_by.eq.${accountId}`).maybeSingle();
  if (!tpl) throw new GreenhouseSendError(404, 'Unknown partner_test_id');

  // 2) Provision the candidate FIRST (the most failure-prone step) so a failure here can't orphan
  //    a freshly-created screen.
  let candidateId;
  try {
    candidateId = await ensureAuthUser(cand.email, {
      first_name: cand.first_name, last_name: cand.last_name, source: 'greenhouse',
    });
  } catch (e) {
    throw new GreenhouseSendError(500, `could not provision candidate: ${e.message}`);
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
  if (wsErr) throw new GreenhouseSendError(500, `could not create screen: ${wsErr.message}`);

  // 4) Create the assignment through the SHARED start-gate helper (TOU-150, migration 107):
  //    status 'assigned' with NULL started_at/deadline_at. Lazy require: proof.js requires
  //    proofScoringService which requires this service, and both files assign module.exports at
  //    the bottom, so a top-level require here would capture a stale partial export.
  const { createSubmission } = require('../routes/supabase/proof');
  const { data: sub, error: subErr } = await createSubmission(ws, candidateId);
  if (subErr) throw new GreenhouseSendError(500, `could not assign screen: ${subErr.message}`);

  // 5) Persist the mapping. Its id is the partner_interview_id we return to Greenhouse.
  const profileIds = parseProfileUrl(cand.greenhouse_profile_url);
  const { data: row, error: mapErr } = await supabaseAdmin.from('greenhouse_assessments').insert({
    account_id: accountId, assessment_type_id: typeId, work_sample_id: ws.id, submission_id: sub.id,
    candidate_id: candidateId, candidate_email: cand.email,
    gh_candidate_id: profileIds.gh_candidate_id, gh_application_id: profileIds.gh_application_id,
    gh_take_home_test_id: takeHomeTestId, completion_patch_url: patchUrl,
    sent_by: payload.sent_by || null, status: 'sent',
  }).select().single();
  if (mapErr) {
    // Concurrent-retry race on the unique index → return the winning row.
    if (mapErr.code === '23505' && takeHomeTestId) {
      const { data: w } = await supabaseAdmin.from('greenhouse_assessments').select('id')
        .eq('account_id', accountId).eq('gh_take_home_test_id', takeHomeTestId).maybeSingle();
      if (w) return { partner_interview_id: w.id, reused: true };
    }
    throw new GreenhouseSendError(500, `could not persist mapping: ${mapErr.message}`);
  }

  // 6) Greenhouse's contract says the test "should be sent to this address" - the docs give us no
  //    link surface on their side, so WE email the candidate the screen link (non-blocking; the
  //    shared invite path from proof/portal).
  workflowNotify
    .candidateAssignedToScreen({ candidateId, workSampleId: ws.id, inviterId: accountId })
    .catch(() => {});

  return { partner_interview_id: row.id, reused: false };
}

// --- test_status --------------------------------------------------------------------------------
/**
 * Deprecation-safe polling: Greenhouse may GET this at any time until 'complete' or 8 weeks.
 * Returns null for an unknown id (the route 404s). Non-complete rows answer { partner_status:
 * 'sent' } (the docs enumerate no other pending vocabulary; see open question Q6).
 */
async function testStatus(accountId, partnerInterviewId) {
  const { data: mapping } = await supabaseAdmin.from('greenhouse_assessments').select('*')
    .eq('id', partnerInterviewId).eq('account_id', accountId).maybeSingle();
  if (!mapping) return null;
  if (mapping.status !== 'complete') return { partner_status: 'sent' };

  const body = {
    partner_status: 'complete',
    partner_profile_url: resultUrl(mapping),
  };
  const score = Number(mapping.partner_score);
  if (Number.isFinite(score)) body.partner_score = score;
  // Flat object, primitive values only; keys are display labels in the Greenhouse UI.
  if (mapping.result_metadata && typeof mapping.result_metadata === 'object') {
    body.metadata = mapping.result_metadata;
  }
  return body;
}

// --- request_errors -----------------------------------------------------------------------------
/** Greenhouse reports OUR malformed responses here. Log + best-effort persist; never throws. */
async function recordRequestErrors(accountId, payload = {}) {
  const errors = Array.isArray(payload.errors) ? payload.errors.map(String) : [];
  console.error('greenhouse request_errors:', JSON.stringify({
    api_call: payload.api_call || null,
    errors: errors.slice(0, 10),
    partner_interview_id: payload.partner_interview_id || null,
  }));
  if (payload.partner_interview_id) {
    await supabaseAdmin.from('greenhouse_assessments').update({
      last_error: `${payload.api_call || 'unknown'}: ${errors.join('; ')}`.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq('id', payload.partner_interview_id).eq('account_id', accountId)
      .then(() => {}, () => {});
  }
  return { status: 200 };
}

// --- outbound completion PATCH (we -> Greenhouse) ------------------------------------------------
/**
 * PATCH the send_test-provided url with an empty body and Basic(org key + ':'). Greenhouse then
 * immediately GETs test_status, which is why callers mark the mapping complete BEFORE this runs.
 * Retries on 429/5xx/network only; honors Retry-After on 429. Never throws.
 */
async function patchCompleted(mapping, apiKey) {
  const url = mapping.completion_patch_url;
  let parsed;
  try {
    parsed = await assertPublicHttpsUrl(url);
  } catch (e) {
    return { success: false, error: `completion url rejected: ${e.message}` };
  }
  if (parsed.hostname.toLowerCase() !== GREENHOUSE_APP_HOST) {
    return { success: false, error: `completion url host must be ${GREENHOUSE_APP_HOST}` };
  }
  const auth = Buffer.from(`${apiKey}:`).toString('base64'); // key as Basic-auth username, blank password
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OUTBOUND_TIMEOUT_MS);
    let waitMs = attempt < RETRY_BACKOFF_MS.length ? RETRY_BACKOFF_MS[attempt] : 0;
    try {
      const resp = await fetch(url, {
        method: 'PATCH',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          'User-Agent': GREENHOUSE_USER_AGENT,
        },
        // The contract is an empty-body PATCH; the response is a bare status code.
      });
      clearTimeout(timer);
      if (resp.ok) return { success: true, status: resp.status };
      // 4xx other than 429 are terminal (auth/validation) - do not retry.
      if (resp.status < 500 && resp.status !== 429) {
        const text = await resp.text().catch(() => '');
        return { success: false, status: resp.status, error: text.slice(0, 300) };
      }
      if (resp.status === 429) {
        const retryAfter = Number(resp.headers && resp.headers.get && resp.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter >= 0) {
          waitMs = Math.min(retryAfter * 1000, RETRY_AFTER_CAP_MS);
        }
      }
      lastErr = `greenhouse ${resp.status}`;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e.message;
    }
    if (attempt < RETRY_BACKOFF_MS.length) await sleep(waitMs);
  }
  return { success: false, error: `completion patch failed: ${lastErr}` };
}

// --- completion hook: called fire-and-forget by proofScoringService.deliverScore ----------------
async function reportCompletionForSubmission(submissionId, summary = {}) {
  try {
    if (!isEnabled()) return { skipped: true, reason: 'greenhouse_assessments_disabled' };
    const { data: mapping } = await supabaseAdmin.from('greenhouse_assessments').select('*')
      .eq('submission_id', submissionId).maybeSingle();
    if (!mapping) return { skipped: true, reason: 'not_linked' };
    if (mapping.status === 'complete') return { skipped: true, reason: 'already_complete' };

    const score = Number(summary.score);
    const partnerScore = Number.isFinite(score) ? Math.round(score) : 0;
    const metadata = await buildCompletionMetadata(mapping, summary);

    // Order matters (reverse of Ashby, where the update call carries the result): persist the
    // final answer FIRST so the test_status Greenhouse fires right after our PATCH sees it.
    await supabaseAdmin.from('greenhouse_assessments').update({
      status: 'complete',
      partner_score: partnerScore,
      result_metadata: metadata,
      updated_at: new Date().toISOString(),
    }).eq('id', mapping.id);

    const apiKey = await getOrgApiKey(mapping.account_id);
    if (!apiKey || !mapping.completion_patch_url) {
      return { skipped: true, reason: apiKey ? 'no_patch_url' : 'no_org_key' };
    }
    const r = await patchCompleted(mapping, apiKey);
    await supabaseAdmin.from('greenhouse_assessments').update(
      r.success
        ? { last_patched_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }
        : { last_error: String(r.error || `patch ${r.status}`).slice(0, 500), updated_at: new Date().toISOString() },
    ).eq('id', mapping.id).then(() => {}, () => {});
    return r;
  } catch (e) {
    // Best-effort contract: never throw into the scoring/delivery path.
    return { skipped: true, error: e.message };
  }
}

// Build the FLAT test_status metadata object (keys are display labels; values primitives only).
// Trust signals are best-effort; labels follow the trust-kit claim corrections (no determinism
// or whole-session overclaims).
async function buildCompletionMetadata(mapping, summary) {
  const metadata = { 'Max score': 100 };

  // proof-of-human (reuse the verify path): 'verified' | 'needs_review' | 'flagged'
  try {
    const digest = await integrityDigestService.computeDigest(mapping.submission_id);
    metadata['Proof of human'] = verifyService.deriveProofOfHumanState(digest);
  } catch { /* best effort - omit on failure */ }

  // calibrated percentile (omitted when the cohort is too small)
  try {
    let roleFamily = null;
    if (mapping.work_sample_id) {
      const { data: ws } = await supabaseAdmin.from('work_samples')
        .select('role_family').eq('id', mapping.work_sample_id).maybeSingle();
      roleFamily = ws ? ws.role_family || null : null;
    }
    const cal = await calibrationService.calibrationForScore({
      score: Number(summary.score), roleFamily, accountId: mapping.account_id,
    });
    if (cal && typeof cal.percentile === 'number') metadata.Percentile = cal.percentile;
  } catch { /* best effort - omit on failure */ }

  if (typeof summary.direction_score === 'number') {
    metadata['AI direction'] = Math.round(summary.direction_score);
  }
  return metadata;
}

module.exports = {
  isEnabled,
  listTests,
  sendTest,
  testStatus,
  recordRequestErrors,
  reportCompletionForSubmission,
  buildCompletionMetadata,
  patchCompleted,
  validateCompletionUrl,
  parseProfileUrl,
  getOrgApiKey,
  getAssessmentKeySettings,
  mintAssessmentKey,
  clearAssessmentKey,
  GreenhouseSendError,
  GREENHOUSE_APP_HOST,
};
