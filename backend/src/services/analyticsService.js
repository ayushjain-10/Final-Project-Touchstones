/**
 * analyticsService — the proof-of-value aggregates behind /app/insights.
 * -------------------------------------------------------------------------
 * Everything here is a REAL aggregate over the recruiter's own data:
 *   pipeline funnel · per-role score distribution · throughput/time · ROI.
 *
 * Two design rules this file follows (the v3 honesty + security baseline):
 *  1) No fabricated/hardcoded numbers served as live. The ROI math takes the
 *     recruiter's assumptions (hours-per-onsite, loaded hourly cost) as INPUTS
 *     and multiplies them by real counts — the defaults here are *defaults the
 *     UI shows as editable*, never values baked into a served figure. Every
 *     output ships with the inputs + counts it was derived from.
 *  2) Account/tenant scoping. Only work_samples carries owner_id; submissions,
 *     scores and outcomes are reached by joining up to it. So we resolve the
 *     owned work_sample ids via the RLS-scoped client (owner_id = auth.uid())
 *     and only then read the child rows by those ids with the service-role
 *     client — never a cross-tenant read. (Same pattern as proof.js /metrics
 *     and outcomes.js /calibration.)
 *
 * The compute* functions are PURE (no DB, no clock-as-input beyond the rows'
 * own timestamps) so they unit-test directly: output = inputs × real counts.
 */

const { supabaseAdmin } = require('../config/supabase');

// Sensible DEFAULT assumptions. These are surfaced to the recruiter as editable
// inputs (frontend) and only used when a request omits the param — they are NOT
// constants baked into any served dollar/hours figure.
const DEFAULT_HOURS_PER_ONSITE = 4; // senior-eng hours a first-round onsite/take-home review costs
const DEFAULT_HOURLY_COST = 150; // loaded senior-engineer hourly cost (USD)

// Submission statuses that mean "the candidate finished the screen". status is a
// free-form TEXT column (no CHECK), so we treat the whole post-submit superset
// defensively rather than just literal 'submitted'.
const SUBMITTED_STATUSES = new Set(['submitted', 'scored', 'pending_scoring', 'needs_review']);

const isSubmitted = (s) => !!s.submitted_at || SUBMITTED_STATUSES.has(s.status);

// ── pure helpers ──────────────────────────────────────────────────────────

