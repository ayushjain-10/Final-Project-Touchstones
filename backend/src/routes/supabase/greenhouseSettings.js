/**
 * Greenhouse Harvest v3 integration settings — the recruiter/console side. Captures the customer's
 * Harvest v3 credential (client_id + client_secret with the harvest:notes:create scope). The
 * client_secret is stored AES-256-GCM encrypted at rest (cryptoVault) and is NEVER returned to the
 * client — GET returns only { configured, last4 } (last4 of the client_id, not the secret). All
 * access runs through the service-role client (in greenhouseV3Service) gated by the signed-in user's
 * id; the table is RLS deny-all to authenticated so a browser can never read client_secret_enc.
 *
 * Also carries the Greenhouse ASSESSMENTS partner surface (flag GREENHOUSE_ASSESSMENTS_ENABLED):
 *   - the per-org Assessment API key the customer hands to Greenhouse (minted here, raw shown
 *     exactly once, stored cryptoVault-encrypted for the completion PATCH), and
 *   - the Harvest v3 Partner OAuth connect flow (authorize redirect + PUBLIC callback + status).
 *
 * Mounted at /api/integrations/greenhouse.
 */
const express = require('express');
const router = express.Router();
const { supabaseAuth, requireRecruiter } = require('../../middleware/supabaseAuth');
const greenhouse = require('../../services/greenhouseV3Service');
const greenhouseAssessments = require('../../services/greenhouseAssessmentService');
const greenhouseOAuth = require('../../services/greenhouseOAuthService');

// Assessments-surface kill-switch (OFF by default). Checked per request so tests can toggle it.
const assessmentsEnabled = () => process.env.GREENHOUSE_ASSESSMENTS_ENABLED === 'true';
const notEnabled = (res) => res.status(404).json({ error: 'not found' });

// GET /api/integrations/greenhouse/oauth/callback?code=&state= - PUBLIC (the browser arrives via
// the Greenhouse redirect with no session header), registered BEFORE supabaseAuth. The tenant is
// authenticated by the HMAC-signed state minted at /oauth/start; the code is exchanged
// synchronously (authorization codes live 1 minute). Never renders tokens or error detail.
router.get('/oauth/callback', async (req, res) => {
  const frontend = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  const back = (outcome) => (frontend
    ? res.redirect(302, `${frontend}/app/developers?greenhouse=${outcome}`)
    : res.status(outcome === 'connected' ? 200 : 400).json({ greenhouse: outcome }));
  try {
    if (!assessmentsEnabled()) return notEnabled(res);
    await greenhouseOAuth.handleCallback(req.query.code, req.query.state);
    return back('connected');
  } catch (e) {
    console.error('greenhouse oauth callback error:', e.message);
    return back('error');
  }
});

router.use(supabaseAuth);

// Fixed, client-safe error (never leak DB/crypto internals — mirrors the Ashby settings route).
const oops = (res) => res.status(500).json({ error: 'Could not update Greenhouse settings.' });

// GET /api/integrations/greenhouse/settings → { configured, last4 }
router.get('/settings', requireRecruiter, async (req, res) => {
  try {
    res.json(await greenhouse.getTenantSettings(req.user.id));
  } catch (e) {
    console.error('greenhouse settings get error:', e.message);
    oops(res);
  }
});

// POST /api/integrations/greenhouse/settings { client_id, client_secret, default_user_id? }
// → store (secret encrypted). Returns { configured, last4 }.
router.post('/settings', requireRecruiter, async (req, res) => {
  try {
    const body = req.body || {};
    const clientId = String(body.client_id || '').trim();
    const clientSecret = String(body.client_secret || '').trim();
    if (!clientId) return res.status(400).json({ error: 'client_id is required' });
    if (!clientSecret) return res.status(400).json({ error: 'client_secret is required' });
    res.json(await greenhouse.setTenantCreds(req.user.id, {
      clientId,
      clientSecret,
      defaultUserId: body.default_user_id,
    }));
  } catch (e) {
    console.error('greenhouse settings post error:', e.message);
    oops(res);
  }
});

// DELETE /api/integrations/greenhouse/settings → remove the stored credential.
router.delete('/settings', requireRecruiter, async (req, res) => {
  try {
    res.json(await greenhouse.clearTenantCreds(req.user.id));
  } catch (e) {
    console.error('greenhouse settings delete error:', e.message);
    oops(res);
  }
});

// ── Assessments partner surface (flag-gated) ────────────────────────────────────────────────

// GET /assessment-key → { configured, last4 }. The raw key is only ever shown at mint.
router.get('/assessment-key', requireRecruiter, async (req, res) => {
  try {
    if (!assessmentsEnabled()) return notEnabled(res);
    res.json(await greenhouseAssessments.getAssessmentKeySettings(req.user.id));
  } catch (e) {
    console.error('greenhouse assessment-key get error:', e.message);
    oops(res);
  }
});

// POST /assessment-key → mint (or rotate) the org key Greenhouse will present to us. Returns the
// full plaintext EXACTLY ONCE (the customer hands it to Greenhouse) plus { configured, last4 }.
router.post('/assessment-key', requireRecruiter, async (req, res) => {
  try {
    if (!assessmentsEnabled()) return notEnabled(res);
    res.status(201).json(await greenhouseAssessments.mintAssessmentKey(req.user.id));
  } catch (e) {
    console.error('greenhouse assessment-key mint error:', e.message);
    oops(res);
  }
});

// DELETE /assessment-key → revoke the api_keys row and clear the stored encrypted copy.
router.delete('/assessment-key', requireRecruiter, async (req, res) => {
  try {
    if (!assessmentsEnabled()) return notEnabled(res);
    res.json(await greenhouseAssessments.clearAssessmentKey(req.user.id));
  } catch (e) {
    console.error('greenhouse assessment-key delete error:', e.message);
    oops(res);
  }
});

// POST /oauth/start → { url } for the "Connect with Greenhouse" button (frontend redirects there).
router.post('/oauth/start', requireRecruiter, async (req, res) => {
  try {
    if (!assessmentsEnabled()) return notEnabled(res);
    if (!greenhouseOAuth.isConfigured()) {
      return res.status(503).json({ error: 'Greenhouse OAuth is not configured on this deployment.' });
    }
    res.json({ url: greenhouseOAuth.buildAuthorizeUrl(req.user.id) });
  } catch (e) {
    console.error('greenhouse oauth start error:', e.message);
    oops(res);
  }
});

// GET /oauth/status → { connected, status?, scopes?, last_refreshed_at? }.
router.get('/oauth/status', requireRecruiter, async (req, res) => {
  try {
    if (!assessmentsEnabled()) return notEnabled(res);
    res.json(await greenhouseOAuth.getConnection(req.user.id));
  } catch (e) {
    console.error('greenhouse oauth status error:', e.message);
    oops(res);
  }
});

// DELETE /oauth → drop our stored connection (true revocation lives in the customer's Greenhouse
// under Configure > Dev Center > Connected Integrations; the UI says so).
router.delete('/oauth', requireRecruiter, async (req, res) => {
  try {
    if (!assessmentsEnabled()) return notEnabled(res);
    res.json(await greenhouseOAuth.disconnect(req.user.id));
  } catch (e) {
    console.error('greenhouse oauth disconnect error:', e.message);
    oops(res);
  }
});

module.exports = router;
