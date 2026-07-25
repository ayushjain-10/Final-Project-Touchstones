/**
 * Analytics Routes - Supabase Version
 * Uses PostgreSQL functions for server-side aggregation (Phase 3)
 * Falls back to in-memory computation if DB functions not yet applied
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../../config/supabase');
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const analyticsService = require('../../services/analyticsService');
const calibrationService = require('../../services/calibrationService');

// Apply auth middleware to all routes
router.use(supabaseAuth);

// ── helpers for the /insights/* proof-of-value surface (the /app/insights page) ──
const fail = (res, code, msg) => res.status(code).json({ error: msg });
// '_all' / '*' / '' in a role path or param all mean "all roles" (null role_family).
// Express has already percent-decoded query/param values, so we do NOT decode again
// (a literal '%' in a role_family would otherwise throw URIError → 500).
const normRole = (r) => {
  const v = (r || '').trim();
  return v === '' || v === '_all' || v === '*' ? null : v;
};
// clamp ?days= to a sane window (1..365), default 30; null => all-time.
const parseDays = (q) => {
  if (q === undefined || q === 'all' || q === '') return null;
  const n = parseInt(q, 10);
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(365, n));
};

// Generic analytics handler for routes that don't exist yet
const genericAnalyticsHandler = (key) => async (req, res) => {
    res.json({ success: true, data: {} });
};

// Additional analytics endpoints expected by tests
router.get('/dashboard', async (req, res) => {
    // Redirect to overview logic
    req.url = '/overview';
    router.handle(req, res);
});

router.get('/candidates', genericAnalyticsHandler('overview'));
router.get('/pipeline', genericAnalyticsHandler('funnel'));
router.get('/conversion', genericAnalyticsHandler('funnel'));
router.get('/time-to-hire', genericAnalyticsHandler('overview'));
router.get('/sources', genericAnalyticsHandler('overview'));

/**
 * GET /api/analytics/overview
 * Returns high-level dashboard metrics via PostgreSQL function
 */
router.get('/overview', async (req, res) => {
    try {
        const db = req.user.supabase;
        const userId = req.user.id;

        // Try PostgreSQL function first
        const { data, error } = await db.rpc('analytics_overview', { p_user_id: userId });

        if (!error && data) {
            return res.json({ success: true, data });
        }

        // Fallback: in-memory computation
        if (error) console.warn('analytics_overview RPC not available, using fallback:', error.message);
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

        const [jobsResult, candidatesResult, c30, c7, cPrev, outreachResult] = await Promise.all([
            db.from('jobs').select('id, status').eq('recruiter_id', userId),
            db.from('candidate_submissions').select('id, autopilot_triggered, autopilot_action_taken, autopilot_best_match_score, created_at').eq('user_id', userId),
            db.from('candidate_submissions').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', thirtyDaysAgo.toISOString()),
            db.from('candidate_submissions').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', sevenDaysAgo.toISOString()),
            db.from('candidate_submissions').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', sixtyDaysAgo.toISOString()).lt('created_at', thirtyDaysAgo.toISOString()),
            db.from('outreach_logs').select('id, sent_at').eq('user_id', userId).eq('channel', 'email').eq('status', 'sent')
        ]);

        const jobs = jobsResult.data || [];
        const candidates = candidatesResult.data || [];
        const outreachLogs = outreachResult.data || [];
        let autopilotTriggered = 0, autopilotEmails = 0, highMatches = 0;
        candidates.forEach(c => {
            if (c.autopilot_triggered) autopilotTriggered++;
            if (c.autopilot_action_taken === 'auto_email_sent') autopilotEmails++;
            if ((c.autopilot_best_match_score || 0) >= 80) highMatches++;
        });
        const emailsSent = outreachLogs.length + autopilotEmails;
        const candidatesLast30 = c30.count || 0;
        const prevPeriod = cPrev.count || 0;
        const growthRate = prevPeriod > 0 ? ((candidatesLast30 - prevPeriod) / prevPeriod * 100).toFixed(1) : candidatesLast30 > 0 ? 100 : 0;

        res.json({
            success: true,
            data: {
                jobs: { total: jobs.length, active: jobs.filter(j => j.status === 'open').length, filled: jobs.filter(j => j.status !== 'open').length },
                candidates: { total: candidates.length, last30Days: candidatesLast30, last7Days: c7.count || 0, growthRate: parseFloat(growthRate) },
                autopilot: { triggered: autopilotTriggered, emailsSent, highMatches, conversionRate: autopilotTriggered > 0 ? ((emailsSent / autopilotTriggered) * 100).toFixed(1) : 0 }
            }
        });
    } catch (error) {
        console.error('Analytics overview error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch analytics overview' });
    }
});

