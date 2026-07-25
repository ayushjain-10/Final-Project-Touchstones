/**
 * Verify API `/v1` router — the PUBLIC product surface (Phase 2).
 * ===============================================================
 * POST /v1/verifications        — the 11-step ingest flow (verify-api-design.md). Reuses the
 *                                  EXISTING engine UNCHANGED (proofScoringService /
 *                                  aiDirectionService / codeExecutionService / integrityDigestService).
 * GET  /v1/verifications/:id     — account-filtered read of a prior Verification.
 * GET  /v1/verifications/:id/audit  — the immutable audit record (reuses proof.js audit.json shape)
 *                                  behind the per-key ownership gate.
 * GET  /v1/verifications/:id/report — mints a portable credential the SAME way credentials.js
 *                                  POST /submissions/:id/issue does, and returns its report_url.
 *
 * Mounted AFTER apiKeyAuth + perKeyLimiter + usageMetering (see app.js). req.apiAccount =
 * { accountId, mode, scopes, keyId, db }. `db` is account-scoped (RLS-minted when
 * SUPABASE_JWT_SECRET is set, else supabaseAdmin → we filter every read by account explicitly).
 *
 * TENANCY (load-bearing): candidate_id = accountId on the internal submission (candidate_ref is
 * opaque, NOT a profiles.id, and lives ONLY on the verifications row). Caller-supplied integrity
 * events are appended as source:'client_attested' ONLY. Test execution NEVER uses a caller-supplied
 * command — only a TRUSTED account-owned work_sample/template the caller references by id.
 *
 * ERROR ENVELOPE on every response: { error: { type, message, param? } }. Codes: 400 validation,
 * 401 auth (middleware), 404, 409 idempotency conflict, 422 unscoreable, 429 budget, 5xx. Never leak
 * internals.
 */
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const router = express.Router();

const { supabaseAdmin } = require('../../config/supabase');
const proofScoringService = require('../../services/proofScoringService');
const aiDirectionService = require('../../services/aiDirectionService');
const codeExecutionService = require('../../services/codeExecutionService');
const integrityDigestService = require('../../services/integrityDigestService');
const scoringQueue = require('../../services/scoringQueue');
const verifyService = require('../../services/verifyService');
const webhookService = require('../../services/webhookService');

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');

// --- error envelope: { error: { type, message, param? } } — NEVER leak internals ---
function err(res, status, type, message, param) {
  const body = { error: { type, message } };
  if (param) body.error.param = param;
  return res.status(status).json(body);
}

// ── zod request schema (validation → 400) ─────────────────────────────────────────────
const Criterion = z.object({
  id: z.string().min(1),
  requirement: z.string().min(1),
  points_possible: z.coerce.number(),
  weight: z.coerce.number().optional(),
  anchors: z.array(z.string()).optional(),
});
const IngestBody = z.object({
  candidate_ref: z.string().min(1).max(256),
  rubric: z.object({ criteria: z.array(Criterion).min(1) }),
  rubric_version: z.coerce.number().int().positive().optional().default(1),
  prompt_md: z.string().max(20000).optional(),
  // Exactly one of response_text / response_code must be non-empty (scoreSubmission needs a
  // response). Enforced by the refine below.
  work: z.object({
    response_text: z.string().optional(),
    response_code: z.string().optional(),
  }),
  events: z.array(z.object({
    type: z.string().optional(),
    category: z.string().optional(),
    meta: z.record(z.any()).optional(),
    client_ts: z.string().optional(),
  })).optional(),
  ai_transcript: z.array(z.object({
    role: z.string().optional(),
    content: z.string().optional(),
    disposition: z.string().optional(),
    client_ts: z.string().optional(),
  })).optional(),
  run_tests: z.boolean().optional(),
  // The caller may ask us to run hidden tests, but NEVER supplies the command. Instead it
  // references a TRUSTED account-owned work_sample whose `tests` we use. Caller-supplied test
  // commands are categorically rejected (RCE surface).
  work_sample_ref: z.string().uuid().optional(),
  template_ref: z.string().uuid().optional(),
  metadata: z.record(z.any()).optional(),
}).refine(
  (b) => {
    // scoreSubmission requires a response: at least one of the two must be non-empty.
    const t = (b.work.response_text || '').trim();
    const c = (b.work.response_code || '').trim();
    return t.length > 0 || c.length > 0;
  },
  { message: 'work must contain a non-empty response_text or response_code', path: ['work'] },
);

