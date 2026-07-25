/**
 * Portable "Touchstones-verified" credential (Feature 2 of the compounding moat).
 * --------------------------------------------------------------------------------
 * A scored submission can be issued as a portable, publicly-verifiable credential: a
 * single opaque token that resolves to {score, direction_score, issued_at} and nothing
 * else (no PII). A candidate can share the verify link on a resume/LinkedIn; anyone can
 * confirm it's real without logging in or being able to enumerate the table. This is the
 * post-PMF network effect — the credential travels with the candidate.
 *
 * Auth shape (IMPORTANT): /verify/:token is PUBLIC — it is registered BEFORE
 * router.use(supabaseAuth) and reads through the anon `supabase` client via the
 * get_credential(token) SECURITY DEFINER RPC (single-token lookup, no broad read policy).
 * issue/revoke are registered AFTER and DO require a Supabase session.
 */
const express = require('express');
const router = express.Router();
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const { supabase, supabaseAdmin } = require('../../config/supabase');
const workflowNotify = require('../../services/workflowNotify');

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// S4-3: the credential's bound audit head (digest_hash, captured at issue) must equal the LIVE
// proof_audit_log head for its score. Pure + exported so the tamper-evidence semantics are
// unit-tested without a DB. Any divergence (mutated/added audit row → different head) → false.
function chainConsistent(liveHeadRowHash, storedDigestHash) {
  if (!storedDigestHash || !liveHeadRowHash) return false;
  return liveHeadRowHash === storedDigestHash;
}

// ── PUBLIC: verify a credential by its share token (NO auth) ──
// Registered before supabaseAuth so no bearer token is required. Uses the anon client +
// the SECURITY DEFINER RPC, which returns the row ONLY for an exact token AND only when
// not revoked — so a revoked or missing token is indistinguishable (no enumeration).
router.get('/verify/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    // tokens are hex (gen_random_uuid with dashes stripped) → 32 hex chars; be lenient but
    // bounded so we never forward absurd input to the RPC.
    if (!token || token.length > 128 || !/^[0-9a-zA-Z]+$/.test(token)) {
      return res.status(404).json({ valid: false });
    }
    const { data, error } = await supabase.rpc('get_credential', { p_token: token });
    if (error) return fail(res, 500, error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return res.status(404).json({ valid: false });
    // Render as DATA only — no PII, no candidate id, no submission id.
    res.json({
      valid: true,
      score: row.score,
      direction_score: row.direction_score,
      issued_at: row.issued_at,
    });
  } catch (e) { fail(res, 500, e.message); }
});

// ── PUBLIC: rich verification for the accept-prior flow (NO auth) ──
// GET /api/credentials/:token/verify — the recruiter-facing verification: the
// minimal verify PLUS the tamper-evident digest_hash (binds the decision to the
// immutable audit chain) and the network counter ("accepted by N teams"). Served
// by the SECURITY DEFINER get_credential_full() RPC (no PII, no broad read).
router.get('/:token/verify', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (!token || token.length > 128 || !/^[0-9a-zA-Z]+$/.test(token)) {
      return res.status(404).json({ valid: false });
    }
    const { data, error } = await supabase.rpc('get_credential_full', { p_token: token });
    if (error) return fail(res, 500, error.message);
    if (!data) return res.status(404).json({ valid: false });

    // S4-3: don't just RE-ASSERT the stored digest — recompute the audit-chain head from the
    // LIVE proof_audit_log for this credential's score and compare to the digest_hash bound at
    // issue. A divergence ⇒ the scoring audit chain changed since issue (tamper-evident). No
    // internal IDs leak (resolved service-side, only the boolean is returned). null = unknown.
    let chain_consistent = null;
    try {
      const { data: cred } = await supabaseAdmin
        .from('verified_credentials').select('submission_id, digest_hash')
        .eq('public_token', token).maybeSingle();
      if (cred && cred.digest_hash) {
        const { data: score } = await supabaseAdmin
          .from('proof_scores').select('id').eq('submission_id', cred.submission_id)
          .is('superseded_by', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (score) {
          const { data: head } = await supabaseAdmin
            .from('proof_audit_log').select('row_hash').eq('proof_score_id', score.id)
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          chain_consistent = chainConsistent(head ? head.row_hash : null, cred.digest_hash);
        } else {
          chain_consistent = false; // the bound score is gone/superseded — can't reconfirm
        }
      }
    } catch { chain_consistent = null; /* undeterminable — never fabricate either way */ }

    res.json({ ...data, chain_consistent }); // backward-compatible: existing fields + chain_consistent
  } catch (e) { fail(res, 500, e.message); }
});

// Everything below requires a logged-in user.
router.use(supabaseAuth);

