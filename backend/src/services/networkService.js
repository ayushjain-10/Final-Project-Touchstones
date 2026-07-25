/**
 * Candidate Network / "Apply with Touchstones" (CC3) — pure, DB-free helpers.
 * --------------------------------------------------------------------------
 * Kept separate from the route (routes/supabase/network.js) so the redaction
 * allowlists, the SERVER-AUTHORITATIVE insert-payload builder, the token shape,
 * and the reuse-count math are unit-tested without a database
 * (tests/unit/network.spec.js). These encode the v2 security lessons as pure,
 * testable contracts:
 *   • pickPublicReq      — the public /apply/:token page NEVER leaks owner id / PII.
 *   • buildApplicationInsert — a candidate may set ONLY the base columns; the trust /
 *     lifecycle columns (status, accepted_at, public_token) can never be client-supplied
 *     (the 061 lesson, mirrored in code as defense-in-depth over migration 072's grants).
 */

// Opaque share/apply tokens are hex (gen_random_uuid with dashes stripped) → 32 chars; be
// lenient but bounded so we never forward absurd input to an RPC. SAME shape as the
// credential token validator in credentials.js / passport.js.
function tokenValid(token) {
  const t = typeof token === 'string' ? token : '';
  return !!t && t.length <= 128 && /^[0-9a-zA-Z]+$/.test(t);
}

// Pull the opaque token out of a pasted apply/verify link OR a raw token.
function tokenFromInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/([0-9a-zA-Z]+)\/?$/);
  return m ? m[1] : s;
}

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

const MAX_TITLE = 120;
const MAX_ROLE = 80;
const MAX_COMPANY = 80;
const MAX_NOTE = 280;

// Normalize a req title (required, non-empty after trim/clip). Returns null if unusable.
function normalizeReqTitle(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().slice(0, MAX_TITLE);
  return t.length ? t : null;
}

// Defense-in-depth allowlist for the PUBLIC req shape served at /apply/:token. The get_req
// RPC (073) already redacts; this guarantees the route never forwards an unexpected field
// (e.g. owner_id or a future column) into the public response. NO PII is ever included.
const PUBLIC_REQ_KEYS = ['title', 'role_family', 'company_label', 'is_open', 'created_at'];

function pickPublicReq(req) {
  const out = {};
  if (!req || typeof req !== 'object') return out;
  for (const k of PUBLIC_REQ_KEYS) if (req[k] !== undefined) out[k] = req[k];
  return out;
}

// The ONLY columns a candidate may set when creating an application. The lifecycle / trust
// columns — status, accepted_at, public_token — are deliberately ABSENT: status is the
// server state machine, accepted_at is set by the gated accept route, and public_token is
// derived server-side from the (owned) credential so it can never point at a different
// credential. Migration 072 strips the column grants; this mirrors it in code so a stray
// client field is dropped BEFORE it reaches PostgREST. (The 061/S4-1b lesson.)
const APPLICATION_INSERT_KEYS = ['req_id', 'candidate_id', 'credential_id', 'note'];

function buildApplicationInsert({ reqId, candidateId, credentialId, note } = {}) {
  return {
    req_id: reqId,
    candidate_id: candidateId,
    credential_id: credentialId,
    note: clip(note, MAX_NOTE),
  };
}

const APPLICATION_STATUSES = ['submitted', 'accepted', 'declined', 'withdrawn'];

// Reuse / network signal — pure. Given acceptance rows ({ credential_id, accepting_account_id })
// and a set of the candidate's own credential ids, return a map credentialId → count of
// DISTINCT accepting accounts ("accepted by N teams"). Candidates cannot read
// credential_acceptances under RLS, so the route gathers these via the service role keyed
// strictly to the candidate's own (RLS-gated) credential ids; this function does the math.
function summarizeReuse(rows, credentialIds) {
  const ids = new Set((Array.isArray(credentialIds) ? credentialIds : []).filter(Boolean));
  const perCred = new Map(); // credentialId → Set(accountId)
  for (const id of ids) perCred.set(id, new Set());
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    const cid = r.credential_id;
    const acc = r.accepting_account_id;
    if (!cid || !acc || !perCred.has(cid)) continue;
    perCred.get(cid).add(acc);
  }
  const out = {};
  for (const [cid, set] of perCred) out[cid] = set.size;
  return out;
}

module.exports = {
  tokenValid,
  tokenFromInput,
  clip,
  MAX_TITLE,
  MAX_ROLE,
  MAX_COMPANY,
  MAX_NOTE,
  normalizeReqTitle,
  PUBLIC_REQ_KEYS,
  pickPublicReq,
  APPLICATION_INSERT_KEYS,
  buildApplicationInsert,
  APPLICATION_STATUSES,
  summarizeReuse,
};