// Reconstruct candidate files from the serialized response_code — MIRRORS proof.js exactly
// (the IDE serializes multiple files with `/* ===== path ===== */` headers).
function reconstructFiles(responseCode, starterFiles) {
  const code = String(responseCode || '');
  if (/\/\* ===== .+? ===== \*\//.test(code)) {
    const parts = code.split(/\/\* ===== (.+?) ===== \*\/\n?/);
    const out = [];
    for (let i = 1; i < parts.length; i += 2) {
      out.push({ path: parts[i].trim(), content: parts[i + 1] || '' });
    }
    if (out.length) return out;
  }
  const path = (Array.isArray(starterFiles) && starterFiles[0] && starterFiles[0].path) || 'solution.js';
  return [{ path, content: code }];
}

const FRONTEND_URL = () => (process.env.FRONTEND_URL || '').replace(/\/+$/, '');

// The /v1 audit endpoint is served by THIS API host (not the frontend). Prefer an
// explicit API_PUBLIC_URL; otherwise derive from the request origin (Render sets
// x-forwarded-proto; default https).
function apiBaseUrl(req) {
  const envBase = (process.env.API_PUBLIC_URL || '').replace(/\/+$/, '');
  if (envBase) return envBase;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  return `${proto}://${req.get('host')}`;
}

