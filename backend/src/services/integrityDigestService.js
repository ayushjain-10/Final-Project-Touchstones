/**
 * integrityDigestService — the SINGLE source of truth for a submission's integrity digest.
 * --------------------------------------------------------------------------------------
 * Extracted verbatim from routes/supabase/integrity.js (the GET /submissions/:id/digest
 * handler) so BOTH that endpoint AND the public `/v1` verify path compute the digest the
 * SAME way — no forked integrity logic. The math here is UNCHANGED from the original route;
 * the integrity golden-vector tests (integrityHash.spec.js) still import the pure helpers
 * (canonicalJson / contentHash / verifyLinkage / genesis) and must keep passing byte-for-byte.
 *
 * Chain authority is server-side: rows are appended ONLY through the append_integrity_event
 * SECURITY DEFINER function (migration 021). This module READS the persisted chain via the
 * service-role client and recomputes linkage independently (verifyLinkage), so a tampered
 * row or a forked chain is detected without trusting the stored row_hash. The trust digest
 * weights ONLY 'server_observed' rows — a candidate can self-author a clean client_attested
 * row, so those are display-only (bot_verdict counts only when server-observed).
 */
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');

const genesis = (submissionId) =>
  crypto.createHash('sha256').update('genesis:' + submissionId).digest('hex');

// Canonical serialization of `meta`, byte-identical to Postgres jsonb::text (the form the SQL
// integrity_row_hash function hashes). Two properties matter and BOTH must mirror jsonb exactly:
//   (1) PUNCTUATION SPACING. jsonb::text is NOT compact: a SPACE after every key colon AND after
//       every element/member comma, e.g. {"chars": 42, "a": 1} and [1, 2].
//   (2) KEY ORDER. jsonb orders object keys by UTF-8 byte length first, then bytewise (NOT plain
//       lexicographic). We mirror that comparator so the JS verifier reproduces what the DB wrote.
// Kept in lock-step with migration 021. (Moved here from integrity.js unchanged.)
function jsonbKeyCompare(a, b) {
  const ab = Buffer.byteLength(a, 'utf8');
  const bb = Buffer.byteLength(b, 'utf8');
  if (ab !== bb) return ab - bb;                 // shorter UTF-8 key first
  return Buffer.from(a, 'utf8').compare(Buffer.from(b, 'utf8')); // then bytewise
}
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  // jsonb::text inserts a space after each comma between array elements: [1, 2, 3].
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(', ') + ']';
  // jsonb::text inserts a space after each key colon and after each member comma: {"a": 1, "b": 2}.
  const keys = Object.keys(value).sort(jsonbKeyCompare);
  return '{' + keys.map((k) => JSON.stringify(k) + ': ' + canonicalJson(value[k])).join(', ') + '}';
}

