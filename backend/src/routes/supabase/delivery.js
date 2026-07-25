/**
 * Score delivery routes — /api/delivery/...
 * "Lands where you hire": let a recruiter verify their Slack webhook and manually
 * (re)deliver a finished score to Slack / Ashby / Greenhouse for a submission they own.
 *
 * Auth/ownership shape mirrors credentials.js: the RLS-scoped read of the submission is
 * the tenant gate, then we pull the latest non-superseded proof score + latest direction
 * score via service role keyed strictly by the gated submission id.
 */
const express = require('express');
const router = express.Router();
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const { supabaseAdmin } = require('../../config/supabase');
const slackService = require('../../services/slackService');
const scoreDelivery = require('../../services/scoreDelivery');
const greenhouseV3 = require('../../services/greenhouseV3Service');

router.use(supabaseAuth);

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// POST /api/delivery/test-slack — send a sample score to verify a Slack webhook.
// Uses the posted webhook_url, falling back to the global SLACK_WEBHOOK_URL.
router.post('/test-slack', async (req, res) => {
  try {
    const webhookUrl = (req.body && req.body.webhook_url) || undefined;
    const result = await slackService.postScore(webhookUrl, {
      candidate: 'Test Candidate',
      score: 87,
      outcome: 'advance',
      direction_score: 72,
      work_sample: 'Sample work sample',
      result_url: (process.env.FRONTEND_URL || '').replace(/\/+$/, '') || undefined,
    });
    if (result.skipped) {
      return fail(res, 400, 'No Slack webhook configured (pass webhook_url or set SLACK_WEBHOOK_URL)');
    }
    if (!result.success) return fail(res, 502, result.error || 'Slack delivery failed');
    res.json({ success: true, status: result.status });
  } catch (e) { fail(res, 500, e.message); }
});

// POST /api/delivery/submissions/:id/push — manually deliver a finished score.
// Body: { channels?: ['slack','ashby','greenhouse'], slack_webhook_url?, ashby_*, greenhouse_* }
router.post('/submissions/:id/push', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');

    // Ownership gate: requester must be able to read this submission under RLS.
    const { data: sub } = await req.user.supabase
      .from('work_sample_submissions').select('id, candidate_id, work_sample_id').eq('id', req.params.id).single();
    if (!sub) return fail(res, 404, 'submission not found or not accessible');

    // Latest non-superseded proof score (keyed by the gated submission id).
    const { data: score } = await supabaseAdmin.from('proof_scores')
      .select('id, normalized_score, outcome, created_at, superseded_by')
      .eq('submission_id', req.params.id).is('superseded_by', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!score) return fail(res, 409, 'submission has no score to deliver yet');

    const { data: dir } = await supabaseAdmin.from('ai_direction_scores')
      .select('direction_score').eq('submission_id', req.params.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    // Candidate display name (best-effort — delivery still works without it).
    let candidate = 'Candidate';
    if (sub.candidate_id) {
      const { data: cand } = await supabaseAdmin
        .from('candidates').select('full_name, name, email').eq('id', sub.candidate_id).maybeSingle();
      if (cand) candidate = cand.full_name || cand.name || cand.email || candidate;
    }

    // Work sample title for context (best-effort).
    let workSample;
    const { data: ws } = await supabaseAdmin
      .from('work_samples').select('title').eq('id', sub.work_sample_id).maybeSingle();
    if (ws) workSample = ws.title;

    const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    const result_url = base ? `${base}/proof/results/${req.params.id}` : undefined;

    const body = req.body || {};
    const summary = {
      submission_id: req.params.id,
      candidate,
      score: score.normalized_score,
      outcome: score.outcome,
      direction_score: dir ? dir.direction_score : undefined,
      work_sample: workSample,
      result_url,
    };

    // Greenhouse Harvest v3 supersedes the v1 note push. Route greenhouse to v3 ONLY when the flag is
    // on, the recruiter has stored a v3 credential, and a numeric greenhouse_candidate_id is supplied
    // (v3 attaches notes to a candidate, not an application). Otherwise the v1 fan-out path is left
    // intact/available.
    const ghCandidateId = body.greenhouse_candidate_id;
    const hasGhCandidate = ghCandidateId != null && String(ghCandidateId).trim() !== '';
    const routeGreenhouseToV3 = greenhouseV3.isEnabled() && hasGhCandidate
      && (await greenhouseV3.getTenantSettings(req.user.id)).configured;

    const requestedChannels = Array.isArray(body.channels) ? body.channels : ['slack', 'ashby', 'greenhouse'];
    const deliverChannels = routeGreenhouseToV3
      ? requestedChannels.filter((c) => c !== 'greenhouse')
      : requestedChannels;

    const { delivered } = await scoreDelivery.deliver(summary, {
      channels: deliverChannels,
      slackWebhookUrl: body.slack_webhook_url,
      ashbyApiKey: body.ashby_api_key,
      ashbyCandidateId: body.ashby_candidate_id,
      ashbyApplicationId: body.ashby_application_id,
      greenhouseApiKey: body.greenhouse_api_key,
      greenhouseApplicationId: body.greenhouse_application_id,
      greenhouseOnBehalfOf: body.greenhouse_on_behalf_of,
    });

    // v3 note push (best-effort; createNote never throws) when routed to v3 and requested.
    if (routeGreenhouseToV3 && requestedChannels.includes('greenhouse')) {
      delivered.greenhouse = await greenhouseV3.createNote({
        account_id: req.user.id,
        candidate_id: ghCandidateId,
        application_id: body.greenhouse_application_id,
        summary,
      });
    }

    res.json({ submission_id: req.params.id, delivered });
  } catch (e) { fail(res, 500, e.message); }
});

module.exports = router;
