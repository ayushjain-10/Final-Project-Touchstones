/**
 * Ashby Assessments — PARTNER-implemented endpoints (Ashby calls these on us).
 * Mounted at /integrations/ashby, so the four endpoints resolve at:
 *   POST /integrations/ashby/assessment.list
 *   POST /integrations/ashby/assessment.start
 *   POST /integrations/ashby/assessment.cancel
 *   POST /integrations/ashby/assessment.customField.list   (optional; flag-gated by Ashby)
 *
 * AUTH (inbound): Ashby authenticates with HTTP Basic, carrying the TOUCHSTONES API key the customer
 * pasted into the Ashby marketplace tile — key in the Basic-auth USERNAME with a blank password. We
 * accept the key in EITHER the username or password field, normalize it into X-API-Key, and delegate
 * to the EXISTING /v1 apiKeyAuth (sha256 -> api_keys lookup -> req.apiAccount). No forked auth scheme.
 * The normalization lives in middleware/partnerBasicKeyAuth (shared with the Greenhouse partner
 * endpoints); behavior is identical to the original inline ashbyInboundAuth.
 */
const express = require('express');
const router = express.Router();
const { partnerBasicKeyAuth } = require('../../middleware/partnerBasicKeyAuth');
const ashby = require('../../services/ashbyAssessmentService');

router.use(express.json());
router.use(partnerBasicKeyAuth);

// POST /assessment.list — empty body → the assessment types this customer can assign.
router.post('/assessment.list', async (req, res) => {
  try {
    const results = await ashby.listAssessmentTypes(req.apiAccount.accountId);
    res.json({ success: true, results });
  } catch (e) {
    console.error('ashby assessment.list error:', e.message);
    res.status(500).json({ success: false, message: 'Could not list assessments.' });
  }
});

// POST /assessment.start — create an assignment from the chosen type; return our assessment_id.
router.post('/assessment.start', async (req, res) => {
  try {
    const { assessment_id } = await ashby.startAssessment(req.apiAccount.accountId, req.body || {});
    res.json({ success: true, results: { assessment_id } });
  } catch (e) {
    if (e && e.name === 'AshbyStartError') {
      // 422 carries a user-facing { message } shown in Ashby; other statuses use the error envelope.
      if (e.httpStatus === 422) return res.status(422).json({ message: e.message });
      return res.status(e.httpStatus || 500).json({ success: false, message: e.message });
    }
    console.error('ashby assessment.start error:', e.message);
    res.status(500).json({ success: false, message: 'Could not start assessment.' });
  }
});

// POST /assessment.cancel — { assessment_id } → archive the assignment (soft-delete) → echo the id.
router.post('/assessment.cancel', async (req, res) => {
  try {
    const assessmentId = req.body && req.body.assessment_id;
    if (!assessmentId) return res.status(400).json({ success: false, message: 'assessment_id is required' });
    const r = await ashby.cancelAssessment(req.apiAccount.accountId, assessmentId);
    res.json({ success: true, results: { assessment_id: r.assessment_id } });
  } catch (e) {
    console.error('ashby assessment.cancel error:', e.message);
    res.status(500).json({ success: false, message: 'Could not cancel assessment.' });
  }
});

// POST /assessment.customField.list — optional, Ashby-flag-gated. Empty stub until we enable it.
router.post('/assessment.customField.list', (req, res) => {
  res.json({ fields: [] });
});

module.exports = router;
