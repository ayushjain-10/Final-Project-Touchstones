/**
 * Outcome flywheel (Feature 1 of the compounding moat) — /api/outcomes/...
 * --------------------------------------------------------------------------
 * The real moat: the data nobody else collects. After a recruiter screens with a
 * Touchstone, they tell us what HAPPENED downstream — did the candidate advance, get
 * an offer, get hired, stay 90 days. Joined back to the proof score, these labels are
 * the calibration signal that compounds: over time we learn which score bands actually
 * predict offers/hires/retention, per recruiter and in aggregate.
 *
 * Ownership: the recruiter who owns the work_sample owns the outcome label. RLS policy
 * `outcomes_owner` (migration 029) already enforces this for reads/writes through the
 * token-scoped client; we additionally gate every mutation behind an RLS-scoped read.
 */
const express = require('express');
const router = express.Router();
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const { supabaseAdmin } = require('../../config/supabase');

router.use(supabaseAuth);

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// Only these four are tri-state outcome labels; everything else on the body is ignored.
const LABEL_KEYS = ['advanced', 'got_offer', 'hired', 'retained_90d'];
// Coerce to boolean | null (null = "unknown / not yet"), never undefined → keeps the
// upsert idempotent and lets a recruiter clear a label by sending null.
const triState = (v) => (v === null || v === undefined ? null : Boolean(v));

// ── Calibration bucketing (PURE — unit-tested in tests/unit) ──
// A 0-100 score lands in exactly one band. Kept in code (not SQL) so the bucket
// boundaries are versioned with the app and the same helper backs both the API and tests.
const SCORE_BUCKETS = [
  { key: '0-59', min: 0, max: 59 },
  { key: '60-79', min: 60, max: 79 },
  { key: '80-100', min: 80, max: 100 },
];

// Below this many labeled submissions in a band, its outcome rates are too noisy to headline
// (n=1 trivially reads 100%/100%/100%). We don't hide the rates — we FLAG the band so the UI can
// render "not enough data yet" instead of a misleading perfect score. (calibrationService uses a
// stricter 8 for its single headline band; 5 is the honest floor for these per-band displays.)
const MIN_CALIBRATION_BUCKET_N = 5;

function bucketForScore(score) {
  // A missing score is unbucketable (don't let Number(null)=0 silently bucket it as 0-59).
  if (score === null || score === undefined || score === '') return null;
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.max(0, Math.min(100, n));
  for (const b of SCORE_BUCKETS) {
    if (clamped >= b.min && clamped <= b.max) return b.key;
  }
  return null;
}

// Aggregate {score, outcome} rows into per-bucket rates. NO PII in or out — only the
// score band and the rate counts. A rate is null when the denominator is 0 (so the UI can
// say "not enough data yet" instead of showing a misleading 0%).
function calibrate(rows) {
  const acc = {};
  for (const b of SCORE_BUCKETS) {
    acc[b.key] = {
      bucket: b.key,
      n: 0,
      offers: 0,
      offers_known: 0,
      hires: 0,
      hires_known: 0,
      retained: 0,
      retained_known: 0,
    };
  }
  for (const r of rows || []) {
    const key = bucketForScore(r.score);
    if (!key) continue;
    const cell = acc[key];
    cell.n += 1;
    // Each rate is over its KNOWN denominator only: null (unknown / not-yet) is excluded from
    // BOTH numerator and denominator, so an unlabeled outcome never silently drags a rate down.
    if (r.got_offer === true) {
      cell.offers += 1;
      cell.offers_known += 1;
    } else if (r.got_offer === false) {
      cell.offers_known += 1;
    }
    if (r.hired === true) {
      cell.hires += 1;
      cell.hires_known += 1;
    } else if (r.hired === false) {
      cell.hires_known += 1;
    }
    if (r.retained_90d === true) {
      cell.retained += 1;
      cell.retained_known += 1;
    } else if (r.retained_90d === false) {
      cell.retained_known += 1;
    }
  }
  return SCORE_BUCKETS.map((b) => {
    const c = acc[b.key];
    const rate = (num, known) => (known > 0 ? Math.round((num / known) * 1000) / 10 : null); // 1 decimal %
    return {
      bucket: b.key,
      n: c.n,
      offer_rate: rate(c.offers, c.offers_known),
      hire_rate: rate(c.hires, c.hires_known),
      retention_90d_rate: rate(c.retained, c.retained_known),
      // Low-sample flag so the UI can degrade to "not enough data yet" instead of headlining a
      // trivially-perfect rate from n=1. Additive/non-breaking: existing rate fields are unchanged.
      sufficient: c.n >= MIN_CALIBRATION_BUCKET_N,
    };
  });
}