function median(nums) {
  const xs = (nums || []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// minutes between two timestamps, or null if either missing / negative.
function minutesBetween(a, b) {
  if (!a || !b) return null;
  const d = (new Date(b).getTime() - new Date(a).getTime()) / 60000;
  return Number.isFinite(d) && d >= 0 ? d : null;
}

const yyyymmdd = (ts) => (typeof ts === 'string' ? ts : new Date(ts).toISOString()).slice(0, 10);

// Split an id list into <=200-id chunks so a large account never blows past the
// PostgREST URL length limit on `.in()` (mirrors calibrationService.fetchRows).
const chunked = (arr, size = 200) => {
  const out = [];
  for (let i = 0; i < (arr || []).length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/**
 * Enrich raw submissions with their LIVE score + outcome label so the compute
 * functions work on one flat row per candidate-attempt.
 *   submissions: [{ id, work_sample_id, started_at, submitted_at, status, created_at }]
 *   scores:      [{ submission_id, normalized_score, outcome, created_at, superseded_by }]
 *   outcomes:    [{ submission_id, advanced, got_offer, hired, retained_90d, labeled_at }]
 * LIVE score = the latest row per submission with superseded_by === null (re-scores
 * append + supersede; counting all rows would double-count).
 */
function enrich(submissions, scores, outcomes) {
  const liveScore = new Map();
  for (const sc of scores || []) {
    if (sc.superseded_by) continue; // only the live score counts
    const prev = liveScore.get(sc.submission_id);
    if (!prev || new Date(sc.created_at) > new Date(prev.created_at)) liveScore.set(sc.submission_id, sc);
  }
  const outcomeBy = new Map();
  for (const o of outcomes || []) outcomeBy.set(o.submission_id, o);

  return (submissions || []).map((s) => {
    const score = liveScore.get(s.id) || null;
    const outcome = outcomeBy.get(s.id) || null;
    return {
      id: s.id,
      created_at: s.created_at,
      started_at: s.started_at,
      submitted_at: s.submitted_at,
      status: s.status,
      submitted: isSubmitted(s),
      // "scored" === a live proof_score exists (the funnel basis); status is just
      // reconciled to match, so we key off the score itself to never overcount.
      scored: !!score,
      score: score ? score.normalized_score : null,
      score_at: score ? score.created_at : null,
      advanced: outcome ? outcome.advanced : null,
      got_offer: outcome ? outcome.got_offer : null,
      hired: outcome ? outcome.hired : null,
      retained_90d: outcome ? outcome.retained_90d : null,
      labeled_at: outcome ? outcome.labeled_at : null,
    };
  });
}

/**
 * computeFunnel(rows) — the 8-stage hiring pipeline funnel, per the product spec:
 *   created → started → submitted → scored → advanced → offer → hired → stayed-90d.
 * Each stage is a REAL count of a row predicate. conversion_from_prev /
 * conversion_from_top are percentages (1 decimal). drop_off_from_prev flags the
 * single biggest leak. Returns { stages, total, biggest_dropoff }.
 *
 * Note on basis: started_at is set when a screen is ASSIGNED (the clock starts),
 * so "created" and "started" coincide in this data model — we report both for
 * completeness and label the basis honestly rather than invent a fake step.
 */
function computeFunnel(rows) {
  const r = rows || [];
  const count = (pred) => r.filter(pred).length;

  const defs = [
    { key: 'created', label: 'Screens sent', basis: 'work_sample_submissions row exists', pred: () => true },
    { key: 'started', label: 'Started', basis: 'started_at set (clock began at assignment)', pred: (x) => !!x.started_at },
    { key: 'submitted', label: 'Submitted', basis: 'candidate submitted the screen', pred: (x) => x.submitted },
    { key: 'scored', label: 'Scored', basis: 'a live proof_score exists', pred: (x) => x.scored },
    { key: 'advanced', label: 'Advanced', basis: 'outcome label advanced = true', pred: (x) => x.advanced === true },
    { key: 'offer', label: 'Offer', basis: 'outcome label got_offer = true', pred: (x) => x.got_offer === true },
    { key: 'hired', label: 'Hired', basis: 'outcome label hired = true', pred: (x) => x.hired === true },
    { key: 'retained_90d', label: 'Stayed 90 days', basis: 'outcome label retained_90d = true', pred: (x) => x.retained_90d === true },
  ];

  const top = r.length;
  let prev = null;
  const stages = defs.map((d) => {
    const c = count(d.pred);
    const fromPrev = prev === null ? 100 : prev > 0 ? round1((c / prev) * 100) : null;
    const fromTop = top > 0 ? round1((c / top) * 100) : null;
    const stage = {
      key: d.key,
      label: d.label,
      basis: d.basis,
      count: c,
      conversion_from_prev: fromPrev,
      conversion_from_top: fromTop,
      drop_from_prev: prev === null ? 0 : Math.max(0, prev - c),
    };
    prev = c;
    return stage;
  });

  // biggest single-step leak (ignore the synthetic created→created start)
  let biggest = null;
  for (let i = 1; i < stages.length; i++) {
    if (biggest === null || stages[i].drop_from_prev > stages[biggest].drop_from_prev) biggest = i;
  }

  return {
    stages,
    total: top,
    biggest_dropoff:
      biggest !== null && stages[biggest].drop_from_prev > 0
        ? { from: stages[biggest - 1].key, to: stages[biggest].key, lost: stages[biggest].drop_from_prev }
        : null,
  };
}

/**
 * computeThroughput(rows, { days }) — time + volume.
 *   time-to-submit  = submitted_at − started_at   (assignment → submit)
 *   time-to-score   = score_at − submitted_at      (submit → scored)
 *   time-to-decision= labeled_at − submitted_at     (submit → recorded outcome)
 *   volume          = per-day counts of created / submitted / scored.
 * Medians in minutes (sub-day) and the volume series for the window chart.
 */
function computeThroughput(rows, { days } = {}) {
  const r = rows || [];

  const toSubmit = r.map((x) => minutesBetween(x.started_at, x.submitted_at)).filter((m) => m !== null);
  const toScore = r.map((x) => minutesBetween(x.submitted_at, x.score_at)).filter((m) => m !== null);
  const toDecision = r.map((x) => minutesBetween(x.submitted_at, x.labeled_at)).filter((m) => m !== null);

  // per-day volume buckets
  const vol = new Map();
  const bump = (ts, field) => {
    if (!ts) return;
    const d = yyyymmdd(ts);
    if (!vol.has(d)) vol.set(d, { date: d, created: 0, submitted: 0, scored: 0 });
    vol.get(d)[field]++;
  };
  for (const x of r) {
    bump(x.created_at, 'created');
    if (x.submitted) bump(x.submitted_at || x.created_at, 'submitted');
    if (x.scored) bump(x.score_at || x.submitted_at || x.created_at, 'scored');
  }
  const volume = [...vol.values()].sort((a, b) => a.date.localeCompare(b.date));

  return {
    window_days: days != null ? Number(days) : null,
    counts: { total: r.length, submitted: r.filter((x) => x.submitted).length, scored: r.filter((x) => x.scored).length },
    median_minutes_to_submit: roundOrNull(median(toSubmit)),
    median_minutes_to_score: roundOrNull(median(toScore)),
    median_hours_to_decision: toDecision.length ? round1(median(toDecision) / 60) : null,
    samples: { to_submit: toSubmit.length, to_score: toScore.length, to_decision: toDecision.length },
    volume,
  };
}

/**
 * countsForRoi(rows) — the REAL counts the ROI multiplies. Kept separate from the
 * arithmetic so a test can prove "output = inputs × counts" with hand-built counts.
 *   completed = finished screens (each stands in for a first-round onsite)
 *   advanced  = candidates the recruiter advanced to an actual onsite
 *   qualified = advanced (the recruiter's own "qualified to proceed" signal)
 */
function countsForRoi(rows) {
  const r = rows || [];
  const completed = r.filter((x) => x.submitted).length;
  const scored = r.filter((x) => x.scored).length;
  const advanced = r.filter((x) => x.advanced === true).length;
  const offers = r.filter((x) => x.got_offer === true).length;
  const hires = r.filter((x) => x.hired === true).length;
  const retained = r.filter((x) => x.retained_90d === true).length;
  return { completed, scored, advanced, offers, hires, retained, qualified: advanced };
}

/**
 * computeRoi(counts, { hoursPerOnsite, hourlyCost }) — PURE. The headline a
 * founder sells, derived entirely from real counts × the recruiter's editable
 * assumptions. Returns the inputs, the counts, and the results so the UI is
 * honest about the basis of every number.
 *
 *   onsites_avoided  = completed   (each finished screen did the first-round
 *                      technical screening — a take-home / phone screen — that a
 *                      senior engineer would otherwise have run. This is a pure
 *                      count of real completed screens, NOT corrected by outcome
 *                      labels, so missing labels can never inflate it.)
 *   hours_saved      = onsites_avoided × hoursPerOnsite
 *   dollars_saved    = hours_saved × hourlyCost   (from the ROUNDED hours, so
 *                      hours_saved × hourlyCost always reconciles to dollars_saved)
 *   cost_per_qualified = (completed × hoursPerOnsite × hourlyCost) / qualified
 *                      (what onsiting everyone to surface each qualified
 *                       candidate would have cost in senior-eng time; null until
 *                       there is at least one advanced/qualified candidate)
 */
function computeRoi(counts, assumptions) {
  const c = counts || {};
  const hoursPerOnsite = sanitizeNum(assumptions && assumptions.hoursPerOnsite, DEFAULT_HOURS_PER_ONSITE);
  const hourlyCost = sanitizeNum(assumptions && assumptions.hourlyCost, DEFAULT_HOURLY_COST);

  const completed = num(c.completed);
  const advanced = num(c.advanced);
  const qualified = num(c.qualified != null ? c.qualified : c.advanced);

  // Pure volume basis: every completed screen replaced a first-round screening
  // onsite/take-home. No label dependency → unlabeled accounts are not inflated.
  const onsites_avoided = completed;
  const hours_saved = round1(onsites_avoided * hoursPerOnsite);
  const dollars_saved = Math.round(hours_saved * hourlyCost);
  const cost_per_qualified =
    qualified > 0 ? Math.round((completed * hoursPerOnsite * hourlyCost) / qualified) : null;

  return {
    inputs: { hoursPerOnsite, hourlyCost },
    defaults: { hoursPerOnsite: DEFAULT_HOURS_PER_ONSITE, hourlyCost: DEFAULT_HOURLY_COST },
    counts: {
      completed,
      scored: num(c.scored),
      advanced,
      offers: num(c.offers),
      hires: num(c.hires),
      retained: num(c.retained),
      qualified,
    },
    results: {
      onsites_avoided,
      hours_saved,
      dollars_saved,
      cost_per_qualified,
    },
    basis: {
      onsites_avoided: 'completed screens — each replaced a first-round technical screen / take-home',
      hours_saved: 'onsites avoided × your hours-per-onsite',
      dollars_saved: 'hours saved × your loaded hourly cost',
      cost_per_qualified:
        'senior-eng onsite cost to surface one qualified candidate by onsiting everyone (completed × hours × cost ÷ qualified)',
    },
  };
}

// ── small numeric utils ────────────────────────────────────────────────────
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : n);
const roundOrNull = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n));
// clamp an assumption to a sane non-negative range; fall back to the default if absent/invalid.
function sanitizeNum(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, 1e6); // guard absurd inputs
}

