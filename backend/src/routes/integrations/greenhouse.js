/**
 * Greenhouse Assessments - PARTNER-hosted endpoints (Greenhouse calls these on us).
 * Contract: https://developers.greenhouse.io/assessment.html
 * Mounted at /integrations/greenhouse, so the four registered endpoints resolve at:
 *   GET  /integrations/greenhouse/list_tests
 *   POST /integrations/greenhouse/send_test
 *   GET  /integrations/greenhouse/test_status?partner_interview_id=...
 *   POST /integrations/greenhouse/request_errors
 *
 * AUTH (inbound): Greenhouse authenticates with HTTP Basic carrying the org-level TOUCHSTONES API
 * key we minted for the customer (key + ':' base64d, i.e. key in the username, blank password) -
 * the same shape Ashby uses, normalized by the shared partnerBasicKeyAuth into the existing
 * apiKeyAuth pipeline (sha256 -> api_keys lookup -> req.apiAccount). Bad/missing key: 401.
 *
 * FLAG: the entire surface self-404s unless GREENHOUSE_ASSESSMENTS_ENABLED === 'true' (checked per
 * request, same kill-switch idiom as verifiedSession.js). Nothing here may touch a real customer
 * until Greenhouse approves the integration.
 */
const express = require('express');
const router = express.Router();
const { partnerBasicKeyAuth } = require('../../middleware/partnerBasicKeyAuth');
const greenhouse = require('../../services/greenhouseAssessmentService');
const greenhouseOAuth = require('../../services/greenhouseOAuthService');

router.use((req, res, next) => {
  if (!greenhouse.isEnabled()) return res.status(404).json({ error: 'not found' });
  return next();
});
router.use(express.json());
router.use(partnerBasicKeyAuth);

// GET /list_tests - the tests this org can assign. Bare array per the documented contract.
router.get('/list_tests', async (req, res) => {
  try {
    res.json(await greenhouse.listTests(req.apiAccount.accountId));
  } catch (e) {
    console.error('greenhouse list_tests error:', e.message);
    res.status(500).json({ message: 'Could not list tests.' });
  }
});

// POST /send_test - assign a test to a candidate; respond { partner_interview_id }.
router.post('/send_test', async (req, res) => {
  try {
    const { partner_interview_id } = await greenhouse.sendTest(req.apiAccount.accountId, req.body || {});
    res.json({ partner_interview_id });
  } catch (e) {
    if (e && e.name === 'GreenhouseSendError') {
      return res.status(e.httpStatus || 500).json({ message: e.message });
    }
    console.error('greenhouse send_test error:', e.message);
    res.status(500).json({ message: 'Could not send test.' });
  }
});

// GET /test_status?partner_interview_id=... - status + score for one test instance. Answers at any
// time (Greenhouse polls until 'complete' or 8 weeks); unknown id is their documented 404.
router.get('/test_status', async (req, res) => {
  try {
    const id = String(req.query.partner_interview_id || '').trim();
    if (!id) return res.status(404).json({ message: 'partner_interview_id is required' });
    const status = await greenhouse.testStatus(req.apiAccount.accountId, id);
    if (!status) return res.status(404).json({ message: 'unknown partner_interview_id' });
    res.json(status);
  } catch (e) {
    console.error('greenhouse test_status error:', e.message);
    res.status(500).json({ message: 'Could not read test status.' });
  }
});

// POST /request_errors - Greenhouse reports OUR malformed responses here. Never errors.
router.post('/request_errors', async (req, res) => {
  try {
    res.json(await greenhouse.recordRequestErrors(req.apiAccount.accountId, req.body || {}));
  } catch (e) {
    console.error('greenhouse request_errors handler error:', e.message);
    res.json({ status: 200 });
  }
});

// Keep-alive refresher for the Partner-OAuth rotating refresh tokens (24h lifetime). Started from
// here (the module app.js loads for this integration) so app.js stays require+mount only; it
// no-ops entirely unless the flag is on and connections exist.
if (process.env.NODE_ENV !== 'test') {
  greenhouseOAuth.startKeepAlive();
}

module.exports = router;
