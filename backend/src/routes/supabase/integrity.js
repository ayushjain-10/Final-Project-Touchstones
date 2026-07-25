/**
 * Integrity-signal routes (Feature 2, pillar 1) — /api/integrity/...
 * Append-only, per-submission HASH CHAIN of proof-of-human signals (tab focus,
 * paste, typed-vs-pasted, automation/bot verdict, and later keystroke
 * traces). Log-only: these inform recruiter review — they never block
 * the candidate. The head row_hash is the submission's signable trust digest.
 *
 * Tamper-evidence: each row binds its content + the previous row's hash; the DB
 * trigger makes the table append-only; verification checks chain linkage.
 *
 * Chain authority is server-side. Rows are appended ONLY through the
 * append_integrity_event SECURITY DEFINER function (migration 021), which takes a
 * per-submission advisory lock, reads the head under the lock, and is backed by a
 * UNIQUE(submission_id, seq) constraint — so the previous read-head-then-insert race
 * (which silently forked the chain) now fails loudly instead. Candidate-reported
 * events are tagged source='client_attested' (display-only); the trust digest weights
 * ONLY 'server_observed' rows, since a signal the subject can self-author is worthless.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const { supabaseAdmin } = require('../../config/supabase');
const { getCorrelations } = require('../../services/fraudCorrelationService');
// Digest computation (events read, summary counters, verifyLinkage→verified_chain, head_hash,
// bot_verdict) + the pure hash helpers now live in ONE place so the /v1 verify path and this
// endpoint compute the digest identically (no forked integrity logic). The math is UNCHANGED.
const integrityDigestService = require('../../services/integrityDigestService');
const { canonicalJson, contentHash, verifyLinkage, genesis } = integrityDigestService;

router.use(supabaseAuth);

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// Derive the client IP safely. Prefer the LEFTMOST x-forwarded-for hop (the original
// client when behind a proxy/CDN), falling back to req.ip / socket address. We strip a
// :port and an IPv6-mapped-IPv4 prefix so the /24 derivation below works for v4.
function clientIpFrom(req) {
  const xff = req.headers['x-forwarded-for'];
  let ip = '';
  if (typeof xff === 'string' && xff.length) ip = xff.split(',')[0].trim();
  if (!ip) ip = req.ip || (req.socket && req.socket.remoteAddress) || '';
  ip = String(ip).trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7); // IPv6-mapped IPv4
  const portIdx = ip.lastIndexOf(':');
  // Only strip a port for IPv4 host:port (a bare IPv6 also has colons — leave it alone).
  if (portIdx > -1 && ip.indexOf(':') === portIdx && ip.indexOf('.') > -1) ip = ip.slice(0, portIdx);
  return ip;
}

// First three octets (/24) of an IPv4 address, else null. Coarse network proximity only.
function ipv4Prefix24(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip || '');
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

// NON-BIOMETRIC, server-side session-context capture. On the FIRST event for a
// submission we upsert ONE coarse, hashed session_fingerprints row (UNIQUE(submission_id)
// + ignoreDuplicates means later events are no-ops). We store NO raw IP — only a salted
// hash for equality, a /24 prefix, and a UA hash, plus locale/timezone context. Salt
// comes from SESSION_FINGERPRINT_SALT; WITHOUT it the ip_hash is omitted (we never hash a
// raw IP with an empty salt, which would be reversible). Degrades silently on any error —
// fingerprinting must never affect the integrity-event write path.
async function captureSessionFingerprint(req, submissionId, list) {
  try {
    const salt = process.env.SESSION_FINGERPRINT_SALT;
    const ip = clientIpFrom(req);
    const ua = req.headers['user-agent'] || '';
    // accept_language / tz_offset may arrive on the request headers OR inside an event's
    // meta (the client can self-report tz_offset, which the browser knows best).
    const acceptLanguage = (req.headers['accept-language'] || '').slice(0, 120) || null;
    let tzOffset = null;
    for (const e of list) {
      const m = e && e.meta;
      if (m && typeof m === 'object' && m.tz_offset != null && Number.isFinite(Number(m.tz_offset))) {
        tzOffset = Math.trunc(Number(m.tz_offset));
        break;
      }
    }

    const row = {
      submission_id: submissionId,
      ip_hash: (salt && ip) ? sha256(salt + ip) : null,
      ip_prefix: ipv4Prefix24(ip),
      ua_hash: ua ? sha256(ua) : null,
      accept_language: acceptLanguage,
      tz_offset: tzOffset,
    };

    // First-write-wins: UNIQUE(submission_id) + ignoreDuplicates keeps the original
    // session context and quietly drops repeats. Service-role write (no candidate policy).
    await supabaseAdmin
      .from('session_fingerprints')
      .upsert(row, { onConflict: 'submission_id', ignoreDuplicates: true });
  } catch (_e) {
    // Table absent, salt absent, or any failure -> silently skip. Never throws.
  }
}

// NOTE: canonicalJson / contentHash / verifyLinkage / genesis are imported from
// integrityDigestService above (single source of truth, byte-identical to SQL migration 021).

// POST /api/integrity/events  { submission_id, events:[{type, category, meta, client_ts}] }
router.post('/events', async (req, res) => {
  try {
    const { submission_id } = req.body || {};
    if (!isUUID(submission_id)) return fail(res, 400, 'submission_id (uuid) required');
    const list = Array.isArray(req.body.events) ? req.body.events
      : (req.body && req.body.type ? [req.body] : []);
    if (!list.length) return fail(res, 400, 'events[] required');

    // ownership: requester must be able to read this submission under RLS
    const { data: sub } = await req.user.supabase
      .from('work_sample_submissions').select('id, candidate_id').eq('id', submission_id).single();
    if (!sub) return fail(res, 404, 'submission not found or not accessible');

    // Append each event atomically via the SECURITY DEFINER function. Called through
    // req.user.supabase.rpc so the caller's RLS-scoped session + the function's EXECUTE
    // grant (authenticated) apply; the function body runs as definer for chain authority
    // (advisory lock + head-under-lock + UNIQUE(submission_id, seq)). Candidate-reported
    // events are client_attested — display-only, never weighted by the trust digest.
    let accepted = 0, lastSeq = null, lastHash = null;
    for (const e of list.slice(0, 200)) {
      const { data, error } = await req.user.supabase.rpc('append_integrity_event', {
        p_submission_id: submission_id,
        p_type: String(e.type || 'unknown').slice(0, 40),
        p_category: e.category ? String(e.category).slice(0, 24) : null,
        p_meta: (e.meta && typeof e.meta === 'object') ? e.meta : {},
        p_client_ts: e.client_ts || null,
        p_source: 'client_attested',
      });
      if (error) return fail(res, 500, error.message);
      // rpc returns the set-returning function's rows (out_seq, out_row_hash, out_prev_hash).
      const head = Array.isArray(data) ? data[data.length - 1] : data;
      if (head) { lastSeq = head.out_seq; lastHash = head.out_row_hash; }
      accepted += 1;
    }

    // NON-BIOMETRIC cross-session capture: on the first event for a submission, record a
    // coarse hashed session fingerprint (ip_hash/ip_prefix/ua_hash + locale/tz). Awaited
    // but fully self-contained (never throws) so it can't fail the event write above.
    await captureSessionFingerprint(req, submission_id, list);

    res.status(201).json({ accepted, head_hash: lastHash, seq: lastSeq });
  } catch (e) { fail(res, 500, e.message); }
});

// GET /api/integrity/submissions/:id/digest — signable trust digest + advisory summary
router.get('/submissions/:id/digest', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUUID(id)) return fail(res, 400, 'invalid id');
    const { data: sub } = await req.user.supabase
      .from('work_sample_submissions').select('id, work_sample_id, candidate_id').eq('id', id).single();
    if (!sub) return fail(res, 404, 'submission not found or not accessible');

    // Single source of truth: the same computeDigest the /v1 verify path calls (no forked
    // integrity logic). Reads the chain via service-role AFTER the ownership gate above.
    const digest = await integrityDigestService.computeDigest(id);
    res.json(digest);
  } catch (e) { fail(res, 500, e.message); }
});

// GET /api/integrity/submissions/:id/correlations — recruiter REVIEW signal only.
// Cross-session, NON-BIOMETRIC correlation flags (shared device/IP across DIFFERENT
// candidates the SAME recruiter screened). Owner-gated: unlike the digest (which the
// candidate can also read), correlations are recruiter-only — they describe OTHER
// candidates' sessions, so a candidate must never see them. We confirm the caller OWNS
// the submission's work_sample via the RLS-scoped client before returning the signal.
router.get('/submissions/:id/correlations', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUUID(id)) return fail(res, 400, 'invalid id');

    // Owner gate: the caller must OWN this submission's work_sample. We read through the
    // RLS-scoped client, so a candidate (who can read their own submission but not the
    // owner's work_sample under ws_owner_all) gets no work_samples row back, and a
    // non-owner recruiter sees neither. Both -> 404. Two plain steps, matching the
    // codebase's query style (no embedded-join filter).
    const { data: sub } = await req.user.supabase
      .from('work_sample_submissions')
      .select('id, work_sample_id')
      .eq('id', id)
      .single();
    if (!sub || !sub.work_sample_id) return fail(res, 404, 'submission not found or not accessible');

    const { data: ws } = await req.user.supabase
      .from('work_samples')
      .select('id, owner_id')
      .eq('id', sub.work_sample_id)
      .single();
    if (!ws || ws.owner_id !== req.user.id) {
      return fail(res, 404, 'submission not found or not accessible');
    }

    // Service computes the explainable, capped-at-'review' flags. Always returns a
    // well-formed (possibly empty) object; never throws.
    const result = await getCorrelations(id);
    res.json({ submission_id: id, ...result });
  } catch (e) { fail(res, 500, e.message); }
});

module.exports = router;
// Re-export the pure hash helpers for the golden-vector unit test (integrityHash.spec.js),
// which imports them from this module, WITHOUT breaking the Express router export above. The
// router stays the module's default; the helpers come from integrityDigestService (the single
// source of truth) and are attached here as named properties.
module.exports.canonicalJson = canonicalJson;
module.exports.contentHash = contentHash;
module.exports.verifyLinkage = verifyLinkage;
module.exports.genesis = genesis;
