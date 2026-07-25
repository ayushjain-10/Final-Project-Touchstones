/**
 * Ashby integration settings — the recruiter/console side. Captures the customer's OUTBOUND Ashby
 * API key (needs the candidatesWrite permission), stored AES-256-GCM encrypted at rest. The key is
 * NEVER returned to the client — GET returns only { configured, last4 }. All access runs through the
 * service-role client (in ashbyAssessmentService) gated by the signed-in user's id; the table is
 * RLS deny-all to authenticated so a browser can never read api_key_enc directly.
 *
 * Mounted at /api/integrations/ashby.
 */
const express = require('express');
const router = express.Router();
const { supabaseAuth, requireRecruiter } = require('../../middleware/supabaseAuth');
const ashby = require('../../services/ashbyAssessmentService');

router.use(supabaseAuth);

// Fixed, client-safe error (never leak DB/crypto internals — mirrors the partner endpoints).
const oops = (res) => res.status(500).json({ error: 'Could not update Ashby settings.' });

// GET /api/integrations/ashby/settings → { configured, last4 }
router.get('/settings', requireRecruiter, async (req, res) => {
  try {
    res.json(await ashby.getTenantSettings(req.user.id));
  } catch (e) {
    console.error('ashby settings get error:', e.message);
    oops(res);
  }
});

// PUT /api/integrations/ashby/settings { api_key } → store (encrypted). Returns { configured, last4 }.
router.put('/settings', requireRecruiter, async (req, res) => {
  try {
    const key = String((req.body && req.body.api_key) || '').trim();
    if (!key) return res.status(400).json({ error: 'api_key is required' });
    res.json(await ashby.setTenantAshbyKey(req.user.id, key));
  } catch (e) {
    console.error('ashby settings put error:', e.message);
    oops(res);
  }
});

// DELETE /api/integrations/ashby/settings → remove the stored key.
router.delete('/settings', requireRecruiter, async (req, res) => {
  try {
    res.json(await ashby.clearTenantAshbyKey(req.user.id));
  } catch (e) {
    console.error('ashby settings delete error:', e.message);
    oops(res);
  }
});

module.exports = router;
