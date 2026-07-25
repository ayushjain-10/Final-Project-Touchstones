/**
 * Benchmarks API — the data moat, made queryable (CC3 / Calibrated Score + Benchmarks).
 * --------------------------------------------------------------------------------------
 * Mounted at /api/benchmarks. Every read is ACCOUNT-scoped:
 *
 *   GET  /score/:scoreId  → percentile + outcome-calibrated band + sample size for ONE result
 *   GET  /roles/:role     → the score distribution + outcome bands for a role family
 *   GET  /summary         → account-level "your bar vs. outcomes" (all roles + overall)
 *   POST /refresh         → recompute + persist this account's calibration_snapshots (on demand)
 *                           (scope=global, cron-secret gated, recomputes the anonymized global pool)
 *
 * Tenant safety: the per-result lookup gates on an RLS-scoped read of proof_scores (the owner —
 * or the candidate — can read it; anyone else gets 404). The aggregates run through the service
 * layer with an EXPLICIT owner filter, and any cross-account pool is anonymized COUNTS only — a
 * caller can never see another tenant's rows. Source of truth is the live aggregate; snapshots
 * are a recompute-able cache (calibrationService).
 */
const express = require('express');
const router = express.Router();
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const calibrationService = require('../../services/calibrationService');

router.use(supabaseAuth);

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });
// '_all' / '*' in the path means "all roles" (the null role_family bucket).
const normRole = (r) => {
  const v = decodeURIComponent(r || '');
  return v === '' || v === '_all' || v === '*' ? null : v;
};

// GET /api/benchmarks/score/:scoreId — the compact calibration object for one scored result.
// This is exactly the object the result API can embed next to a score (the CalibrationBadge).
router.get('/score/:scoreId', async (req, res) => {
  try {
    if (!isUUID(req.params.scoreId)) return fail(res, 400, 'invalid id');
    // RLS-scoped read = the tenant gate. proof_scores' ps_recruiter policy lets the work-sample
    // owner (or the candidate) read this row; anyone else gets nothing → 404.
    const { data: score, error } = await req.user.supabase
      .from('proof_scores')
      .select('id, normalized_score, submission_id')
      .eq('id', req.params.scoreId)
      .single();
    if (error || !score) return fail(res, 404, 'score not found or not accessible');

    // Resolve the role family via submission → work_sample, still under RLS.
    let roleFamily = null;
    const { data: sub } = await req.user.supabase
      .from('work_sample_submissions')
      .select('work_sample_id')
      .eq('id', score.submission_id)
      .single();
    if (sub) {
      const { data: ws } = await req.user.supabase
        .from('work_samples')
        .select('role_family')
        .eq('id', sub.work_sample_id)
        .single();
      roleFamily = ws ? ws.role_family || null : null;
    }

    const calibration = await calibrationService.calibrationForScore({
      score: score.normalized_score,
      roleFamily,
      accountId: req.user.id,
    });
    res.json({ score_id: score.id, ...calibration });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// GET /api/benchmarks/roles/:role — the role's score distribution + outcome-calibrated bands.
router.get('/roles/:role', async (req, res) => {
  try {
    const role = normRole(req.params.role);
    const report = await calibrationService.roleReport(req.user.id, role);
    res.json({
      ...report,
      insufficient_data: report.sample_size < calibrationService.MIN_BAND_SAMPLE,
      thresholds: {
        min_role_sample: calibrationService.MIN_ROLE_SAMPLE,
        min_band_sample: calibrationService.MIN_BAND_SAMPLE,
      },
    });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// GET /api/benchmarks/summary — account-level overview (every role + the overall pool).
router.get('/summary', async (req, res) => {
  try {
    const summary = await calibrationService.summaryFor(req.user.id);
    res.json(summary);
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// POST /api/benchmarks/refresh — recompute this account's snapshots (on demand). With
// ?scope=global (cron-secret gated) recomputes the cross-account anonymized pool.
router.post('/refresh', async (req, res) => {
  try {
    const scope = req.query.scope || (req.body && req.body.scope) || 'account';
    if (scope === 'global') {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.get('x-cron-secret') !== secret) {
        return fail(res, 403, 'global refresh requires a valid cron secret');
      }
      const out = await calibrationService.refreshGlobalSnapshot();
      return res.json(out);
    }
    const out = await calibrationService.refreshSnapshots(req.user.id);
    res.json(out);
  } catch (e) {
    fail(res, 500, e.message);
  }
});

module.exports = router;