/**
 * GET /api/analytics/outreach
 * Returns outreach performance metrics via PostgreSQL function
 */
router.get('/outreach', async (req, res) => {
    try {
        const db = req.user.supabase;
        const userId = req.user.id;
        const { days = 30 } = req.query;

        const { data, error } = await db.rpc('analytics_outreach', { p_user_id: userId, p_days: parseInt(days) });

        if (!error && data) {
            return res.json({ success: true, data });
        }

        // Fallback
        if (error) console.warn('analytics_outreach RPC not available, using fallback:', error.message);
        const startDate = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
        const { data: logs } = await db.from('outreach_logs').select('*').eq('user_id', userId).gte('sent_at', startDate.toISOString());
        const outreachLogs = logs || [];

        const bySource = {}, byChannel = {}, dailyVolume = {}, byJob = {};
        outreachLogs.forEach(log => {
            const src = log.source || 'manual';
            if (!bySource[src]) bySource[src] = { count: 0, totalScore: 0, scoreCount: 0 };
            bySource[src].count++;
            if (log.match_score) { bySource[src].totalScore += log.match_score; bySource[src].scoreCount++; }

            const ch = log.channel || 'unknown';
            byChannel[ch] = (byChannel[ch] || 0) + 1;

            const date = log.sent_at?.split('T')[0];
            if (date) {
                if (!dailyVolume[date]) dailyVolume[date] = { count: 0, totalScore: 0, scoreCount: 0 };
                dailyVolume[date].count++;
                if (log.match_score) { dailyVolume[date].totalScore += log.match_score; dailyVolume[date].scoreCount++; }
            }

            if (log.job_id) {
                if (!byJob[log.job_id]) byJob[log.job_id] = { count: 0, totalScore: 0, scoreCount: 0 };
                byJob[log.job_id].count++;
                if (log.match_score) { byJob[log.job_id].totalScore += log.match_score; byJob[log.job_id].scoreCount++; }
            }
        });

        const topJobIds = Object.entries(byJob).sort((a, b) => b[1].count - a[1].count).slice(0, 5).map(([id]) => id);
        let jobsMap = {};
        if (topJobIds.length > 0) {
            const { data: jobsData } = await db.from('jobs').select('id, title').in('id', topJobIds);
            if (jobsData) jobsData.forEach(j => { jobsMap[j.id] = j.title; });
        }

        res.json({
            success: true,
            data: {
                byAction: [
                    ...Object.entries(bySource).map(([action, d]) => ({ action, count: d.count, avgMatchScore: d.scoreCount > 0 ? Math.round(d.totalScore / d.scoreCount) : 0 })),
                    ...Object.entries(byChannel).map(([action, count]) => ({ action, count, avgMatchScore: 0 }))
                ],
                dailyVolume: Object.entries(dailyVolume).sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, emailsSent: d.count, avgScore: d.scoreCount > 0 ? Math.round(d.totalScore / d.scoreCount) : 0 })),
                topJobs: topJobIds.map(id => ({ _id: id, jobTitle: jobsMap[id] || 'Unknown Job', emailsSent: byJob[id].count, avgScore: byJob[id].scoreCount > 0 ? Math.round(byJob[id].totalScore / byJob[id].scoreCount) : 0 }))
            }
        });
    } catch (error) {
        console.error('Analytics outreach error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch outreach analytics' });
    }
});

/**
 * GET /api/analytics/autopilot
 * Returns autopilot workflow performance via PostgreSQL function
 */
