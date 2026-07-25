/**
 * Public marketing-site assistant ("Ask Touchstones") — backs the bottom-right chat widget.
 * No auth (marketing visitors). Guardrails: aiLimiter is applied at the mount (per-IP), plus the
 * global daily spend ceiling (spendGuard) and tight input caps here. Gated behind
 * ENABLE_MARKETING_ASSISTANT (app.js serves a 404 deferredRouter when off).
 */
const express = require('express');
const router = express.Router();
const marketingAssistant = require('../services/marketingAssistantService');
const spendGuard = require('../services/spendGuard');

const MAX_MSG = 1500;
const MAX_HISTORY = 12;

// POST /api/assistant/chat  { message: string, history?: [{role:'user'|'assistant', content:string}] }
router.post('/chat', async (req, res) => {
  try {
    const body = req.body || {};
    const message = String(body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'message required' });
    if (message.length > MAX_MSG) return res.status(400).json({ error: 'message too long' });

    // Global spend ceiling (shared marketing budget) — the public, unauthenticated surface must be
    // metered exactly like the scoring path so it can't be turned into a cost-amplification vector.
    const reservation = spendGuard.reserve({ accountId: 'marketing-assistant', calls: 1 });
    if (!reservation.ok) {
      return res.status(429).json({ error: "Our assistant is at capacity right now — please try again shortly, or email help@touchstones.ai." });
    }

    const history = Array.isArray(body.history)
      ? body.history
          .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
          .slice(-MAX_HISTORY)
      : [];

    const { reply } = await marketingAssistant.chat(history, message);
    return res.json({ reply });
  } catch (e) {
    return res.status(500).json({ error: 'assistant unavailable' });
  }
});

module.exports = router;