// ══════════════════════════════════════════════════════════════════════════════════════
// POST /v1/verifications — the 11-step ingest flow.
// ══════════════════════════════════════════════════════════════════════════════════════
router.post('/verifications', async (req, res) => {
  const { accountId, mode, keyId, db } = req.apiAccount;
  // (1b) idempotency claim namespace — per-account so two accounts can reuse the same key string.
  const idemKey = (req.headers['idempotency-key'] || '').toString().trim() || null;
  const idemEventKey = idemKey ? `apikey:${accountId}:${idemKey}` : null;
  let idemClaimed = false;
  let verificationId = null; // B-8: hoisted so the outer catch can mark a stuck row terminally failed

  try {
    // ── (1) idempotency: claim BEFORE mutating. 23505 → return the prior report. ──────────
    if (idemEventKey) {
      const { error: claimErr } = await supabaseAdmin
        .from('processed_events')
        .insert({ event_key: idemEventKey, source: 'verify_api', result: { account_id: accountId } });
      if (claimErr) {
        if (claimErr.code === '23505') {
          // Already processed: return the persisted Verification for this (account, idem-key).
          const { data: prior } = await supabaseAdmin
            .from('verifications')
            .select('id, status, report')
            .eq('account_id', accountId)
            .eq('idempotency_key', idemKey)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (prior && prior.report) return res.status(200).json(prior.report);
          if (prior) return res.status(200).json({ id: prior.id, status: prior.status });
          // Claim exists but the row isn't readable yet — treat as an in-flight duplicate.
          return err(res, 409, 'idempotency_conflict',
            'A request with this Idempotency-Key is already being processed.');
        }
        // Dedup store unavailable (table not migrated) → degrade to best-effort, still ingest.
        console.warn('verify idempotency claim failed, proceeding:', claimErr.message);
      } else {
        idemClaimed = true;
      }
    }

    // ── (2) validate ─────────────────────────────────────────────────────────────────────
    const parsed = IngestBody.safeParse(req.body || {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const param = issue && Array.isArray(issue.path) ? issue.path.join('.') : undefined;
      throw new HandledError(400, 'validation_error', issue ? issue.message : 'Invalid request body.', param);
    }
    const body = parsed.data;
    const responseText = (body.work.response_text || '').trim() || null;
    const responseCode = (body.work.response_code || '').trim() || null;
    // Prefer text when present (it's also what the engine serializes first); code → 'code'.
    const responseType = responseText ? 'markdown' : 'code';

    // ── trusted tests: resolve a caller-referenced account-OWNED work_sample's `tests`. ────
    // NEVER a caller-supplied command. Only an account-owned template's stored tests qualify.
    let trustedTests = null;
    let trustedStarterFiles = [];
    const trustedRef = body.work_sample_ref || body.template_ref || null;
    if (body.run_tests && trustedRef) {
      const { data: tpl } = await db
        .from('work_samples')
        .select('id, tests, starter_files, owner_id')
        .eq('id', trustedRef)
        .eq('owner_id', accountId)   // explicit account filter (service-role fallback safety net)
        .maybeSingle();
      if (!tpl) {
        throw new HandledError(404, 'not_found',
          'Referenced work_sample for tests was not found in your account.', 'work_sample_ref');
      }
      trustedTests = tpl.tests && typeof tpl.tests === 'object' ? tpl.tests : null;
      trustedStarterFiles = Array.isArray(tpl.starter_files) ? tpl.starter_files : [];
    }

    // ── (3) create the verifications row (status 'queued', account-scoped) ────────────────
    const { data: vrow, error: vErr } = await db
      .from('verifications')
      .insert({
        account_id: accountId,
        api_key_id: keyId || null,
        mode,
        candidate_ref: body.candidate_ref,
        source: 'api',
        status: 'processing',
        idempotency_key: idemKey,
      })
      .select('id, created_at')
      .single();
    if (vErr) {
      // UNIQUE(account_id, idempotency_key) backstop — a racing duplicate lost the insert.
      if (vErr.code === '23505' && idemKey) {
        const { data: prior } = await supabaseAdmin
          .from('verifications').select('id, status, report')
          .eq('account_id', accountId).eq('idempotency_key', idemKey)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (prior && prior.report) return res.status(200).json(prior.report);
        return err(res, 409, 'idempotency_conflict',
          'A request with this Idempotency-Key already exists.');
      }
      throw new HandledError(500, 'api_error', 'Could not create the verification.');
    }
    verificationId = vrow.id;
    const createdAt = vrow.created_at;

    // ── (4) materialize the internal work_sample (engine plumbing; owner_id = accountId) ──
    const { data: ws, error: wsErr } = await db
      .from('work_samples')
      .insert({
        owner_id: accountId,
        title: (body.metadata && body.metadata.title) || `Verification ${verificationId.slice(0, 8)}`,
        prompt_md: body.prompt_md || '',
        response_type: responseType,
        rubric: body.rubric,
        rubric_version: body.rubric_version,
        tests: trustedTests,          // ONLY from the trusted account-owned template
        starter_files: trustedStarterFiles,
        status: 'published',
      })
      .select('id, rubric_version')
      .single();
    if (wsErr) throw new HandledError(500, 'api_error', 'Could not prepare the work sample.');

    // ── (5) materialize the internal submission (candidate_id = accountId — the central rule) ──
    const serialized = String(responseText || responseCode || '');
    const inputHash = crypto.createHash('sha256').update(serialized).digest('hex');
    const nowIso = new Date().toISOString();
    const { data: sub, error: subErr } = await db
      .from('work_sample_submissions')
      .insert({
        work_sample_id: ws.id,
        candidate_id: accountId,     // a real profiles row; candidate_ref stays on verifications
        response_text: responseText,
        response_code: responseCode,
        input_hash: inputHash,
        started_at: nowIso,
        submitted_at: nowIso,
        status: 'submitted',
      })
      .select('id')
      .single();
    if (subErr) throw new HandledError(500, 'api_error', 'Could not prepare the submission.');
    const submissionId = sub.id;

    // Link the internal artifacts back onto the verifications row.
    await db.from('verifications')
      .update({ work_sample_id: ws.id, submission_id: submissionId })
      .eq('id', verificationId).eq('account_id', accountId);

    // ── (6) append caller events — client_attested ONLY, sliced to 200, via append_integrity_event ──
    if (Array.isArray(body.events) && body.events.length) {
      for (const e of body.events.slice(0, 200)) {
        const { error: evErr } = await db.rpc('append_integrity_event', {
          p_submission_id: submissionId,
          p_type: String(e.type || 'unknown').slice(0, 40),
          p_category: e.category ? String(e.category).slice(0, 24) : null,
          p_meta: (e.meta && typeof e.meta === 'object') ? e.meta : {},
          p_client_ts: e.client_ts || null,
          p_source: 'client_attested',   // NEVER server_observed for caller-supplied events
        });
        if (evErr) {
          // An event-append failure shouldn't abort the whole verification; the chain is
          // advisory and the digest will simply reflect fewer events. Log and continue.
          console.warn('verify append_integrity_event failed:', evErr.message);
          break;
        }
      }
    }

    // ── (7) insert ai_transcript as ai_interactions (skip if absent) ──────────────────────
    let hasInteractions = false;
    if (Array.isArray(body.ai_transcript) && body.ai_transcript.length) {
      const rows = body.ai_transcript.slice(0, 200).map((e, i) => ({
        submission_id: submissionId,
        seq: i + 1,
        role: ['user', 'assistant', 'system'].includes(e.role) ? e.role : 'user',
        content: String(e.content || '').slice(0, 8000),
        disposition: ['accepted', 'edited', 'rejected'].includes(e.disposition) ? e.disposition : null,
        client_ts: e.client_ts || null,
        // caller-supplied via /v1 = self-reported, not server-observed (migration 095). The direction
        // scorer keeps these but marks the result attested:false so the trust weighting is honest.
        source: 'client_attested',
      }));
      const { error: aiErr } = await db.from('ai_interactions').insert(rows);
      if (aiErr) console.warn('verify ai_interactions insert failed:', aiErr.message);
      else hasInteractions = true;
    }

    // ── async branch: 202 + enqueue when the queue is on. NOTE: USE_SCORING_QUEUE is OFF in
    // every current deployment (the inline path below is what runs + is verified live). When the
    // queue is enabled, the verifications row finalization + webhook dispatch must move into the
    // worker (scoringQueue.processJob) — tracked as the async-path TODO; not wired here to avoid
    // shipping unverified speculative code for a disabled path. ──
    if (process.env.USE_SCORING_QUEUE === 'true') {
      await scoringQueue.enqueue(submissionId, ws.rubric_version);
      await db.from('verifications').update({ status: 'queued' })
        .eq('id', verificationId).eq('account_id', accountId);
      return res.status(202).json({ id: verificationId, status: 'queued' });
    }

    // ── (8) engine UNCHANGED — same call shapes / return mapping as proof.js ──────────────
    // scoreSubmission: pending_scoring → 202+enqueue, SpendCeilingError → 429, needs_review → status.
    let scoreResult;
    try {
      scoreResult = await proofScoringService.scoreSubmission(submissionId, {
        accountId,
        reviewerId: accountId,
      });
    } catch (e) {
      if (e && e.name === 'SpendCeilingError') {
        await failVerification(db, verificationId, accountId, 'rate_limit', e.message);
        // B-7: this branch RETURNS, so the outer catch's claim-release never runs. Release the
        // idempotency claim here — otherwise a client obeying Retry-After hits the 23505 replay
        // branch and gets a success-shaped 200 {status:'failed'} forever instead of a real retry.
        if (idemClaimed) {
          try { await supabaseAdmin.from('processed_events').delete().eq('event_key', idemEventKey); } catch (_) { /* best effort */ }
        }
        res.setHeader('Retry-After', '60');
        return err(res, 429, 'rate_limit', 'AI spend ceiling reached. Retry later.');
      }
      throw new HandledError(500, 'api_error', 'Scoring failed.');
    }
    // pending_scoring (LLM down) → accept + enqueue + 202, exactly like proof.js degrades.
    if (scoreResult && scoreResult.status === 'pending_scoring') {
      await scoringQueue.enqueue(submissionId, ws.rubric_version);
      await db.from('verifications').update({ status: 'queued' })
        .eq('id', verificationId).eq('account_id', accountId);
      return res.status(202).json({ id: verificationId, status: 'queued' });
    }
    const scoreObj = verifyService.mapScore(scoreResult);
    const scoreNeedsReview = scoreResult && scoreResult.status === 'needs_review';

    // (8b) AI-direction — only when interactions exist; no_interactions/needs_review → omit.
    let aiDirectionObj = null;
    if (hasInteractions) {
      try {
        const dir = await aiDirectionService.scoreAiDirection(submissionId, { accountId });
        aiDirectionObj = verifyService.mapAiDirection(dir);
      } catch (e) {
        if (e && e.name === 'SpendCeilingError') {
          // Direction is supplementary — degrade quietly rather than fail the verification.
          console.warn('verify scoreAiDirection budget:', e.message);
        } else {
          console.warn('verify scoreAiDirection failed:', e.message);
        }
      }
    }

    // (8c) code execution — only when asked AND enabled AND trusted tests exist. Trusted command.
    let codeExecObj = null;
    if (body.run_tests && codeExecutionService.isEnabled() && trustedTests && trustedTests.command) {
      try {
        const files = reconstructFiles(responseCode, trustedStarterFiles);
        const runResult = await codeExecutionService.runTests({ files, tests: trustedTests });
        codeExecObj = verifyService.mapCodeExecution(runResult);
      } catch (e) {
        console.warn('verify runTests failed:', e.message);
      }
    }

    // ── (9) proof_of_human: reuse computeDigest → derive state ────────────────────────────
    const digest = await integrityDigestService.computeDigest(submissionId);
    const proofState = verifyService.deriveProofOfHumanState(digest);

    // ── (10) assemble + persist; status reflects the engine outcome ───────────────────────
    const finalStatus = scoreNeedsReview || proofState === 'needs_review' || proofState === 'flagged'
      ? 'needs_review'
      : 'completed';
    const completedAt = new Date().toISOString();
    const auditUrl = `${apiBaseUrl(req)}/v1/verifications/${verificationId}/audit`;

    const verification = verifyService.assembleVerification({
      id: verificationId,
      candidateRef: body.candidate_ref,
      mode,
      status: finalStatus,
      digest,
      proofState,
      score: scoreObj,
      aiDirection: aiDirectionObj,
      codeExecution: codeExecObj,
      auditUrl,
      reportUrl: null, // minted on-demand by GET /:id/report (no second token type here)
      createdAt,
      completedAt,
    });

    await db.from('verifications')
      .update({ report: verification, status: finalStatus, completed_at: completedAt })
      .eq('id', verificationId).eq('account_id', accountId);

    // ── fire the terminal-state webhook (non-blocking — never delays the response). dispatch()
    // fans out to the account's active, subscribed endpoints; it records + retries on its own and
    // never throws. needs_review/flagged → verification.needs_review, else verification.completed.
    const eventType = finalStatus === 'needs_review' ? 'verification.needs_review' : 'verification.completed';
    webhookService.dispatch(accountId, eventType, verificationId, verification)
      .catch((e) => console.warn('verify webhook dispatch failed:', e && e.message));

    // ── (11) sync 200 (inline path; queue off and not degraded) ───────────────────────────
    return res.status(200).json(verification);
  } catch (e) {
    // Release the idempotency claim so a legitimate retry can reprocess (mirrors webhooks.js).
    if (idemClaimed) {
      try { await supabaseAdmin.from('processed_events').delete().eq('event_key', idemEventKey); }
      catch (_) { /* best effort */ }
    }
    if (e instanceof HandledError) {
      return err(res, e.status, e.type, e.message, e.param);
    }
    console.error('verify ingest error:', e);
    // B-8: mark the row terminally failed so GET /v1/verifications/:id doesn't return
    // {status:'processing'} forever after a transient scoring error (polling clients would hang).
    if (verificationId) {
      try { await failVerification(db, verificationId, accountId, 'api_error', (e && e.message) || 'processing error'); }
      catch (_) { /* best effort — the response is already an error */ }
    }
    return err(res, 500, 'api_error', 'An unexpected error occurred.');
  }
});

// A thrown control-flow error carrying the public envelope fields (so the single catch above
// emits the right status without leaking internals).
class HandledError extends Error {
  constructor(status, type, message, param) {
    super(message);
    this.status = status; this.type = type; this.param = param;
  }
}

// Persist a failure envelope onto the verifications row (status 'failed'), best-effort.
async function failVerification(db, id, accountId, type, message) {
  try {
    await db.from('verifications')
      .update({ status: 'failed', error: { type, message }, completed_at: new Date().toISOString() })
      .eq('id', id).eq('account_id', accountId);
  } catch (_) { /* best effort */ }
}

// ══════════════════════════════════════════════════════════════════════════════════════
// GET /v1/verifications/:id — account-filtered read of a prior Verification.
// ══════════════════════════════════════════════════════════════════════════════════════
router.get('/verifications/:id', async (req, res) => {
  try {
    const { accountId, db } = req.apiAccount;
    if (!isUUID(req.params.id)) return err(res, 400, 'validation_error', 'Invalid verification id.', 'id');
    const { data: row } = await db
      .from('verifications')
      .select('id, status, report, created_at, completed_at')
      .eq('id', req.params.id)
      .eq('account_id', accountId)   // explicit tenant filter — the isolation safety net
      .maybeSingle();
    if (!row) return err(res, 404, 'not_found', 'Verification not found.');
    if (row.report) return res.status(200).json(row.report);
    return res.status(200).json({ id: row.id, status: row.status, created_at: row.created_at, completed_at: row.completed_at });
  } catch (e) {
    console.error('verify get error:', e);
    return err(res, 500, 'api_error', 'An unexpected error occurred.');
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════
// GET /v1/verifications/:id/audit — the immutable audit record (reuses proof.js audit.json
// shape: the latest proof_audit_log row for the score) behind the per-key ownership gate.
// ══════════════════════════════════════════════════════════════════════════════════════
router.get('/verifications/:id/audit', async (req, res) => {
  try {
    const { accountId, db } = req.apiAccount;
    if (!isUUID(req.params.id)) return err(res, 400, 'validation_error', 'Invalid verification id.', 'id');
    // Ownership gate: the verification must belong to this account.
    const { data: v } = await db
      .from('verifications')
      .select('id, submission_id')
      .eq('id', req.params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!v || !v.submission_id) return err(res, 404, 'not_found', 'Verification not found.');

    // Latest non-superseded score for the gated submission → its head audit row (service-role
    // reads are keyed strictly by the gated submission id, exactly like credentials.js).
    const { data: score } = await supabaseAdmin
      .from('proof_scores')
      .select('id')
      .eq('submission_id', v.submission_id)
      .is('superseded_by', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!score) return err(res, 404, 'not_found', 'No audit record yet for this verification.');

    const { data: audit } = await supabaseAdmin
      .from('proof_audit_log')
      .select('*')
      .eq('proof_score_id', score.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!audit) return err(res, 404, 'not_found', 'Audit record not found.');

    res.setHeader('Content-Disposition', `attachment; filename="audit-${req.params.id}.json"`);
    return res.status(200).json(audit);
  } catch (e) {
    console.error('verify audit error:', e);
    return err(res, 500, 'api_error', 'An unexpected error occurred.');
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════
// GET /v1/verifications/:id/report — mint a portable credential the SAME way credentials.js
// POST /submissions/:id/issue does, and return its report_url. No second token type.
// ══════════════════════════════════════════════════════════════════════════════════════
router.get('/verifications/:id/report', async (req, res) => {
  try {
    const { accountId, db } = req.apiAccount;
    if (!isUUID(req.params.id)) return err(res, 400, 'validation_error', 'Invalid verification id.', 'id');
    // Ownership gate.
    const { data: v } = await db
      .from('verifications')
      .select('id, submission_id')
      .eq('id', req.params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!v || !v.submission_id) return err(res, 404, 'not_found', 'Verification not found.');

    // Latest score / direction / audit head — identical reads to credentials.js issue.
    const { data: score } = await supabaseAdmin.from('proof_scores')
      .select('id, normalized_score')
      .eq('submission_id', v.submission_id).is('superseded_by', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!score) return err(res, 422, 'unscoreable', 'This verification has no score to credential yet.');

    const { data: dir } = await supabaseAdmin.from('ai_direction_scores')
      .select('direction_score')
      .eq('submission_id', v.submission_id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    const { data: audit } = await supabaseAdmin.from('proof_audit_log')
      .select('row_hash')
      .eq('proof_score_id', score.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    // Reuse an existing credential for this submission if present (idempotent report_url);
    // otherwise mint one exactly like credentials.js (candidate_id = accountId).
    let credential;
    const { data: existing } = await supabaseAdmin.from('verified_credentials')
      .select('public_token')
      .eq('submission_id', v.submission_id)
      .is('revoked_at', null)
      .order('issued_at', { ascending: false }).limit(1).maybeSingle();
    if (existing && existing.public_token) {
      credential = existing;
    } else {
      const { data: minted, error: credErr } = await supabaseAdmin.from('verified_credentials').insert({
        submission_id: v.submission_id,
        candidate_id: accountId,                       // SAME as credentials.js (the gated owner)
        score: score.normalized_score,
        direction_score: dir ? dir.direction_score : null,
        digest_hash: audit ? audit.row_hash : null,
      }).select('public_token').single();
      if (credErr) throw credErr;
      credential = minted;
    }

    const reportUrl = `${FRONTEND_URL()}/verify/${credential.public_token}`;
    return res.status(200).json({ id: req.params.id, report_url: reportUrl });
  } catch (e) {
    console.error('verify report error:', e);
    return err(res, 500, 'api_error', 'An unexpected error occurred.');
  }
});

// /v1 catch-all: any unmatched path under the authed surface returns the SAME error envelope
// (not the app-level `{ message }` 404), so the public API is shape-consistent end to end.
router.use((req, res) => err(res, 404, 'not_found', `No such endpoint: ${req.method} ${req.originalUrl}`));

module.exports = router;