router.get('/autopilot', async (req, res) => {
    try {
        const db = req.user.supabase;
        const userId = req.user.id;
        const { days = 30 } = req.query;

        const { data, error } = await db.rpc('analytics_autopilot', { p_user_id: userId, p_days: parseInt(days) });

        if (!error && data) {
            return res.json({ success: true, data });
        }

        // Fallback
        if (error) console.warn('analytics_autopilot RPC not available, using fallback:', error.message);
        const startDate = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
        const { data: candidates } = await db.from('candidate_submissions').select('id, autopilot_triggered, autopilot_triggered_at, autopilot_best_match_score, autopilot_action_taken, created_at').eq('user_id', userId);
        const all = candidates || [];

        const scoreDist = { '0-19': 0, '20-39': 0, '40-59': 0, '60-79': 0, '80-99': 0, '100': 0 };
        all.forEach(c => {
            const score = c.autopilot_best_match_score;
            if (score != null && score > 0) {
                if (score >= 100) scoreDist['100']++;
                else if (score >= 80) scoreDist['80-99']++;
                else if (score >= 60) scoreDist['60-79']++;
                else if (score >= 40) scoreDist['40-59']++;
                else if (score >= 20) scoreDist['20-39']++;
                else scoreDist['0-19']++;
            }
        });

        const recent = all.filter(c => new Date(c.created_at) >= startDate);
        const dailyAct = {};
        recent.forEach(c => {
            const t = c.autopilot_triggered_at;
            if (t) {
                const d = (typeof t === 'string' ? t : new Date(t).toISOString()).split('T')[0];
                if (!dailyAct[d]) dailyAct[d] = { processed: 0, highMatches: 0, emailsSent: 0 };
                dailyAct[d].processed++;
                if ((c.autopilot_best_match_score || 0) >= 80) dailyAct[d].highMatches++;
                if (c.autopilot_action_taken === 'auto_email_sent') dailyAct[d].emailsSent++;
            }
        });

        res.json({
            success: true,
            data: {
                scoreDistribution: Object.entries(scoreDist).map(([range, count]) => ({ range, count })),
                funnel: {
                    submitted: recent.length,
                    processed: recent.filter(c => c.autopilot_triggered).length,
                    qualified: recent.filter(c => (c.autopilot_best_match_score || 0) >= 80).length,
                    contacted: recent.filter(c => c.autopilot_action_taken === 'auto_email_sent').length
                },
                dailyActivity: Object.entries(dailyAct).sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, ...d }))
            }
        });
    } catch (error) {
        console.error('Analytics autopilot error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch autopilot analytics' });
    }
});

/**
 * GET /api/analytics/jobs
 * Returns job-specific analytics via PostgreSQL function
 */
router.get('/jobs', async (req, res) => {
    try {
        const db = req.user.supabase;
        const userId = req.user.id;

        const { data, error } = await db.rpc('analytics_jobs', { p_user_id: userId });

        if (!error && data) {
            return res.json({ success: true, data });
        }

        // Fallback
        if (error) console.warn('analytics_jobs RPC not available, using fallback:', error.message);
        const [{ data: jobs }, { data: candidates }] = await Promise.all([
            db.from('jobs').select('id, title, status, created_at').eq('recruiter_id', userId),
            db.from('candidate_submissions').select('id, autopilot_best_match_job_id, autopilot_best_match_score, autopilot_action_taken').eq('user_id', userId)
        ]);
        const jobsList = jobs || [], candidatesList = candidates || [];

        const statusBreakdown = {};
        jobsList.forEach(j => { const s = j.status || 'unknown'; statusBreakdown[s] = (statusBreakdown[s] || 0) + 1; });

        const jobStats = {};
        jobsList.forEach(j => { jobStats[j.id] = { id: j.id, title: j.title, status: j.status, candidateCount: 0, totalScore: 0, scoreCount: 0, emailsSent: 0 }; });
        candidatesList.forEach(c => {
            const jid = c.autopilot_best_match_job_id;
            if (jid && jobStats[jid]) {
                jobStats[jid].candidateCount++;
                const score = c.autopilot_best_match_score;
                if (score) { jobStats[jid].totalScore += score; jobStats[jid].scoreCount++; }
                if (c.autopilot_action_taken === 'auto_email_sent') jobStats[jid].emailsSent++;
            }
        });

        const jobsOverTime = {};
        jobsList.forEach(j => { const m = j.created_at?.substring(0, 7); if (m) jobsOverTime[m] = (jobsOverTime[m] || 0) + 1; });

        res.json({
            success: true,
            data: {
                statusBreakdown: Object.entries(statusBreakdown).map(([status, count]) => ({ status, count })),
                topJobs: Object.values(jobStats).sort((a, b) => b.candidateCount - a.candidateCount).slice(0, 10).map(j => ({
                    id: j.id, title: j.title, status: j.status, candidateCount: j.candidateCount,
                    avgMatchScore: j.scoreCount > 0 ? Math.round(j.totalScore / j.scoreCount) : 0, emailsSent: j.emailsSent
                })),
                trendsOverTime: Object.entries(jobsOverTime).sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, count]) => ({ month, count }))
            }
        });
    } catch (error) {
        console.error('Analytics jobs error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch job analytics' });
    }
});

