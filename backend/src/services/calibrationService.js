/**
 * calibrationService — the data moat, made legible (CC3 / Calibrated Score + Benchmarks).
 * ============================================================================================
 * Touchstones already collects what no competitor has: outcome labels (advanced / offer /
 * hired / stayed-90d) joined back to a code-computed proof score (migration 029, /api/outcomes).
 * This service turns that dataset into honest, defensible signal:
 *
 *   • a per-role SCORE PERCENTILE      — "an 85 is top 8% for Backend"
 *   • an OUTCOME-CALIBRATED BAND       — "candidates in 80–100 advanced 62% of the time (n=21)"
 *   • a calibrated LIKELIHOOD          — "Likely to clear an onsite", from the band's advance rate
 *   • benchmark DISTRIBUTIONS          — the role's score histogram + quantiles
 *
 * STATISTICAL HONESTY IS THE PRODUCT. Every number traces to a real aggregate. When a sample
 * is below a confidence threshold we say so (`insufficient_data: true`) and fall back, in order,
 * to the account's all-roles pool → the cross-account GLOBAL anonymized pool → a transparent
 * score-percentile heuristic. We NEVER fabricate precision and NEVER cross the tenant boundary:
 * cross-account aggregates are anonymized COUNTS/RATES only (no rows, no PII).
 *
 * Pure SQL counts + a thin JS layer — no LLM. The pure helpers (percentile / quantiles /
 * histogram / band rates) are exported and unit-tested (tests/unit/calibrationService.spec.js).
 * The bucket boundaries are REUSED from routes/supabase/outcomes.js so the moat has ONE source
 * of truth for "what band is this score in".
 */
const { supabaseAdmin } = require('../config/supabase');
const { bucketForScore, SCORE_BUCKETS } = require('../routes/supabase/outcomes');

// ── Confidence thresholds (judgment calls, versioned with the code) ──
// Below these counts a number is too noisy to headline; we degrade transparently rather than
// show false precision. Tunable as the dataset grows.
const MIN_ROLE_SAMPLE = 12; // scores needed before a per-role percentile is trustworthy
const MIN_BAND_SAMPLE = 8; // known outcomes in a band before its rate is trustworthy
// S3-2: k-anonymity for the CROSS-ACCOUNT global benchmark. A global aggregate must combine
// at least this many DISTINCT tenants — otherwise one account's candidates could BE the
// "global" benchmark shown to another tenant. Tunable as the customer base grows.
const MIN_DISTINCT_ACCOUNTS = 5;
const SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000; // cache-on-read freshness window (6h)
const GLOBAL_KEY = '*'; // sentinel role_family meaning "all roles" in a snapshot

// ── Cold-start calibration (empirical-Bayes shrinkage) ──────────────────────────────────────
// The outcome-calibrated band needs MIN_BAND_SAMPLE labeled outcomes before its RAW advance rate
// is trustworthy (n=1 trivially reads 100%). Below that floor the product used to headline
// nothing — and in early testing, with almost no downstream outcomes yet, that "insufficient
// data" state dominates and the calibration is never useful (instructor feedback, 2026-07). The
// fix is a Beta-Binomial POSTERIOR: a documented per-band prior (COLD_START_PRIOR), worth
// PRIOR_STRENGTH virtual outcomes, shrunk toward the observed selected/n. The estimate is ALWAYS
// available and honestly labelled by tier (prior → provisional → calibrated) with a 90% credible
// interval that is wide when data is thin and narrows as real outcomes arrive. Real data dominates
// the prior by ~n = 3·PRIOR_STRENGTH, so a well-sampled band is never overridden by the prior.
const PRIOR_STRENGTH = Math.max(1, parseInt(process.env.CALIBRATION_PRIOR_STRENGTH || '5', 10));
// A monotonic starting belief for the advance rate in each score band. These are PRIORS (a
// transparent starting assumption, never presented as measured outcomes); ~3·PRIOR_STRENGTH real
// labeled outcomes overwhelm them. Ordered so a higher score band never has a lower prior.
const COLD_START_PRIOR = { '0-59': 0.20, '60-79': 0.45, '80-100': 0.70 };

// Count DISTINCT contributing accounts among rows (optionally scoped to a role_family).
function distinctAccountCount(rows, roleFamily = null) {
  const scoped = roleFamily ? (rows || []).filter((r) => r.role_family === roleFamily) : (rows || []);
  const accts = new Set();
  for (const r of scoped) if (r && r.account_id) accts.add(r.account_id);
  return accts.size;
}

