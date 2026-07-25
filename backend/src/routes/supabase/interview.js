/**
 * Live AI Probe routes (S1) — /api/interview/...
 * ---------------------------------------------
 * A short adaptive interview grounded in the candidate's actual submission, tied to the integrity
 * chain and scored in code (see services/interviewProbeService.js).
 *
 * PUBLIC (token-gated, no session — the /probe/:token candidate page):
 *   GET  /api/interview/probe/by-token/:token          → candidate-safe state (current question, progress)
 *   POST /api/interview/probe/by-token/:token/answer    → answer → next question or done
 *
 * AUTHENTICATED (recruiter/candidate session; RLS-scoped):
 *   POST /api/interview/submissions/:id/probe/start     → create/resume a probe (first question + share link)
 *   GET  /api/interview/submissions/:id/latest-probe    → owner: latest probe for a submission
 *   GET  /api/interview/probe/:probeId                  → owner: full transcript + score + dimensions
 *
 * The probe row is owned by the work_sample OWNER (the recruiter pays + reads it under RLS); either
 * the owner or the candidate may START it (both can read the submission under RLS).
 */
const express = require('express');
const router = express.Router();
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const { supabaseAdmin } = require('../../config/supabase');
const interviewProbeService = require('../../services/interviewProbeService');
const speechService = require('../../services/speechService');

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const isToken = (t) => /^[a-f0-9]{16,64}$/i.test(t || '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// Candidate-safe projection (NEVER leaks the score/dimensions mid- or post-interview to the candidate).
function candidateView(probe, taskTitle) {
  const asked = (probe.turns || []).filter((t) => t.role === 'interviewer').length;
  const done = probe.status !== 'in_progress';
  return {
    status: probe.status,
    done,
    question: done ? null : interviewProbeService.currentQuestion(probe),
    turn_index: asked,                 // 1-based question number currently being answered
    max_turns: probe.max_turns,
    task_title: taskTitle || null,
  };
}

// ── PUBLIC (token) ───────────────────────────────────────────────────────────────────────

// Load the probe by token for the candidate page.
router.get('/probe/by-token/:token', async (req, res) => {
  try {
    if (!isToken(req.params.token)) return fail(res, 400, 'invalid token');
    const { data: probe } = await supabaseAdmin
      .from('interview_probes').select('*').eq('probe_token', req.params.token).maybeSingle();
    if (!probe) return fail(res, 404, 'interview not found');
    let title = null;
    const { data: sub } = await supabaseAdmin
      .from('work_sample_submissions').select('work_sample_id').eq('id', probe.submission_id).maybeSingle();
    if (sub) {
      const { data: ws } = await supabaseAdmin.from('work_samples').select('title').eq('id', sub.work_sample_id).maybeSingle();
      title = ws?.title || null;
    }
    res.json(candidateView(probe, title));
  } catch (e) { fail(res, 500, e.message); }
});

// Candidate answers the current question.
router.post('/probe/by-token/:token/answer', async (req, res) => {
  try {
    if (!isToken(req.params.token)) return fail(res, 400, 'invalid token');
    const { answer } = req.body || {};
    if (typeof answer !== 'string' || !answer.trim()) return fail(res, 400, 'answer is required');
    const { data: probe } = await supabaseAdmin
      .from('interview_probes').select('*').eq('probe_token', req.params.token).maybeSingle();
    if (!probe) return fail(res, 404, 'interview not found');
    if (probe.status !== 'in_progress') return res.json({ done: true, status: probe.status });

    const result = await interviewProbeService.submitAnswer({ probe, answerText: answer });
    if (result.done) return res.json({ done: true, status: 'done' });
    return res.json({ done: false, question: result.question, turn_index: (result.probe.turns || []).filter((t) => t.role === 'interviewer').length });
  } catch (e) {
    if (e.code === 'bad_request') return fail(res, 400, e.message);
    // S1-1: a concurrent/duplicate answer for the same question is serialized away → 409.
    if (e.code === 'conflict') return fail(res, 409, 'this question was already answered');
    fail(res, 500, e.message);
  }
});

// Ephemeral Azure Speech token for the verbal walkthrough — token-gated (this public probe page, no
// session). Lets the candidate DICTATE their answer: the browser streams mic audio directly to Azure with
// this 10-minute token, so audio never touches our backend and nothing (audio or transcript) is persisted
// — only the dictated TEXT is submitted via /answer. 404 unless the probe token is valid + in progress AND
// ENABLE_SPEECH_WALKTHROUGH + Azure Speech creds are configured.
router.get('/probe/by-token/:token/speech-token', async (req, res) => {
  try {
    if (!isToken(req.params.token)) return fail(res, 400, 'invalid token');
    if (!speechService.isEnabled()) return fail(res, 404, 'speech not enabled');
    const { data: probe } = await supabaseAdmin
      .from('interview_probes').select('status').eq('probe_token', req.params.token).maybeSingle();
    if (!probe) return fail(res, 404, 'interview not found');
    if (probe.status !== 'in_progress') return fail(res, 409, 'interview not in progress');
    const token = await speechService.issueToken();
    if (!token) return fail(res, 404, 'speech not enabled');
    res.json(token);
  } catch (e) { fail(res, 502, 'speech token unavailable'); }
});

// ── AUTHENTICATED (recruiter / candidate session) ────────────────────────────────────────
router.use(supabaseAuth);

const FRONTEND_URL = () => (process.env.FRONTEND_URL || '').replace(/\/+$/, '');

// Start (or resume) a probe for a submission. Either the owner or the candidate may start it; the
// probe is OWNED by the work_sample owner (account_id) so the recruiter reads it under RLS + pays.
router.post('/submissions/:id/probe/start', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    // Access gate: the caller must be able to read the submission under RLS (candidate-self OR owner).
    const { data: sub } = await req.user.supabase
      .from('work_sample_submissions').select('id, work_sample_id').eq('id', req.params.id).single();
    if (!sub) return fail(res, 404, 'submission not found or not accessible');
    // Resolve the work_sample owner — the probe is owned (+ paid for) by the recruiter.
    const { data: ws } = await supabaseAdmin.from('work_samples').select('owner_id').eq('id', sub.work_sample_id).single();
    const accountId = ws?.owner_id;
    if (!accountId) return fail(res, 404, 'work sample not found');

    const { probe, question, resumed } = await interviewProbeService.startProbe({ submissionId: req.params.id, accountId });
    const base = FRONTEND_URL();
    res.status(resumed ? 200 : 201).json({
      probe_id: probe.id,
      token: probe.probe_token,
      probe_url: base ? `${base}/probe/${probe.probe_token}` : null,
      status: probe.status,
      max_turns: probe.max_turns,
      turn_index: (probe.turns || []).filter((t) => t.role === 'interviewer').length,
      question,
      resumed: Boolean(resumed),
    });
  } catch (e) {
    if (e.code === 'not_found') return fail(res, 404, e.message);
    if (e.code === 'unprobeable') return fail(res, 422, e.message);
    if (e && e.name === 'SpendCeilingError') return res.status(429).json({ error: e.message, reason: e.reason });
    fail(res, 500, e.message);
  }
});

