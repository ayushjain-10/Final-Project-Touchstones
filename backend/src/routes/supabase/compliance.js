/**
 * Compliance & Adverse-Impact (CC1) — /api/compliance
 * ----------------------------------------------------
 *  GET  /export/:scoreId              → defensibility record for one decision (JSON + summary_md)
 *  GET  /export/role/:role            → role-level defensibility export (rubric + per-decision lines)
 *  GET  /roles                        → roles available for analysis + opt-in label summary (UI)
 *  POST /labels                       → attach/upload OPT-IN group labels (validated, segregated)
 *  GET  /adverse-impact/role/:role    → EEOC four-fifths analysis (?attribute=&outcome=)
 *
 * ALL routes require a session and are scoped to the employer (the work_sample owner). The labels
 * table is owner-only RLS (063) and never exposed on candidate surfaces. Protected attributes are
 * employer-provided + opt-in only — never collected/inferred, never mixed into scoring.
 */
const express = require('express');
const router = express.Router();
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const { supabaseAdmin } = require('../../config/supabase');
const compliance = require('../../services/complianceService');

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });
const cleanAttr = (v) => (typeof v === 'string' ? v.trim().slice(0, 60) : '');
const cleanVal = (v) => (typeof v === 'string' ? v.trim().slice(0, 120) : '');

// Everything here requires a logged-in employer.
router.use(supabaseAuth);

// ── A. Defensibility export — single decision ──
router.get('/export/:scoreId', async (req, res) => {
  try {
    if (!isUUID(req.params.scoreId)) return fail(res, 400, 'invalid score id');
    const rec = await compliance.buildRecordForScore(req.params.scoreId);
    // Ownership gate: the record is only returned to the employer who owns the screen. A
    // mismatch is a plain 404 (no existence disclosure).
    if (!rec || rec._owner_id !== req.user.id) return fail(res, 404, 'record not found');
    delete rec._owner_id;
    res.json({ record: rec, summary_md: compliance.recordToSummaryMd(rec) });
  } catch (e) { fail(res, 500, e.message); }
});

// ── A. Defensibility export — whole role ──
router.get('/export/role/:role', async (req, res) => {
  try {
    const role = String(req.params.role || '').slice(0, 80);
    const out = await compliance.buildRoleExport(req.user.id, role);
    res.json(out);
  } catch (e) { fail(res, 500, e.message); }
});

// ── Roles + opt-in label summary (for the UI) ──
router.get('/roles', async (req, res) => {
  try {
    const [roles, labels] = await Promise.all([
      compliance.availableRoles(req.user.id),
      compliance.labelsSummary(req.user.id),
    ]);
    res.json({ roles, labels, selectable_outcomes: compliance.SELECTABLE_OUTCOMES, min_group_sample: compliance.MIN_GROUP_SAMPLE });
  } catch (e) { fail(res, 500, e.message); }
});

// ── B. Attach/upload OPT-IN group labels (segregated, account-scoped) ──
// body: { labels: [{ submission_id, attribute, value }] }  (or a single object).
router.post('/labels', async (req, res) => {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.labels) ? body.labels : [body];
    if (!items.length || items.length > 1000) return fail(res, 400, 'provide 1–1000 labels');

    let attached = 0;
    const skipped = [];
    for (const item of items) {
      const submission_id = item && item.submission_id;
      const attribute = cleanAttr(item && item.attribute);
      const value = cleanVal(item && item.value);
      if (!isUUID(submission_id) || !attribute || !value) { skipped.push({ submission_id, reason: 'invalid' }); continue; }

      // Employer-ownership gate: the labelled submission must belong to THIS employer's screen.
      const { data: sub } = await supabaseAdmin
        .from('work_sample_submissions').select('work_sample_id').eq('id', submission_id).maybeSingle();
      if (!sub) { skipped.push({ submission_id, reason: 'submission not found' }); continue; }
      const { data: ws } = await supabaseAdmin
        .from('work_samples').select('owner_id').eq('id', sub.work_sample_id).maybeSingle();
      if (!ws || ws.owner_id !== req.user.id) { skipped.push({ submission_id, reason: 'not your screen' }); continue; }

      // Write through the RLS-scoped client (063 WITH CHECK enforces account_id = auth.uid()).
      const { error } = await req.user.supabase
        .from('compliance_demographic_labels')
        .upsert(
          { account_id: req.user.id, submission_id, attribute, value, source: 'employer_provided', updated_at: new Date().toISOString() },
          { onConflict: 'account_id,submission_id,attribute' },
        );
      if (error) { skipped.push({ submission_id, reason: error.message }); continue; }
      attached += 1;
    }
    res.status(201).json({ attached, skipped_count: skipped.length, skipped: skipped.slice(0, 50) });
  } catch (e) { fail(res, 500, e.message); }
});

// ── B. Four-fifths adverse-impact analysis ──
router.get('/adverse-impact/role/:role', async (req, res) => {
  try {
    const role = String(req.params.role || '').slice(0, 80);
    const attribute = cleanAttr(req.query.attribute);
    const outcome = String(req.query.outcome || 'advanced');
    if (!attribute) return fail(res, 400, 'attribute query param is required');
    const out = await compliance.computeAdverseImpact({ accountId: req.user.id, role, attribute, outcome });
    if (!out.ok) return fail(res, 400, out.error || 'could not compute');
    res.json(out);
  } catch (e) { fail(res, 500, e.message); }
});

module.exports = router;