// POST /api/credentials/submissions/:id/issue — issue a credential for a scored submission.
// Ownership: the work_sample owner OR the candidate (the RLS-scoped read of the submission
// proves one of those; wss_candidate allows both). We pull the latest proof score, latest
// direction score, and the audit-log head hash, then insert as the candidate's credential.
router.post('/submissions/:id/issue', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    // ownership gate: requester can read this submission under RLS (owner or candidate).
    const { data: sub } = await req.user.supabase
      .from('work_sample_submissions').select('id, candidate_id').eq('id', req.params.id).single();
    if (!sub) return fail(res, 404, 'submission not found or not accessible');

    // Pull the score signals via service role AFTER the ownership gate (the gate is the
    // tenant boundary; these reads are keyed strictly by the gated submission id).
    const { data: score } = await supabaseAdmin.from('proof_scores')
      .select('id, normalized_score, created_at, superseded_by')
      .eq('submission_id', req.params.id).is('superseded_by', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!score) return fail(res, 409, 'submission has no score to credential yet');

    const { data: dir } = await supabaseAdmin.from('ai_direction_scores')
      .select('direction_score, created_at')
      .eq('submission_id', req.params.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    // audit-log head hash for this score (the tamper-evident digest binding the decision).
    const { data: audit } = await supabaseAdmin.from('proof_audit_log')
      .select('row_hash, created_at')
      .eq('proof_score_id', score.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    const { data, error } = await supabaseAdmin.from('verified_credentials').insert({
      submission_id: req.params.id,
      candidate_id: sub.candidate_id,
      score: score.normalized_score,
      direction_score: dir ? dir.direction_score : null,
      digest_hash: audit ? audit.row_hash : null,
    }).select().single();
    if (error) return fail(res, 500, error.message);

    const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    const verifyUrl = `${base}/verify/${data.public_token}`;
    // Deliver the credential to the candidate (best-effort, non-blocking) — it was minted but never
    // reached them before; the link was only in the HTTP response to the issuer.
    workflowNotify
      .candidateCredentialIssued({ candidateId: sub.candidate_id, submissionId: req.params.id, verifyUrl })
      .catch(() => {});
    res.status(201).json({ ...data, verify_url: verifyUrl });
  } catch (e) { fail(res, 500, e.message); }
});

// POST /api/credentials/:id/revoke — owner/candidate revokes (sets revoked_at).
router.post('/:id/revoke', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    // The credential's RLS policy (cred_candidate) lets the candidate read/write their own.
    // For the work-sample owner we additionally allow revoke after an ownership-gated read
    // of the underlying submission; the actual write is service-role after that gate.
    const { data: cred } = await supabaseAdmin.from('verified_credentials')
      .select('id, submission_id, candidate_id').eq('id', req.params.id).maybeSingle();
    if (!cred) return fail(res, 404, 'credential not found');

    let allowed = cred.candidate_id === req.user.id;
    if (!allowed) {
      // owner path: can the requester read the underlying submission under RLS? (owner can)
      const { data: sub } = await req.user.supabase
        .from('work_sample_submissions').select('id').eq('id', cred.submission_id).single();
      allowed = !!sub;
    }
    if (!allowed) return fail(res, 403, 'not authorized to revoke this credential');

    const { data, error } = await supabaseAdmin.from('verified_credentials')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single();
    if (error) return fail(res, 500, error.message);
    res.json(data);
  } catch (e) { fail(res, 500, e.message); }
});

// POST /api/credentials/:token/accept — accept-prior network. A recruiter accepts
// an existing credential for one of their reqs instead of re-screening. Idempotent
// (one acceptance per team per credential). body { req_label? }. Returns the fresh
// network counter so the UI can show "accepted by N teams".
router.post('/:token/accept', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (!token || token.length > 128 || !/^[0-9a-zA-Z]+$/.test(token)) return fail(res, 400, 'invalid token');
    const reqLabel = req.body && typeof req.body.req_label === 'string' ? req.body.req_label.slice(0, 200) : null;

    // The token IS the capability; resolve the credential (service-role) and ensure it's live.
    const { data: cred } = await supabaseAdmin.from('verified_credentials')
      .select('id, public_token, candidate_id, revoked_at').eq('public_token', token).maybeSingle();
    if (!cred || cred.revoked_at) return res.status(404).json({ error: 'credential not found or revoked' });

    // CF-1 (v3-hardening): block self-acceptance. This path writes via the service-role client,
    // which BYPASSES the migration-074 RLS self-accept guard — so the candidate-owner could
    // otherwise inflate their own public "accepted by N teams" counter by +1. Mirror the
    // network.js application-accept guard here (the counter is a cross-feature shared signal).
    if (cred.candidate_id && cred.candidate_id === req.user.id) {
      return res.status(403).json({ error: 'You cannot accept your own credential.' });
    }

    // Record the acceptance (idempotent via UNIQUE(credential_id, accepting_account_id)).
    // accepting_account_id is set to the authenticated user explicitly (admin write).
    const { error } = await supabaseAdmin.from('credential_acceptances').upsert({
      credential_id: cred.id,
      public_token: cred.public_token,
      accepting_account_id: req.user.id,
      req_label: reqLabel,
    }, { onConflict: 'credential_id,accepting_account_id' });
    if (error) return fail(res, 500, error.message);

    // Each row is already one distinct account (unique constraint), so COUNT = teams.
    const { count } = await supabaseAdmin.from('credential_acceptances')
      .select('id', { count: 'exact', head: true }).eq('credential_id', cred.id);
    res.status(201).json({ accepted: true, accepted_count: count ?? null });
  } catch (e) { fail(res, 500, e.message); }
});

module.exports = router;
// Exposed for unit tests (env-independent tamper-evidence semantics).
module.exports.chainConsistent = chainConsistent;