// Owner: the latest probe for a submission (for the recruiter panel to find/show it).
router.get('/submissions/:id/latest-probe', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    // Ownership via RLS: the probe is account-scoped; reading through req.user.supabase enforces it.
    const { data: probe } = await req.user.supabase
      .from('interview_probes').select('*').eq('submission_id', req.params.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!probe) return res.status(404).json({ error: 'no probe yet' });
    res.json(fullProbe(probe));
  } catch (e) { fail(res, 500, e.message); }
});

// Owner: the full probe (transcript + score + dimensions + consistency).
router.get('/probe/:probeId', async (req, res) => {
  try {
    if (!isUUID(req.params.probeId)) return fail(res, 400, 'invalid id');
    const { data: probe } = await req.user.supabase
      .from('interview_probes').select('*').eq('id', req.params.probeId).maybeSingle();
    if (!probe) return fail(res, 404, 'probe not found or not accessible');
    res.json(fullProbe(probe));
  } catch (e) { fail(res, 500, e.message); }
});

// Recruiter-facing full shape.
function fullProbe(probe) {
  return {
    id: probe.id,
    submission_id: probe.submission_id,
    status: probe.status,
    max_turns: probe.max_turns,
    turns: probe.turns || [],
    probe_score: probe.probe_score ?? null,
    dimensions: probe.dimensions || null,
    consistency_flag: probe.consistency_flag || null,
    reasoning: probe.reasoning || null,
    token: probe.probe_token,
    created_at: probe.created_at,
    completed_at: probe.completed_at,
  };
}

module.exports = router;