// POST /api/outcomes/submissions/:id — recruiter upserts the outcome labels.
router.post('/submissions/:id', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    // ownership gate: requester must be able to read this submission under RLS (recruiter
    // owns the work sample → can read the submission; a candidate could read their own
    // submission, but the outcomes_owner WITH CHECK below restricts the WRITE to the owner).
    const { data: sub } = await req.user.supabase
      .from('work_sample_submissions').select('id').eq('id', req.params.id).single();
    if (!sub) return fail(res, 404, 'submission not found or not accessible');

    const body = req.body || {};
    const row = {
      submission_id: req.params.id,
      labeled_by: req.user.id,
      labeled_at: new Date().toISOString(),
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 4000) : null,
    };
    for (const k of LABEL_KEYS) row[k] = triState(body[k]);

    // Upsert keyed on the UNIQUE(submission_id) constraint. Written through the RLS-scoped
    // client so the outcomes_owner policy (owner of the work sample) is the write gate.
    const { data, error } = await req.user.supabase
      .from('submission_outcomes')
      .upsert(row, { onConflict: 'submission_id' })
      .select().single();
    if (error) return fail(res, 403, error.message);
    res.status(201).json(data);
  } catch (e) { fail(res, 500, e.message); }
});

// GET /api/outcomes/submissions/:id — read the outcome label.
router.get('/submissions/:id', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { data, error } = await req.user.supabase
      .from('submission_outcomes').select('*').eq('submission_id', req.params.id).maybeSingle();
    if (error) return fail(res, 403, error.message);
    if (!data) return fail(res, 404, 'no outcome recorded');
    res.json(data);
  } catch (e) { fail(res, 500, e.message); }
});

// GET /api/outcomes/calibration — per-score-band offer/hire/retention rates for the
// owner's submissions. No PII: we join proof_scores → submission_outcomes for work_samples
// owned by req.user.id, then aggregate in code. The ownership filter is explicit
// (owner_id = req.user.id) so the service-role read can never leak another tenant's data.
router.get('/calibration', async (req, res) => {
  try {
    // 1) work samples owned by the requester (the tenant boundary for this aggregate).
    const { data: samples, error: e0 } = await supabaseAdmin
      .from('work_samples').select('id').eq('owner_id', req.user.id);
    if (e0) return fail(res, 500, e0.message);
    const wsIds = (samples || []).map((s) => s.id);
    if (!wsIds.length) return res.json({ buckets: calibrate([]), total_labeled: 0 });

    // 2) submissions for those work samples.
    const { data: subs, error: e1 } = await supabaseAdmin
      .from('work_sample_submissions').select('id').in('work_sample_id', wsIds);
    if (e1) return fail(res, 500, e1.message);
    const subIds = (subs || []).map((s) => s.id);
    if (!subIds.length) return res.json({ buckets: calibrate([]), total_labeled: 0 });

    // 3) latest score per submission + its outcome label. Pull both keyed by submission_id
    //    and stitch in code (no PII columns selected — only score band + outcome flags).
    const [{ data: scores, error: e2 }, { data: outcomes, error: e3 }] = await Promise.all([
      supabaseAdmin.from('proof_scores')
        .select('submission_id, normalized_score, created_at, superseded_by')
        .in('submission_id', subIds),
      supabaseAdmin.from('submission_outcomes')
        .select('submission_id, got_offer, hired, retained_90d')
        .in('submission_id', subIds),
    ]);
    if (e2) return fail(res, 500, e2.message);
    if (e3) return fail(res, 500, e3.message);

    // latest non-superseded score per submission
    const latestScore = new Map();
    for (const s of scores || []) {
      if (s.superseded_by) continue;
      const prev = latestScore.get(s.submission_id);
      if (!prev || new Date(s.created_at) > new Date(prev.created_at)) latestScore.set(s.submission_id, s);
    }
    const rows = [];
    for (const o of outcomes || []) {
      const sc = latestScore.get(o.submission_id);
      if (!sc) continue; // an outcome with no score can't be calibrated
      rows.push({ score: sc.normalized_score, got_offer: o.got_offer, hired: o.hired, retained_90d: o.retained_90d });
    }

    res.json({ buckets: calibrate(rows), total_labeled: rows.length });
  } catch (e) { fail(res, 500, e.message); }
});

module.exports = router;
// Expose the pure calibration helpers for unit tests (env-independent).
module.exports.bucketForScore = bucketForScore;
module.exports.calibrate = calibrate;
module.exports.SCORE_BUCKETS = SCORE_BUCKETS;