const round1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);

// Coerce a raw score to a finite number, or NaN if it's missing/non-numeric. Critically,
// null/undefined/'' become NaN (DROPPED) rather than Number(null) === 0 — a missing score must
// never silently count as a zero. Mirrors the guard in outcomes.bucketForScore.
const toNum = (v) => {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

// ──────────────────────────────────────────────────────────────────────────────────────────
// PURE STATS HELPERS (no DB, no PII) — the load-bearing math, unit-tested in isolation.
// ──────────────────────────────────────────────────────────────────────────────────────────

// Where `value` sits in a cohort. `percentile` is a midrank (ties split half-above/half-below),
// so the single highest score isn't reported as "top 0%". `top_percent` = share scoring HIGHER.
function rankStats(scores, value) {
  const nums = (scores || []).map(toNum).filter(Number.isFinite);
  const n = nums.length;
  const v = toNum(value);
  if (!n || !Number.isFinite(v)) {
    return { n, below: 0, equal: 0, above: 0, percentile: null, top_percent: null };
  }
  let below = 0;
  let equal = 0;
  let above = 0;
  for (const s of nums) {
    if (s < v) below += 1;
    else if (s > v) above += 1;
    else equal += 1;
  }
  return {
    n,
    below,
    equal,
    above,
    percentile: Math.round(((below + 0.5 * equal) / n) * 100),
    top_percent: Math.round((above / n) * 100),
  };
}

// Linear-interpolated quantile over an already-sorted-ascending array.
function quantileSorted(sortedAsc, q) {
  const n = sortedAsc.length;
  if (!n) return null;
  if (n === 1) return sortedAsc[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

function quantiles(scores) {
  const s = (scores || []).map(toNum).filter(Number.isFinite).sort((a, b) => a - b);
  const n = s.length;
  return {
    n,
    min: n ? s[0] : null,
    max: n ? s[n - 1] : null,
    mean: n ? round1(s.reduce((a, b) => a + b, 0) / n) : null,
    p10: round1(quantileSorted(s, 0.1)),
    p25: round1(quantileSorted(s, 0.25)),
    p50: round1(quantileSorted(s, 0.5)),
    p75: round1(quantileSorted(s, 0.75)),
    p90: round1(quantileSorted(s, 0.9)),
  };
}

// 0–100 in ten 10-point bins; the top bin is 90–100 inclusive so a perfect 100 has a home.
function histogram(scores) {
  const bins = [];
  for (let lo = 0; lo < 100; lo += 10) {
    const hi = lo === 90 ? 100 : lo + 9;
    bins.push({ lo, hi, label: `${lo}–${hi}`, n: 0 });
  }
  for (const raw of scores || []) {
    const v = toNum(raw);
    if (!Number.isFinite(v)) continue;
    const clamped = Math.max(0, Math.min(100, v));
    let idx = Math.floor(clamped / 10);
    if (idx > 9) idx = 9; // 100 → top bin
    bins[idx].n += 1;
  }
  return bins;
}

// A rate over its KNOWN denominator only: null (unknown / not-yet) is excluded from BOTH
// numerator and denominator, so "got_offer = null" never silently drags an offer rate down.
function knownRate(rows, key) {
  let known = 0;
  let yes = 0;
  for (const r of rows || []) {
    if (r[key] === true) {
      known += 1;
      yes += 1;
    } else if (r[key] === false) {
      known += 1;
    }
  }
  return { rate: known > 0 ? Math.round((yes / known) * 1000) / 10 : null, n: known, yes };
}

// Flatten a set of labeled rows into the public band/overall shape (per-metric known-n).
function rateBlock(rows) {
  const a = knownRate(rows, 'advanced');
  const o = knownRate(rows, 'got_offer');
  const h = knownRate(rows, 'hired');
  const r = knownRate(rows, 'retained_90d');
  return {
    n: (rows || []).length, // # of labeled submissions (an outcome row exists)
    advanced_rate: a.rate,
    advanced_n: a.n,
    advanced_selected: a.yes, // raw numerator — feeds the cold-start posterior (shrinkRate)
    offer_rate: o.rate,
    offer_n: o.n,
    hire_rate: h.rate,
    hire_n: h.n,
    retention_90d_rate: r.rate,
    retention_90d_n: r.n,
    // "sufficient" headlines on the advance signal (the onsite-clearing predictor).
    sufficient: a.n >= MIN_BAND_SAMPLE,
  };
}

// Per score-band outcome rates. `labeledRows` MUST already be filtered to rows with an outcome.
function bands(labeledRows) {
  return SCORE_BUCKETS.map((b) => {
    const inBand = (labeledRows || []).filter((r) => bucketForScore(r.score) === b.key);
    return { bucket: b.key, ...rateBlock(inBand) };
  });
}

// band_rate ÷ overall_rate → "advanced 3× more than the role average". null unless both known
// and the overall rate is positive (no divide-by-zero, no infinity headline).
function liftOf(bandRate, overallRate) {
  if (bandRate == null || overallRate == null || overallRate <= 0) return null;
  return Math.round((bandRate / overallRate) * 10) / 10;
}

// The headline calibrated band. Prefers the OUTCOME-measured advance rate when the band has
// enough labels; otherwise degrades to an explicitly-labeled score-percentile heuristic.
function likelihood({ bandAdvancedRate, bandSufficient, topPercent, score }) {
  // 1) Best: the OUTCOME-measured advance rate, when the band has enough labels.
  if (bandSufficient && bandAdvancedRate != null) {
    if (bandAdvancedRate >= 60) {
      return { label: 'Likely to clear an onsite', basis: 'outcome', confidence: 'calibrated' };
    }
    if (bandAdvancedRate >= 30) {
      return { label: 'Toss-up at the onsite', basis: 'outcome', confidence: 'calibrated' };
    }
    return { label: 'Unlikely to clear an onsite', basis: 'outcome', confidence: 'calibrated' };
  }
  // 2) A transparent score-PERCENTILE heuristic, when we can rank against a cohort.
  if (topPercent != null) {
    if (topPercent <= 25) return { label: 'Strong relative score', basis: 'percentile', confidence: 'uncalibrated' };
    if (topPercent <= 60) return { label: 'Mid-pack relative score', basis: 'percentile', confidence: 'uncalibrated' };
    return { label: 'Below-median relative score', basis: 'percentile', confidence: 'uncalibrated' };
  }
  // 3) No cohort at all → say so, but still give the honest ABSOLUTE-score read.
  const s = toNum(score);
  if (Number.isFinite(s)) {
    if (s >= 80) return { label: 'Strong score', basis: 'score_only', confidence: 'uncalibrated' };
    if (s >= 60) return { label: 'Solid score', basis: 'score_only', confidence: 'uncalibrated' };
    return { label: 'Below the usual bar', basis: 'score_only', confidence: 'uncalibrated' };
  }
  return { label: 'Not enough data yet', basis: 'none', confidence: 'none' };
}

// Approximate a percentile from an anonymized histogram (used only for the GLOBAL fallback,
// where we never hold raw scores — just bin counts). Assumes a uniform spread within a bin.
function percentileFromHistogram(bins, value) {
  const total = (bins || []).reduce((a, b) => a + (b.n || 0), 0);
  if (!total) return { percentile: null, top_percent: null, n: 0 };
  const raw = toNum(value);
  if (!Number.isFinite(raw)) return { percentile: null, top_percent: null, n: total };
  const v = Math.max(0, Math.min(100, raw));
  let below = 0;
  let inBin = 0;
  for (const b of bins) {
    if (v >= b.lo + 10) {
      below += b.n;
    } else if (v >= b.lo) {
      const frac = Math.max(0, Math.min(1, (v - b.lo) / 10));
      inBin = b.n * frac;
    }
  }
  const percentile = Math.round(((below + 0.5 * inBin) / total) * 100);
  return { percentile, top_percent: Math.max(0, 100 - percentile), n: total };
}

// ── Beta-Binomial cold-start math (PURE — unit-tested; no DB, no deps) ───────────────────────
// Lanczos approximation of ln Γ(z) (g=7). Accurate to ~1e-13 for z > 0 — ample for credible
// intervals. Only positive arguments occur here (posterior α,β ≥ prior pseudo-counts > 0).
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];
function lgamma(z) {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = LANCZOS[0];
  const g = 7;
  for (let i = 1; i < LANCZOS.length; i += 1) x += LANCZOS[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// Continued fraction for the incomplete beta (Lentz's method, Numerical Recipes §6.4).
function betacf(x, a, b) {
  const MAXIT = 300;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

// Regularized incomplete beta I_x(a,b) = P(X <= x), X ~ Beta(a,b). The CDF we invert for CIs.
function betai(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betacf(x, a, b)) / a : 1 - (front * betacf(1 - x, b, a)) / b;
}

// Quantile (inverse CDF) of Beta(a,b) via bisection on betai — credible-interval endpoints.
function betaQuantile(p, a, b) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (betai(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Beta-Binomial posterior for a band's SELECTED/n, shrunk toward `priorMean` with prior weight k.
// Returns the posterior-mean rate (%), a 90% credible interval (%), the confidence tier, and the
// inputs used. Pure + total: valid at n=0 (returns the prior), never NaN/throws. `bandSample` is
// the floor above which the band is trusted enough to be called 'calibrated'.
function shrinkRate({ selected, n, priorMean, k = PRIOR_STRENGTH, bandSample = MIN_BAND_SAMPLE }) {
  const N = Math.max(0, Math.floor(Number(n) || 0));
  const y = Math.max(0, Math.min(N, Math.floor(Number(selected) || 0)));
  const pm = Math.max(0, Math.min(1, Number(priorMean)));
  const a = y + pm * k; // posterior alpha
  const b = (N - y) + (1 - pm) * k; // posterior beta
  const mean = a / (a + b);
  const tier = N >= bandSample ? 'calibrated' : N > 0 ? 'provisional' : 'prior';
  return {
    advanced_rate: round1(mean * 100),
    ci_low: round1(betaQuantile(0.05, a, b) * 100),
    ci_high: round1(betaQuantile(0.95, a, b) * 100),
    tier,
    n: N,
    selected: y,
    prior_mean: round1(pm * 100),
    prior_strength: k,
  };
}

// ──────────────────────────────────────────────────────────────────────────────────────────
// DATA LAYER — read live aggregates (anonymized) via the service-role client, with an EXPLICIT
// owner filter so a service-role read can never leak across the tenant boundary.
// ──────────────────────────────────────────────────────────────────────────────────────────

// All scored submissions for an account (or, when ownerId is null, the WHOLE corpus for the
// global anonymized aggregate). Returns one row per submission with its latest non-superseded
// score, its role_family, and its outcome label if any. NO PII columns are ever selected.
async function fetchRows(ownerId = null) {
  let wsQuery = supabaseAdmin.from('work_samples').select('id, role_family, owner_id');
  if (ownerId) wsQuery = wsQuery.eq('owner_id', ownerId);
  const { data: samples, error: e0 } = await wsQuery;
  if (e0) throw new Error(e0.message);
  const wsRole = new Map((samples || []).map((s) => [s.id, s.role_family || null]));
  // S3-2: carry the owning account so the cross-account GLOBAL aggregate can enforce
  // k-anonymity by DISTINCT TENANTS, not just by row count.
  const wsOwner = new Map((samples || []).map((s) => [s.id, s.owner_id || null]));
  const wsIds = [...wsRole.keys()];
  if (!wsIds.length) return [];

  const subRole = new Map();
  const subOwner = new Map();
  // Chunk the work_sample_id IN-list so a large account never blows past the URL limit.
  for (const chunk of chunked(wsIds, 200)) {
    const { data: subs, error: e1 } = await supabaseAdmin
      .from('work_sample_submissions')
      .select('id, work_sample_id')
      .in('work_sample_id', chunk);
    if (e1) throw new Error(e1.message);
    for (const s of subs || []) {
      subRole.set(s.id, wsRole.get(s.work_sample_id) || null);
      subOwner.set(s.id, wsOwner.get(s.work_sample_id) || null);
    }
  }
  const subIds = [...subRole.keys()];
  if (!subIds.length) return [];

  const latest = new Map();
  const outcomeBy = new Map();
  for (const chunk of chunked(subIds, 200)) {
    const [{ data: scores, error: e2 }, { data: outcomes, error: e3 }] = await Promise.all([
      supabaseAdmin
        .from('proof_scores')
        .select('id, submission_id, normalized_score, created_at, superseded_by')
        .in('submission_id', chunk),
      supabaseAdmin
        .from('submission_outcomes')
        .select('submission_id, advanced, got_offer, hired, retained_90d')
        .in('submission_id', chunk),
    ]);
    if (e2) throw new Error(e2.message);
    if (e3) throw new Error(e3.message);
    for (const s of scores || []) {
      if (s.superseded_by) continue; // only the live score counts
      const prev = latest.get(s.submission_id);
      if (!prev || new Date(s.created_at) > new Date(prev.created_at)) latest.set(s.submission_id, s);
    }
    for (const o of outcomes || []) outcomeBy.set(o.submission_id, o);
  }

  const rows = [];
  for (const [subId, sc] of latest.entries()) {
    const o = outcomeBy.get(subId) || null;
    const labeled =
      !!o && (o.advanced != null || o.got_offer != null || o.hired != null || o.retained_90d != null);
    rows.push({
      score_id: sc.id,
      submission_id: subId,
      created_at: sc.created_at,
      score: sc.normalized_score,
      role_family: subRole.get(subId) || null,
      account_id: subOwner.get(subId) || null, // S3-2: owning tenant (for distinct-account k-anon)
      advanced: o ? o.advanced : null,
      got_offer: o ? o.got_offer : null,
      hired: o ? o.hired : null,
      retained_90d: o ? o.retained_90d : null,
      labeled,
    });
  }
  return rows;
}

function chunked(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Build the per-role report (distribution + bands + quantiles) from a set of rows.
function reportFromRows(rows, roleFamily) {
  const scoped = roleFamily ? rows.filter((r) => r.role_family === roleFamily) : rows;
  const scores = scoped.map((r) => r.score);
  const labeled = scoped.filter((r) => r.labeled);
  return {
    role_family: roleFamily || null,
    sample_size: labeled.length, // # labeled outcomes (the calibration basis)
    scored_size: scoped.length, // # scored submissions (the distribution basis)
    distribution: histogram(scores),
    percentiles: quantiles(scores),
    buckets: bands(labeled),
    outcome_rates: rateBlock(labeled),
  };
}

// ──────────────────────────────────────────────────────────────────────────────────────────
// SNAPSHOT CACHE — calibration_snapshots (migration 052). Always recompute-able; never lies.
// ──────────────────────────────────────────────────────────────────────────────────────────

async function readSnapshot({ scope, accountId = null, roleFamily = GLOBAL_KEY }) {
  let q = supabaseAdmin
    .from('calibration_snapshots')
    .select('*')
    .eq('scope', scope)
    .eq('role_family', roleFamily)
    .order('computed_at', { ascending: false })
    .limit(1);
  q = accountId ? q.eq('account_id', accountId) : q.is('account_id', null);
  const { data, error } = await q;
  if (error) return null;
  return (data && data[0]) || null;
}

function snapshotIsFresh(snap) {
  if (!snap || !snap.computed_at) return false;
  return Date.now() - new Date(snap.computed_at).getTime() < SNAPSHOT_TTL_MS;
}

function reportToSnapshotPayload(report) {
  return {
    sample_size: report.sample_size,
    buckets: report.buckets,
    outcome_rates: report.outcome_rates,
    distribution: report.distribution,
    percentiles: { ...report.percentiles, scored_size: report.scored_size },
  };
}

function snapshotToReport(snap) {
  if (!snap) return null;
  const { scored_size, ...pct } = snap.percentiles || {};
  return {
    role_family: snap.role_family === GLOBAL_KEY ? null : snap.role_family,
    sample_size: snap.sample_size || 0,
    scored_size: scored_size != null ? scored_size : (snap.distribution || []).reduce((a, b) => a + (b.n || 0), 0),
    distribution: snap.distribution || [],
    percentiles: pct,
    buckets: snap.buckets || [],
    outcome_rates: snap.outcome_rates || rateBlock([]),
    computed_at: snap.computed_at,
  };
}

// Best-effort cache write for one account+role. Never throws into the request path.
async function writeAccountSnapshot(accountId, roleFamily, report) {
  try {
    await supabaseAdmin.from('calibration_snapshots').upsert(
      {
        scope: 'account',
        account_id: accountId,
        role_family: roleFamily || GLOBAL_KEY,
        ...reportToSnapshotPayload(report),
        computed_at: new Date().toISOString(),
      },
      { onConflict: 'scope,account_id,role_family' },
    );
  } catch (_) {
    /* cache write is best-effort */
  }
}

// ──────────────────────────────────────────────────────────────────────────────────────────
// PUBLIC API — consumed by routes/supabase/benchmarks.js
// ──────────────────────────────────────────────────────────────────────────────────────────

// Per-role distribution + outcome bands for ONE account (live, with best-effort snapshot cache).
async function roleReport(accountId, roleFamily) {
  const rows = await fetchRows(accountId);
  const report = reportFromRows(rows, roleFamily || null);
  writeAccountSnapshot(accountId, roleFamily || null, report); // fire-and-forget cache
  return report;
}

// The role families this account has scored, with sample sizes (drives the Benchmarks nav).
async function accountRoles(accountId) {
  const rows = await fetchRows(accountId);
  const byRole = new Map();
  for (const r of rows) {
    const key = r.role_family || '—';
    if (!byRole.has(key)) byRole.set(key, { role_family: r.role_family || null, scored: 0, labeled: 0 });
    const e = byRole.get(key);
    e.scored += 1;
    if (r.labeled) e.labeled += 1;
  }
  return [...byRole.values()].sort((a, b) => b.scored - a.scored);
}

// SYNC core: compute the compact calibration object from already-fetched rows, with a
// transparent fallback chain role → account-all-roles → score-only heuristic. No DB access, so
// it's reusable for the many results on a dashboard without N round-trips. The async
// calibrationForScore wraps this to additionally try the cross-account GLOBAL pool.
function computeCalibration({ score, roleFamily, rows }) {
  const numScore = toNum(score);
  const roleRows = roleFamily ? (rows || []).filter((r) => r.role_family === roleFamily) : rows || [];
  const roleLabeled = roleRows.filter((r) => r.labeled);
  const roleRank = rankStats(roleRows.map((r) => r.score), numScore);

  if (roleRank.n >= MIN_ROLE_SAMPLE) {
    return finalize({
      score: numScore,
      roleFamily: roleFamily || null,
      scope: 'role',
      insufficient: false,
      rank: roleRank,
      band: pickBand(bands(roleLabeled), numScore),
      overall: rateBlock(roleLabeled),
      sampleSize: roleLabeled.length,
    });
  }

  // The role's own sample is too thin to headline — rank across ALL of this account's screens.
  const allLabeled = (rows || []).filter((r) => r.labeled);
  const allRank = rankStats((rows || []).map((r) => r.score), numScore);
  if (allRank.n >= MIN_ROLE_SAMPLE) {
    return finalize({
      score: numScore,
      roleFamily: null,
      scope: 'account_all_roles',
      insufficient: true,
      rank: allRank,
      band: pickBand(bands(allLabeled), numScore),
      overall: rateBlock(allLabeled),
      sampleSize: allLabeled.length,
    });
  }

  // No cohort big enough on this account → score-only heuristic (caller may try GLOBAL).
  return finalize({
    score: numScore,
    roleFamily: roleFamily || null,
    scope: 'heuristic',
    insufficient: true,
    rank: { percentile: null, top_percent: null, n: roleRank.n },
    band: null,
    overall: rateBlock([]),
    sampleSize: roleLabeled.length,
  });
}

// The compact "calibration" object for a single result. This is what the result API can embed
// next to a score (the CalibrationBadge consumes it). `score`/`roleFamily` are resolved by the
// caller from the RLS-scoped proof_scores row, so this never re-reads across the tenant boundary.
// When the account itself has too little data, it falls back to the cross-account anonymized
// GLOBAL snapshot (counts/rates only) before degrading to the score-only heuristic.
async function calibrationForScore({ score, roleFamily, accountId, rows = null }) {
  const allRows = rows || (await fetchRows(accountId));
  const local = computeCalibration({ score, roleFamily, rows: allRows });
  if (local.scope !== 'heuristic') return local;

  // Cross-account anonymized fallback: a GLOBAL snapshot (counts/rates only, never rows).
  const snap =
    (await readSnapshot({ scope: 'global', accountId: null, roleFamily: roleFamily || GLOBAL_KEY })) ||
    (await readSnapshot({ scope: 'global', accountId: null, roleFamily: GLOBAL_KEY }));
  const gr = snapshotToReport(snap);
  if (gr && gr.sample_size >= MIN_BAND_SAMPLE) {
    return finalize({
      score: toNum(score),
      roleFamily: snap.role_family === GLOBAL_KEY ? null : snap.role_family,
      scope: snap.role_family === GLOBAL_KEY ? 'global_all_roles' : 'global',
      insufficient: true,
      rank: percentileFromHistogram(gr.distribution, score),
      // k-anonymity (S3-1): in the CROSS-ACCOUNT global fallback, the pool-total floor
      // (gr.sample_size) is NOT enough — a single score band can still be backed by one
      // other tenant's candidate (e.g. advanced_n=1, advanced_rate=100). Suppress any
      // per-metric rate whose KNOWN-n is below the floor so a thin band can never surface
      // another tenant's identifiable outcome rate. (Only on the global path; an account's
      // OWN data is not anonymized against itself.)
      band: suppressThinBandRates(pickBand(gr.buckets, score), MIN_BAND_SAMPLE),
      overall: gr.outcome_rates,
      sampleSize: gr.sample_size,
    });
  }
  return local;
}

function pickBand(bucketArr, score) {
  const key = bucketForScore(score);
  return (bucketArr || []).find((b) => b.bucket === key) || null;
}

// k-anonymity guard for the cross-account global fallback: null out any per-metric rate
// whose known-n is below the floor (the anonymized counts are kept; only the small-sample
// RATE is withheld). Rates/lift that become null degrade gracefully (liftOf/likelihood
// already null-handle). Never applied to an account's own (in-tenant) data.
function suppressThinBandRates(band, floor) {
  if (!band) return null;
  const gate = (rate, n) => ((n || 0) >= floor ? rate : null);
  return {
    ...band,
    advanced_rate: gate(band.advanced_rate, band.advanced_n),
    offer_rate: gate(band.offer_rate, band.offer_n),
    hire_rate: gate(band.hire_rate, band.hire_n),
    retention_90d_rate: gate(band.retention_90d_rate, band.retention_90d_n),
  };
}

// Assemble the final, UI-ready calibration object (the single shape the frontend depends on).
function finalize({ score, roleFamily, scope, insufficient, rank, band, overall, sampleSize }) {
  const bandSufficient = !!(band && band.sufficient);
  const lk = likelihood({
    bandAdvancedRate: band ? band.advanced_rate : null,
    bandSufficient,
    topPercent: rank.top_percent,
    score,
  });
  // Cold-start estimate (empirical-Bayes): an ALWAYS-available, honestly-tiered advance rate for
  // this score's band, shrinking the observed outcomes toward a documented per-band prior. This is
  // what keeps calibration useful BEFORE enough labels exist to headline a raw band — the hard
  // `insufficient_data` flag and the calibrated `likelihood` above are unchanged; `estimate`
  // degrades smoothly (prior → provisional → calibrated) instead of collapsing to "no data".
  // Cross-account k-anonymity: on a GLOBAL scope we only fold the observed count into the posterior
  // once the band clears MIN_BAND_SAMPLE; below that we shrink from the prior alone, so a thin
  // global band can never surface another tenant's outcome through the posterior mean.
  const crossAccount = scope === 'global' || scope === 'global_all_roles';
  const useObserved = !!band && (!crossAccount || (band.advanced_n || 0) >= MIN_BAND_SAMPLE);
  const bucketKey = bucketForScore(score);
  const priorMean = COLD_START_PRIOR[bucketKey] != null ? COLD_START_PRIOR[bucketKey] : 0.45;
  const estimate = shrinkRate({
    selected: useObserved ? (band.advanced_selected || 0) : 0,
    n: useObserved ? (band.advanced_n || 0) : 0,
    priorMean,
  });
  return {
    score,
    role_family: roleFamily,
    scope, // role | account_all_roles | global | global_all_roles | heuristic
    insufficient_data: insufficient,
    sample_size: sampleSize, // labeled outcomes behind the band
    cohort_size: rank.n, // scored submissions behind the percentile
    percentile: rank.percentile,
    top_percent: rank.top_percent,
    band: band
      ? {
          bucket: band.bucket,
          n: band.n,
          sufficient: band.sufficient,
          advanced_rate: band.advanced_rate,
          advanced_n: band.advanced_n,
          offer_rate: band.offer_rate,
          offer_n: band.offer_n,
          hire_rate: band.hire_rate,
          hire_n: band.hire_n,
          retention_90d_rate: band.retention_90d_rate,
          retention_90d_n: band.retention_90d_n,
        }
      : null,
    overall,
    lift: band
      ? {
          advanced: liftOf(band.advanced_rate, overall.advanced_rate),
          offer: liftOf(band.offer_rate, overall.offer_rate),
          hire: liftOf(band.hire_rate, overall.hire_rate),
        }
      : { advanced: null, offer: null, hire: null },
    likelihood: lk,
    // Additive cold-start block: smooth prior→provisional→calibrated estimate + 90% credible band.
    estimate,
  };
}

// Account-level "your bar vs. outcomes": per-role reports + a few recent scored results with
// their calibration pre-attached (so the Benchmarks page can render badges with no extra calls).
async function summaryFor(accountId) {
  const rows = await fetchRows(accountId);
  const roles = [];
  const byRole = new Map();
  for (const r of rows) {
    const key = r.role_family || '—';
    if (!byRole.has(key)) byRole.set(key, []);
    byRole.get(key).push(r);
  }
  for (const [key, group] of byRole.entries()) {
    const roleFamily = key === '—' ? null : key;
    roles.push(reportFromRows(group, roleFamily));
  }
  roles.sort((a, b) => b.scored_size - a.scored_size);

  const overall = reportFromRows(rows, null);

  // A handful of the most-recent scored results, each with its calibration PRE-ATTACHED
  // (computed from the rows already in memory — no extra round-trips). Lets the Benchmarks
  // page render real CalibrationBadges out of the box: "a scored result shows percentile + band".
  const recent = [...rows]
    .filter((r) => r.score_id && Number.isFinite(toNum(r.score)))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 6)
    .map((r) => ({
      score_id: r.score_id,
      submission_id: r.submission_id,
      created_at: r.created_at,
      labeled: r.labeled,
      ...computeCalibration({ score: r.score, roleFamily: r.role_family, rows }),
    }));

  return {
    account_total_scored: rows.length,
    account_total_labeled: rows.filter((r) => r.labeled).length,
    min_role_sample: MIN_ROLE_SAMPLE,
    min_band_sample: MIN_BAND_SAMPLE,
    overall: {
      distribution: overall.distribution,
      percentiles: overall.percentiles,
      buckets: overall.buckets,
      outcome_rates: overall.outcome_rates,
    },
    roles,
    recent,
  };
}

// Recompute + persist this account's snapshots (all-roles + per-role). On-demand / cron entry.
async function refreshSnapshots(accountId) {
  const rows = await fetchRows(accountId);
  const roleKeys = new Set([null]);
  for (const r of rows) if (r.role_family) roleKeys.add(r.role_family);
  let written = 0;
  for (const role of roleKeys) {
    await writeAccountSnapshot(accountId, role, reportFromRows(rows, role));
    written += 1;
  }
  return { account_id: accountId, snapshots_written: written, scored: rows.length };
}

// Recompute the cross-account GLOBAL anonymized aggregate (counts/rates only). Delete-then-insert
// keeps exactly one row per role_family without depending on Postgres NULL-uniqueness semantics.
async function refreshGlobalSnapshot() {
  const rows = await fetchRows(null); // whole corpus
  const roleKeys = new Set([GLOBAL_KEY]);
  for (const r of rows) if (r.role_family) roleKeys.add(r.role_family);

  await supabaseAdmin.from('calibration_snapshots').delete().eq('scope', 'global');
  const now = new Date().toISOString();
  const payloadRows = [];
  let suppressed = 0;
  for (const role of roleKeys) {
    const roleFamily = role === GLOBAL_KEY ? null : role;
    // k-anonymity (S3-2): only publish a global aggregate that combines ≥ MIN_DISTINCT_ACCOUNTS
    // distinct tenants. Below the floor we DON'T write the row at all; the read path
    // (calibrationForScore) then finds no global snapshot and honestly degrades to the
    // score-only heuristic (insufficient_data) instead of leaking one tenant's rates.
    if (distinctAccountCount(rows, roleFamily) < MIN_DISTINCT_ACCOUNTS) { suppressed += 1; continue; }
    const report = reportFromRows(rows, roleFamily);
    payloadRows.push({
      scope: 'global',
      account_id: null,
      role_family: role, // GLOBAL_KEY for all-roles
      ...reportToSnapshotPayload(report),
      computed_at: now,
    });
  }
  if (payloadRows.length) {
    const { error } = await supabaseAdmin.from('calibration_snapshots').insert(payloadRows);
    if (error) throw new Error(error.message);
  }
  return { scope: 'global', roles: payloadRows.length, suppressed_below_k: suppressed, scored: rows.length };
}

module.exports = {
  // public service API
  roleReport,
  accountRoles,
  calibrationForScore,
  computeCalibration,
  summaryFor,
  refreshSnapshots,
  refreshGlobalSnapshot,
  fetchRows,
  // pure helpers (exported for unit tests + reuse)
  rankStats,
  quantiles,
  quantileSorted,
  histogram,
  knownRate,
  rateBlock,
  bands,
  liftOf,
  likelihood,
  percentileFromHistogram,
  suppressThinBandRates,
  // cold-start (empirical-Bayes) helpers + priors
  shrinkRate,
  betai,
  betaQuantile,
  lgamma,
  PRIOR_STRENGTH,
  COLD_START_PRIOR,
  reportFromRows,
  // constants
  MIN_ROLE_SAMPLE,
  MIN_BAND_SAMPLE,
  MIN_DISTINCT_ACCOUNTS,
  distinctAccountCount,
  SNAPSHOT_TTL_MS,
  GLOBAL_KEY,
  snapshotIsFresh,
  readSnapshot,
  snapshotToReport,
};