// ── tenant-scoped data fetch ───────────────────────────────────────────────

/**
 * loadRows(reqUser, { role, days, rolesOnly }) — resolve the requester's owned,
 * non-archived work_samples (RLS-scoped on owner_id), then read the child
 * submissions/scores/outcomes for ONLY those screens (service-role, filtered by
 * the resolved ids, chunked to stay under the URL limit). Returns { rows, roles,
 * screens }. No cross-tenant rows can appear: every id traces back to
 * owner_id = req.user.id. rolesOnly short-circuits after step 1 (for the role
 * picker) so it never loads the full submission set.
 */
async function loadRows(reqUser, { role = null, days = null, rolesOnly = false } = {}) {
  // 1) owned screens (tenant boundary). role filter applied here on role_family.
  let q = reqUser.supabase
    .from('work_samples')
    .select('id, role_family, title, status')
    .eq('owner_id', reqUser.id)
    .neq('status', 'archived');
  if (role) q = q.eq('role_family', role);
  const { data: samples, error: e0 } = await q;
  if (e0) throw new Error(e0.message);
  const screens = samples || [];
  const ids = screens.map((s) => s.id);
  const roles = [...new Set(screens.map((s) => s.role_family).filter(Boolean))].sort();
  if (rolesOnly || !ids.length) return { rows: [], roles, screens };

  // 2) submissions for those screens (service-role; explicit id filter = the gate;
  //    chunked so a large account never overflows the PostgREST URL on `.in()`).
  const since = days != null ? new Date(Date.now() - Number(days) * 86400000).toISOString() : null;
  const submissions = [];
  for (const chunk of chunked(ids)) {
    let sq = supabaseAdmin
      .from('work_sample_submissions')
      .select('id, work_sample_id, started_at, submitted_at, status, created_at')
      .in('work_sample_id', chunk);
    if (since) sq = sq.gte('created_at', since);
    const { data, error } = await sq;
    if (error) throw new Error(error.message);
    if (data) submissions.push(...data);
  }
  const subIds = submissions.map((s) => s.id);
  if (!subIds.length) return { rows: [], roles, screens };

  // 3) live scores + outcome labels for those submissions (chunked the same way).
  const scores = [];
  const outcomes = [];
  for (const chunk of chunked(subIds)) {
    const [{ data: sc, error: e2 }, { data: oc, error: e3 }] = await Promise.all([
      supabaseAdmin
        .from('proof_scores')
        .select('submission_id, normalized_score, outcome, created_at, superseded_by')
        .in('submission_id', chunk),
      supabaseAdmin
        .from('submission_outcomes')
        .select('submission_id, advanced, got_offer, hired, retained_90d, labeled_at')
        .in('submission_id', chunk),
    ]);
    if (e2) throw new Error(e2.message);
    if (e3) throw new Error(e3.message);
    if (sc) scores.push(...sc);
    if (oc) outcomes.push(...oc);
  }

  return { rows: enrich(submissions, scores, outcomes), roles, screens };
}

module.exports = {
  // route-facing
  loadRows,
  // pure aggregators (unit-tested directly)
  enrich,
  computeFunnel,
  computeThroughput,
  countsForRoi,
  computeRoi,
  // helpers / constants
  median,
  minutesBetween,
  isSubmitted,
  sanitizeNum,
  DEFAULT_HOURS_PER_ONSITE,
  DEFAULT_HOURLY_COST,
};