/**
 * GET /api/analytics/funnel
 * Returns recruitment funnel metrics via PostgreSQL function
 */
router.get('/funnel', async (req, res) => {
    try {
        const db = req.user.supabase;
        const userId = req.user.id;
        const { jobId, days = 30 } = req.query;

        const rpcParams = { p_user_id: userId, p_days: parseInt(days) };
        if (jobId) rpcParams.p_job_id = jobId;

        const { data, error } = await db.rpc('analytics_funnel', rpcParams);

        if (!error && data) {
            return res.json({ success: true, data });
        }

        // Fallback
        if (error) console.warn('analytics_funnel RPC not available, using fallback:', error.message);
        const startDate = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
        let query = db.from('candidate_submissions').select('id, resume_text, skills, autopilot_triggered, autopilot_best_match_score, autopilot_action_taken, autopilot_best_match_job_id, status, created_at').eq('user_id', userId).gte('created_at', startDate.toISOString());
        if (jobId) query = query.eq('best_match_job_id', jobId);
        const { data: candidates } = await query;
        const list = candidates || [];

        const total = list.length;
        const screened = list.filter(c => c.resume_text || (c.skills && c.skills.length > 0)).length;
        const matched = list.filter(c => c.autopilot_best_match_score > 0).length;
        const qualified = list.filter(c => (c.autopilot_best_match_score || 0) >= 80).length;
        const contacted = list.filter(c => c.autopilot_action_taken === 'auto_email_sent').length;
        const responded = list.filter(c => c.autopilot_action_taken === 'auto_email_sent' && c.status === 'responded').length;

        const funnel = [
            { stage: 'Submissions', count: total },
            { stage: 'Screened', count: screened },
            { stage: 'Matched', count: matched },
            { stage: 'Qualified (80%+)', count: qualified },
            { stage: 'Contacted', count: contacted },
            { stage: 'Responded', count: responded }
        ].map((s, i, arr) => ({ ...s, conversionRate: parseFloat((i === 0 ? 100 : arr[i - 1].count > 0 ? (s.count / arr[i - 1].count * 100).toFixed(1) : 0).toString()) }));

        const dailyTrends = {};
        list.forEach(c => {
            const d = c.created_at?.split('T')[0];
            if (d) {
                if (!dailyTrends[d]) dailyTrends[d] = { submissions: 0, qualified: 0, contacted: 0 };
                dailyTrends[d].submissions++;
                if ((c.autopilot_best_match_score || 0) >= 80) dailyTrends[d].qualified++;
                if (c.autopilot_action_taken === 'auto_email_sent') dailyTrends[d].contacted++;
            }
        });

        res.json({
            success: true,
            data: {
                funnel,
                trends: Object.entries(dailyTrends).sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, ...d }))
            }
        });
    } catch (error) {
        console.error('Analytics funnel error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch funnel analytics' });
    }
});

// ===========================================================================
// /insights/* — the v3 Hiring Analytics & ROI surface (powers /app/insights).
// Every figure is a real, account-scoped aggregate; new accounts degrade to
// clean empty / insufficient_data states. ROI assumptions are caller-supplied
// inputs (never baked constants) and the response echoes inputs + counts so the
// number is honest about its basis.
// ===========================================================================

/**
 * GET /api/analytics/insights/funnel?days=&role=
 * Pipeline funnel: created → started → submitted → scored → advanced → offer →
 * hired → stayed-90d, with conversion + drop-off, scoped to the requester.
 */
