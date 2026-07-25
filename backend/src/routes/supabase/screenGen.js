/**
 * Screen Generation routes — /api/screen-gen  (CC2 / S2 · "Author with AI")
 *
 * Turns a job description (or a code snippet / repo signal) into a DRAFT work-sample
 * the recruiter can tweak, then save via the existing POST /api/proof/work-samples.
 * Nothing is persisted as a work_sample here — these endpoints only return a draft.
 *
 *   POST /from-jd    { jd, language?, difficulty? }            -> 200 { draft }
 *   POST /from-repo  { repo_url? | snippet?, language?, difficulty? } -> 200 { draft }
 *
 * Auth: supabaseAuth (RLS-scoped). Rate-limited at mount time with aiLimiter (it's an
 * AI route). Each successful generation is logged best-effort to `screen_generations`
 * (migration 048) for analytics / abuse-control — failures there never block the draft.
 */
const express = require('express');
const router = express.Router();
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const screenGenService = require('../../services/screenGenService');

router.use(supabaseAuth);

const fail = (res, code, msg, extra) => res.status(code).json({ error: msg, ...(extra || {}) });

// Map service/guard errors onto calm HTTP codes (mirrors proof.js conventions).
function handleErr(res, e) {
  if (e && e.name === 'SpendCeilingError') {
    return res.status(429).json({ error: e.message, reason: e.reason });
  }
  if (e && e.code === 'AI_UNAVAILABLE') {
    return res.status(503).json({ error: 'AI generation is not configured for this deployment', reason: 'ai_unavailable' });
  }
  if (e && e.code === 'AI_TRANSIENT') {
    res.setHeader('Retry-After', '20');
    return res.status(503).json({ error: 'The AI is temporarily busy — please try again in a moment.', reason: 'ai_transient' });
  }
  if (e && e.code === 'GENERATION_FAILED') {
    return res.status(502).json({ error: 'Could not generate a usable screen — try again or tweak the input', reason: 'generation_failed' });
  }
  return fail(res, 500, (e && e.message) || 'screen generation failed');
}

// Best-effort generation log. Non-blocking; swallows errors (incl. table-not-yet-migrated)
// so the feature works even before migration 048 is applied.
function logGeneration(req, input_kind, input, draft) {
  try {
    req.user.supabase
      .from('screen_generations')
      .insert({
        account_id: req.user.id,
        input_kind,
        input_hash: screenGenService.inputHash(input),
        output: draft,
      })
      .then(
        () => {},
        () => {}
      );
  } catch (_) {
    /* never block the response on logging */
  }
}

// POST /api/screen-gen/from-jd
router.post('/from-jd', async (req, res) => {
  try {
    const { jd, language, difficulty } = req.body || {};
    if (!jd || typeof jd !== 'string' || jd.trim().length < 20) {
      return fail(res, 400, 'jd is required — paste a job description (at least ~20 characters)');
    }
    const draft = await screenGenService.generateFromJD({
      jd: jd.trim(),
      language: typeof language === 'string' ? language : undefined,
      difficulty: typeof difficulty === 'string' ? difficulty : undefined,
      accountId: req.user.id,
    });
    logGeneration(req, 'jd', jd, draft);
    res.status(200).json({ draft });
  } catch (e) {
    handleErr(res, e);
  }
});

// POST /api/screen-gen/from-repo
router.post('/from-repo', async (req, res) => {
  try {
    const { repo_url, snippet, language, difficulty } = req.body || {};
    const snip = typeof snippet === 'string' ? snippet.trim() : '';
    const url = typeof repo_url === 'string' ? repo_url.trim() : '';
    const signal = snip || url;
    if (!signal || signal.length < 8) {
      return fail(res, 400, 'repo_url or snippet is required (paste a code excerpt or a repo URL)');
    }
    const draft = await screenGenService.generateFromRepo({
      repo_url: url || undefined,
      snippet: snip || undefined,
      language: typeof language === 'string' ? language : undefined,
      difficulty: typeof difficulty === 'string' ? difficulty : undefined,
      accountId: req.user.id,
    });
    logGeneration(req, snip ? 'snippet' : 'repo', signal, draft);
    res.status(200).json({ draft });
  } catch (e) {
    handleErr(res, e);
  }
});

module.exports = router;
