/**
 * Touchstones Passport (S4) — pure, DB-free helpers.
 * --------------------------------------------------
 * Kept separate from the route so the handle rules, percentile math,
 * proof-of-human derivation, and the public-shape redaction allowlist are
 * unit-tested without a database (tests/unit/passport.spec.js).
 */

// Mirrors the DB CHECK in migration 056: lower-case slug, 3-32 chars, single
// internal hyphens only (no leading/trailing/double hyphen).
const HANDLE_RE = /^[a-z0-9](-?[a-z0-9]){2,31}$/;

// Coerce arbitrary user input into a valid handle, or null if it can't be.
function normalizeHandle(raw) {
  if (typeof raw !== 'string') return null;
  let h = raw.trim().toLowerCase();
  h = h.replace(/[\s_]+/g, '-'); // spaces / underscores → hyphen
  h = h.replace(/[^a-z0-9-]/g, ''); // drop anything else
  h = h.replace(/-+/g, '-'); // collapse repeats
  h = h.replace(/^-+|-+$/g, ''); // trim hyphens
  return isValidHandle(h) ? h : null;
}

function isValidHandle(h) {
  return typeof h === 'string' && HANDLE_RE.test(h);
}

// Score-relative percentile: the share of comparison scores at or below `score`,
// as an int 0-100. Returns null when there aren't enough comparison points to be
// meaningful (so the UI hides it rather than showing a noisy number). This is a
// score percentile, NOT an outcome-calibrated one (S3 owns that); the UI labels it
// honestly and the founder can swap the source once calibration lands.
const MIN_PERCENTILE_SAMPLE = 5;
function scorePercentile(score, allScores, minSample = MIN_PERCENTILE_SAMPLE) {
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  const xs = (Array.isArray(allScores) ? allScores : []).map(Number).filter((n) => Number.isFinite(n));
  if (xs.length < minSample) return null;
  const atOrBelow = xs.filter((n) => n <= s).length;
  return Math.max(0, Math.min(100, Math.round((atOrBelow / xs.length) * 100)));
}

// Proof-of-human badge from an integrity digest — the SAME thresholds as the
// frontend verificationStateFromDigest, so the snapshot matches the live badge.
function proofOfHumanFromDigest(digest) {
  if (!digest) return 'review';
  const s = digest.summary || {};
  if (s.bot_verdict === true) return 'flagged';
  if (digest.verified_chain === false) return 'flagged';
  // S4-2: require POSITIVE behavioral evidence to award 'verified'. A submission with no
  // usable keystroke telemetry (typed_fraction null — e.g. a headless/programmatic submit
  // that emitted no events) fails to 'review', never the strongest badge. Fail CLOSED.
  // NOTE: keep byte-identical to the frontend verificationStateFromDigest (proofMappers.js).
  if (typeof s.typed_fraction !== 'number') return 'review';
  const heavyPaste = s.typed_fraction < 0.5;
  const wandered = (s.tab_hidden_count || 0) > 5 || (s.window_blur_count || 0) > 8;
  if (heavyPaste || wandered) return 'review';
  return 'verified';
}

// Defense-in-depth allowlist for the PUBLIC passport entry shape. The get_passport
// RPC already redacts; this guarantees the route never forwards an unexpected
// field (e.g. a future column) into the public response. NO PII is ever included.
const PUBLIC_ENTRY_KEYS = [
  'token',
  'score',
  'direction_score',
  'proof_of_human',
  'title',
  'role_family',
  'percentile',
  'issued_at',
];

function pickPublicEntry(entry) {
  const out = {};
  if (!entry || typeof entry !== 'object') return out;
  for (const k of PUBLIC_ENTRY_KEYS) if (entry[k] !== undefined) out[k] = entry[k];
  return out;
}

module.exports = {
  HANDLE_RE,
  MIN_PERCENTILE_SAMPLE,
  PUBLIC_ENTRY_KEYS,
  normalizeHandle,
  isValidHandle,
  scorePercentile,
  proofOfHumanFromDigest,
  pickPublicEntry,
};