// Canonical content hash. MUST stay byte-identical to the SQL integrity_row_hash function
// (migration 021). Recipe:
//   sha256( prev_hash || seq || \x1f || type || \x1f || (category||'')
//           || \x1f || canonical(meta) || \x1f || (client_ts||'') )
// Unit-separator (0x1f) delimiters; meta canonicalized to match jsonb::text.
function contentHash(prevHash, ev) {
  const US = '\x1f';
  const canonical =
    String(prevHash || '') +
    String(ev.seq) + US +
    String(ev.type || '') + US +
    (ev.category == null ? '' : String(ev.category)) + US +
    canonicalJson(ev.meta == null ? {} : ev.meta) + US +
    (ev.client_ts == null ? '' : String(ev.client_ts));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

// Erasure tombstone (migration 104): right-to-erasure scrubs a row's meta payload but
// preserves every chain column. Such a row can no longer prove its own payload bytes, so
// the content-hash check is skipped for it; linkage (prev_hash -> row_hash) is still
// enforced, and the row's stored row_hash stays pinned by every later row's prev_hash.
// Candidates cannot forge this marker: they have no UPDATE grant on the table (093), and
// a row APPENDED with erased:true gets a matching row_hash from the RPC anyway.
const isErasedTombstone = (meta) =>
  Boolean(meta && typeof meta === 'object' && !Array.isArray(meta) && meta.erased === true);

// Recompute the chain from genesis: each row's prev_hash must link to the previous row_hash,
// and each row_hash must match contentHash(prev, row). Detects tamper AND a forked chain.
// Rows scrubbed by erasure (meta.erased === true) keep linkage but skip the content check.
function verifyLinkage(events, submissionId) {
  let prev = genesis(submissionId);
  for (const e of events) {
    if ((e.prev_hash || '') !== prev) return false;
    if (!isErasedTombstone(e.meta)) {
      const expected = contentHash(prev, e);
      if ((e.row_hash || '') !== expected) return false;
    }
    prev = e.row_hash;
  }
  return true;
}

/**
 * computeDigest(submissionId) → the signable per-submission trust digest + advisory summary.
 *
 * IDENTICAL math to the old GET /api/integrity/submissions/:id/digest body. Reads the chain
 * via supabaseAdmin (the caller has already been ownership-gated by the route). Returns:
 *   {
 *     submission_id, event_count, server_observed_count,
 *     head_hash,                 // signable per-submission trust digest (last row_hash, or null)
 *     verified_chain,            // verifyLinkage over the full chain
 *     summary: { tab_hidden_count, tab_hidden_ms, window_blur_count, paste_count, paste_chars,
 *                typed_chars, final_chars, typed_fraction, bot_verdict },
 *     ide_activity,              // client-attested IDE rollup (display-only), or null
 *   }
 */
async function computeDigest(submissionId) {
  const { data: rows } = await supabaseAdmin
    .from('submission_integrity_events')
    .select('seq, type, category, meta, client_ts, prev_hash, row_hash, source')
    .eq('submission_id', submissionId)
    .order('seq', { ascending: true });
  const events = rows || [];
  const head = events.length ? events[events.length - 1].row_hash : null;

  // The trust digest weights ONLY server-observed signals — a candidate can self-author a clean
  // client_attested row, so those are display-only.
  const serverEvents = events.filter((e) => e.source === 'server_observed');

  // derived, advisory-only summary (a recruiter review flag, never an auto-reject)
  let hiddenCount = 0, blurCount = 0, pasteCount = 0, pasteChars = 0, hiddenMs = 0;
  let botVerdict = null, lastHiddenAt = null;
  let typedChars = 0, finalChars = 0, ideActivity = null;
  // Bot verdict counts ONLY when server-observed (the anti-self-attestation rule); the
  // behavioral counters remain a display summary over all events.
  for (const e of events) {
    const m = e.meta || {};
    if (e.type === 'tab_hidden') { hiddenCount++; lastHiddenAt = e.client_ts ? Date.parse(e.client_ts) : null; }
    if (e.type === 'tab_visible' && lastHiddenAt) {
      const back = e.client_ts ? Date.parse(e.client_ts) : lastHiddenAt;
      hiddenMs += Math.max(0, back - lastHiddenAt); lastHiddenAt = null;
    }
    if (e.type === 'window_blur') blurCount++;
    if (e.type === 'paste') { pasteCount++; pasteChars += Number(m.chars || 0); }
    if (e.type === 'session_submit') {
      typedChars = Number(m.typed_chars || 0);
      finalChars = Number(m.final_chars || 0);
      if (!pasteChars && m.paste_chars) pasteChars = Number(m.paste_chars || 0);
    }
    if (e.type === 'ide_activity' && m && typeof m === 'object') ideActivity = m;
  }
  for (const e of serverEvents) {
    const m = e.meta || {};
    if (e.type === 'bot_verdict' && typeof m.bot === 'boolean') botVerdict = m.bot;
  }
  const typed_fraction = finalChars > 0
    ? Math.max(0, Math.min(1, (finalChars - pasteChars) / finalChars)) : null;

  return {
    submission_id: submissionId,
    event_count: events.length,
    server_observed_count: serverEvents.length,
    head_hash: head,                 // the signable per-submission trust digest
    verified_chain: verifyLinkage(events, submissionId),
    summary: {
      tab_hidden_count: hiddenCount, tab_hidden_ms: hiddenMs, window_blur_count: blurCount,
      paste_count: pasteCount, paste_chars: pasteChars,
      typed_chars: typedChars, final_chars: finalChars, typed_fraction,
      bot_verdict: botVerdict,        // server-observed only; null if never server-attested
    },
    ide_activity: ideActivity,        // client-attested IDE rollup (display-only), or null
  };
}

module.exports = {
  computeDigest,
  // Pure helpers — exported so integrity.js can re-export them for the golden-vector test
  // (integrityHash.spec.js imports them from integrity.js) and so the math lives in ONE place.
  canonicalJson,
  contentHash,
  verifyLinkage,
  genesis,
};
