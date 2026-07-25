/**
 * demo.js — PUBLIC, no-auth interactive demo endpoints for the ML final-project surface.
 * ------------------------------------------------------------------------------------------
 * These drive the /demo/features page: they call the REAL production services live, so the
 * page is an actual working demo (not screenshots). Three things:
 *   POST /score      — grade a submission with the real grader (LLM emits per-criterion points;
 *                      our code computes the 0-100 score). Proves the anti-injection property live.
 *   POST /calibrate  — the real empirical-Bayes shrinkRate() for a band's selected/n.
 *   POST /fairness   — the real EEOC four-fifths fourFifths() over user-supplied subgroups.
 *
 * Gated: ON in development, OFF in production unless ENABLE_DEMO=true (the /score path calls the
 * LLM, so it must not be an open, unauthenticated endpoint in a deployed environment).
 */
const express = require('express');

const router = express.Router();
const calibrationService = require('../../services/calibrationService');
const complianceService = require('../../services/complianceService');
const aiService = require('../../services/aiService');
const { buildSystemPrompt, computeScore, validateGraderOutput } = require('../../services/proofScoringService');

const DEMO_ENABLED = process.env.ENABLE_DEMO === 'true' || process.env.NODE_ENV === 'development';
const round1 = (x) => Math.round(x * 10) / 10;

// A small, self-contained rubric for the scorer demo (a classic max-subarray task with a
// well-known all-negative bug, so the grader has something real to catch).
const DEFAULT_RUBRIC = {
  criteria: [
    { id: 'correct', requirement: 'Returns the largest sum of a contiguous subarray for ALL inputs, including arrays where every number is negative', points_possible: 6 },
    { id: 'edge', requirement: 'Handles edge cases (empty list, single element) without crashing', points_possible: 2 },
    { id: 'clarity', requirement: 'Readable code with clear variable names', points_possible: 2 },
  ],
};

// Same code-side injection heuristic the scorer uses (a review flag, never an auto-reject).
const INJECTION_RE = /ignore (the |all )?(previous|above|prior) (instructions|prompt|rubric)|assign (me )?(the )?(maximum|full|highest|100)|you are now|admin mode|override the score|disregard (the )?(rubric|instructions)/i;

router.use((req, res, next) => {
  if (!DEMO_ENABLED) return res.status(404).json({ error: 'demo endpoints are disabled' });
  return next();
});

// Is the live scorer available? (drives the "engine connected" pill + the default rubric)
router.get('/health', (req, res) => {
  let scorer = false;
  let model = null;
  try {
    const llm = aiService.getLLM();
    scorer = !!(llm && llm.anthropic);
    model = llm ? llm.model : null;
  } catch (_) { /* scorer optional */ }
  res.json({ ok: true, scorer, model, rubric: DEFAULT_RUBRIC });
});

// Cold-start calibration: the REAL Beta-Binomial posterior vs. the raw rate.
router.post('/calibrate', (req, res) => {
  const n = Math.max(0, Math.min(500, Math.floor(Number(req.body && req.body.n) || 0)));
  const selected = Math.max(0, Math.min(n, Math.floor(Number(req.body && req.body.selected) || 0)));
  const pmRaw = Number(req.body && req.body.prior_mean);
  const priorMean = Number.isFinite(pmRaw) ? Math.max(0, Math.min(1, pmRaw)) : 0.70;
  const shrunk = calibrationService.shrinkRate({ selected, n, priorMean });
  res.json({
    shrunk,
    raw_rate: n > 0 ? round1((selected / n) * 100) : null,
    raw_available: n >= calibrationService.MIN_BAND_SAMPLE, // below the floor the raw band is suppressed
    min_band_sample: calibrationService.MIN_BAND_SAMPLE,
    prior_mean_pct: round1(priorMean * 100),
  });
});

// Subgroup fairness: the REAL EEOC four-fifths analysis over user-supplied groups.
router.post('/fairness', (req, res) => {
  const groups = Array.isArray(req.body && req.body.groups)
    ? req.body.groups.slice(0, 8).map((g) => ({
      value: String((g && g.value) || '').slice(0, 40),
      n: Math.max(0, Math.min(100000, Math.floor(Number(g && g.n) || 0))),
      selected: Math.max(0, Math.floor(Number(g && g.selected) || 0)),
    }))
    : [];
  res.json({ ...complianceService.fourFifths(groups), min_group_sample: complianceService.MIN_GROUP_SAMPLE });
});

// Live scorer: the model emits per-criterion points; OUR CODE computes the 0-100 score.
router.post('/score', async (req, res) => {
  try {
    const submission = String((req.body && req.body.submission) || '').slice(0, 8000);
    if (!submission.trim()) return res.status(400).json({ error: 'submission is required' });
    const rubric = (req.body && req.body.rubric && Array.isArray(req.body.rubric.criteria) && req.body.rubric.criteria.length)
      ? req.body.rubric : DEFAULT_RUBRIC;

    const llm = aiService.getLLM();
    if (!llm || !llm.anthropic) return res.status(503).json({ error: 'no grader model is configured on the server' });
    const { anthropic, model } = llm;

    const t0 = Date.now();
    const resp = await anthropic.messages.create({
      model,
      max_tokens: 800,
      system: [{ type: 'text', text: buildSystemPrompt(rubric) }],
      messages: [{ role: 'user', content: `<submission>\n${submission}\n</submission>` }],
    });
    const text = (resp.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('');
    const grade = validateGraderOutput(text);
    if (!grade) return res.status(502).json({ error: 'grader returned unparseable output; try again' });

    const scored = computeScore(rubric, grade.per_criterion);
    const byId = Object.fromEntries(rubric.criteria.map((c) => [c.id, c]));
    return res.json({
      model,
      latency_ms: Date.now() - t0,
      normalized_score: scored.normalized,
      raw_points_awarded: scored.weightedAwarded,
      raw_points_possible: scored.weightedPossible,
      per_criterion: (scored.per || []).map((p) => ({
        id: p.id,
        requirement: (byId[p.id] || {}).requirement || p.id,
        points_awarded: p.points_awarded,
        points_possible: p.points_possible,
        verdict: p.verdict,
        evidence: p.evidence_quote,
        explanation: p.explanation,
      })),
      overall_explanation: grade.overall_explanation || '',
      injection_flagged: INJECTION_RE.test(submission) || grade.injection_detected === true,
    });
  } catch (e) {
    const msg = (e && e.message) || 'scoring failed';
    // The grader's provider (Azure/OpenAI) rejects blatant jailbreak / injection inputs with a
    // content-policy 400. That is a valid defense-in-depth outcome for the demo, not a server
    // error: surface it as a review flag, exactly as production would (never an automated pass).
    if (/content management policy|content filter|responsible ai|jailbreak|filtered due to/i.test(msg)) {
      return res.json({
        blocked_by_provider: true,
        injection_flagged: true,
        message: "The grader model's provider blocked this submission as a prompt-injection / policy violation before grading. In production this becomes a human-review flag, never an automated pass.",
      });
    }
    return res.status(500).json({ error: msg });
  }
});

module.exports = router;