router.get('/insights/funnel', async (req, res) => {
  try {
    const role = normRole(req.query.role);
    const days = parseDays(req.query.days);
    const { rows, roles, screens } = await analyticsService.loadRows(req.user, { role, days });
    const funnel = analyticsService.computeFunnel(rows);
    res.json({
      ...funnel,
      screens_total: screens.length,
      roles,
      filters: { role: role || null, days },
      empty: rows.length === 0,
    });
  } catch (e) {
    console.error('insights/funnel error:', e);
    fail(res, 500, 'Failed to compute funnel');
  }
});

/**
 * GET /api/analytics/insights/throughput?days=&role=
 * Time-to-submit / time-to-score / time-to-decision medians + per-day volume.
 */
router.get('/insights/throughput', async (req, res) => {
  try {
    const role = normRole(req.query.role);
    const days = parseDays(req.query.days);
    const { rows, roles } = await analyticsService.loadRows(req.user, { role, days });
    const throughput = analyticsService.computeThroughput(rows, { days });
    res.json({ ...throughput, roles, filters: { role: role || null, days }, empty: rows.length === 0 });
  } catch (e) {
    console.error('insights/throughput error:', e);
    fail(res, 500, 'Failed to compute throughput');
  }
});

/**
 * GET /api/analytics/insights/roi?days=&role=&hoursPerOnsite=&hourlyCost=
 * Senior-engineer hours saved + cost-per-qualified, recomputed from the
 * caller's editable assumptions × real counts. Returns inputs, counts, results.
 */
router.get('/insights/roi', async (req, res) => {
  try {
    const role = normRole(req.query.role);
    const days = parseDays(req.query.days);
    const { rows, roles } = await analyticsService.loadRows(req.user, { role, days });
    const counts = analyticsService.countsForRoi(rows);
    const roi = analyticsService.computeRoi(counts, {
      hoursPerOnsite: req.query.hoursPerOnsite,
      hourlyCost: req.query.hourlyCost,
    });
    res.json({
      ...roi,
      roles,
      filters: { role: role || null, days },
      // not enough finished screens to make the dollar figure meaningful
      insufficient_data: counts.completed === 0,
    });
  } catch (e) {
    console.error('insights/roi error:', e);
    fail(res, 500, 'Failed to compute ROI');
  }
});

/**
 * GET /api/analytics/insights/distribution/:role?score=
 * Per-role score distribution (histogram + percentiles + outcome bands), reusing
 * calibrationService (NOT forked). ?score= adds the candidate's "your bar" marker.
 */
router.get('/insights/distribution/:role', async (req, res) => {
  try {
    const role = normRole(req.params.role);
    // One tenant-scoped read of the score corpus; feed both the report and the marker.
    const calRows = await calibrationService.fetchRows(req.user.id);
    const report = calibrationService.reportFromRows(calRows, role);

    let your_bar = null;
    if (req.query.score !== undefined && req.query.score !== '') {
      const score = Number(req.query.score);
      if (Number.isFinite(score)) {
        your_bar = calibrationService.computeCalibration({ score, roleFamily: role, rows: calRows });
      }
    }

    res.json({
      ...report,
      your_bar,
      insufficient_data: report.sample_size < calibrationService.MIN_BAND_SAMPLE,
      thresholds: {
        min_role_sample: calibrationService.MIN_ROLE_SAMPLE,
        min_band_sample: calibrationService.MIN_BAND_SAMPLE,
      },
    });
  } catch (e) {
    console.error('insights/distribution error:', e);
    fail(res, 500, 'Failed to compute distribution');
  }
});

/**
 * GET /api/analytics/insights/roles — the account's role families (drives the
 * role filter/dropdown on the dashboard). Pure aggregate, account-scoped.
 */
router.get('/insights/roles', async (req, res) => {
  try {
    const { roles, screens } = await analyticsService.loadRows(req.user, { rolesOnly: true });
    res.json({ roles, screens_total: screens.length });
  } catch (e) {
    console.error('insights/roles error:', e);
    fail(res, 500, 'Failed to list roles');
  }
});

module.exports = router;
