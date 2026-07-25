/**
 * Assessment Templates routes — /api/assessments/...
 *
 * A LIBRARY of reusable, role-specific assessment templates (public, read-only
 * library rows seeded in migration 031) plus recruiter-authored CUSTOM templates.
 * A template is a reusable BLUEPRINT; a recruiter clones one into their own row to
 * customize, and (elsewhere) creates a concrete `work_sample` task FROM it.
 *
 * SECURITY: every read/write goes through req.user.supabase — the token-scoped
 * client (RLS is the tenant boundary; see middleware/supabaseAuth.js). We never
 * hand the service-role client to a user-supplied token. RLS (031) enforces:
 *   - SELECT: is_public = true OR created_by = auth.uid()
 *   - INSERT/UPDATE/DELETE: created_by = auth.uid()  (library rows are read-only)
 *
 * The rubric shape mirrors work_samples.rubric exactly so proofScoringService can
 * grade a cloned task unchanged: { criteria: [{id, requirement, points_possible, weight, anchors}] }.
 */
const express = require('express');
const router = express.Router();
const { supabaseAuth, requireRecruiter } = require('../../middleware/supabaseAuth');

router.use(supabaseAuth);

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// Known library positions. Custom recruiter templates may use any non-empty
// string, but the ?position= filter and create validation use this allow-list to
// catch typos and keep the library coherent.
const POSITIONS = ['senior-engineer', 'frontend', 'backend', 'fullstack', 'data_ml', 'devops', 'mobile'];

// Validate the rubric is scorer-compatible: a non-empty criteria[] where each
// criterion carries an id + numeric points_possible. This is the contract
// proofScoringService.computeScore() relies on (it computes the 0-100 score from
// per-criterion points in code, never from model prose).
function validateRubric(rubric) {
  if (!rubric || typeof rubric !== 'object' || !Array.isArray(rubric.criteria) || !rubric.criteria.length) {
    return 'rubric.criteria[] is required and must be non-empty';
  }
  const ids = new Set();
  for (const c of rubric.criteria) {
    if (!c || typeof c !== 'object') return 'each rubric criterion must be an object';
    if (!c.id || typeof c.id !== 'string') return 'each rubric criterion needs a string id';
    if (ids.has(c.id)) return `duplicate criterion id: ${c.id}`;
    ids.add(c.id);
    if (typeof c.points_possible !== 'number' || !Number.isFinite(c.points_possible) || c.points_possible < 0) {
      return `criterion "${c.id}" needs a non-negative numeric points_possible`;
    }
    if (c.weight !== undefined && (typeof c.weight !== 'number' || !Number.isFinite(c.weight))) {
      return `criterion "${c.id}" weight must be a number`;
    }
  }
  return null;
}

// Whitelist the writable columns for create/clone-overrides (prevents a caller
// from setting is_public/created_by/org_id to escalate visibility/ownership).
function pickTemplateFields(body) {
  const out = {};
  for (const k of ['position', 'title', 'summary', 'prompt_md', 'starter_files', 'languages', 'rubric', 'time_limit_min', 'tests']) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}

// --- List: library (public) + caller's own. Optional ?position= filter. ---
// RLS already scopes the rows to "public OR mine"; the filter is additive.
router.get('/', async (req, res) => {
  try {
    let q = req.user.supabase
      .from('assessment_templates')
      .select('*')
      .order('is_public', { ascending: false }) // library first, then custom
      .order('created_at', { ascending: false });
    if (req.query.position) {
      const pos = String(req.query.position);
      if (!POSITIONS.includes(pos)) return fail(res, 400, `invalid position; expected one of: ${POSITIONS.join(', ')}`);
      q = q.eq('position', pos);
    }
    const { data, error } = await q;
    if (error) return fail(res, 500, error.message);
    res.json({ templates: data || [] });
  } catch (e) { fail(res, 500, e.message); }
});

// --- Global public library: only is_public=true rows (the shared, read-only
// library any authenticated recruiter can browse). Optional ?position= filter
// (no allow-list here: seeded library rows use their source role_family verbatim,
// e.g. "data"/"ml", so we pass the value straight through). Registered BEFORE
// GET /:id so "public" is never captured as an :id. ---
router.get('/public', async (req, res) => {
  try {
    let q = req.user.supabase
      .from('assessment_templates')
      .select('*')
      .eq('is_public', true)
      .order('created_at', { ascending: false });
    if (req.query.position) q = q.eq('position', String(req.query.position));
    const { data, error } = await q;
    if (error) return fail(res, 500, error.message);
    res.json({ templates: data || [] });
  } catch (e) { fail(res, 500, e.message); }
});

// --- One template (RLS enforces visibility: public or owned). ---
router.get('/:id', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { data, error } = await req.user.supabase
      .from('assessment_templates').select('*').eq('id', req.params.id).single();
    if (error || !data) return fail(res, 404, 'assessment template not found');
    res.json(data);
  } catch (e) { fail(res, 500, e.message); }
});

// --- Create a custom template (created_by = caller; never public). ---
router.post('/', requireRecruiter, async (req, res) => {
  try {
    const body = req.body || {};
    const { position, title, prompt_md, rubric } = body;
    if (!position || typeof position !== 'string') return fail(res, 400, 'position is required');
    if (!POSITIONS.includes(position)) return fail(res, 400, `invalid position; expected one of: ${POSITIONS.join(', ')}`);
    if (!title || typeof title !== 'string') return fail(res, 400, 'title is required');
    if (!prompt_md || typeof prompt_md !== 'string') return fail(res, 400, 'prompt_md is required');
    const rubricErr = validateRubric(rubric);
    if (rubricErr) return fail(res, 400, rubricErr);

    const row = {
      ...pickTemplateFields(body),
      starter_files: Array.isArray(body.starter_files) ? body.starter_files : [],
      languages: Array.isArray(body.languages) ? body.languages : [],
      is_public: false,                 // recruiter rows are private; only seeds are public
      created_by: req.user.id,          // RLS WITH CHECK requires this == auth.uid()
      org_id: req.user.org_id || null,
    };
    const { data, error } = await req.user.supabase
      .from('assessment_templates').insert(row).select().single();
    if (error) return fail(res, 500, error.message);
    res.status(201).json(data);
  } catch (e) { fail(res, 500, e.message); }
});

// --- Update an owned template. RLS blocks updates to non-owned/library rows. ---
router.put('/:id', requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    // Visibility/ownership gate: must be readable AND owned by the caller.
    const { data: existing, error: e0 } = await req.user.supabase
      .from('assessment_templates').select('id, created_by').eq('id', req.params.id).single();
    if (e0 || !existing) return fail(res, 404, 'assessment template not found');
    if (existing.created_by !== req.user.id) return fail(res, 403, 'you can only edit your own templates');

    const patch = pickTemplateFields(req.body || {});
    if (patch.position !== undefined && !POSITIONS.includes(patch.position)) {
      return fail(res, 400, `invalid position; expected one of: ${POSITIONS.join(', ')}`);
    }
    if (patch.rubric !== undefined) {
      const rubricErr = validateRubric(patch.rubric);
      if (rubricErr) return fail(res, 400, rubricErr);
    }
    if (!Object.keys(patch).length) return fail(res, 400, 'no updatable fields provided');
    patch.updated_at = new Date().toISOString();

    const { data, error } = await req.user.supabase
      .from('assessment_templates').update(patch).eq('id', req.params.id).select().single();
    if (error) return fail(res, 500, error.message);
    res.json(data);
  } catch (e) { fail(res, 500, e.message); }
});

// --- Clone a (library or owned) template into a new recruiter-owned row. ---
// The source must be readable under RLS (public or owned). Optional body fields
// override the copy (e.g. a new title) and are validated like create.
router.post('/:id/clone', requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { data: src, error: e0 } = await req.user.supabase
      .from('assessment_templates').select('*').eq('id', req.params.id).single();
    if (e0 || !src) return fail(res, 404, 'assessment template not found or not accessible');

    const overrides = pickTemplateFields(req.body || {});
    if (overrides.position !== undefined && !POSITIONS.includes(overrides.position)) {
      return fail(res, 400, `invalid position; expected one of: ${POSITIONS.join(', ')}`);
    }
    if (overrides.rubric !== undefined) {
      const rubricErr = validateRubric(overrides.rubric);
      if (rubricErr) return fail(res, 400, rubricErr);
    }

    const row = {
      position: src.position,
      title: `${src.title} (copy)`,
      summary: src.summary,
      prompt_md: src.prompt_md,
      starter_files: src.starter_files || [],
      languages: src.languages || [],
      rubric: src.rubric,
      time_limit_min: src.time_limit_min,
      ...overrides,                     // caller-supplied overrides win
      is_public: false,                 // a clone is always a private custom row
      created_by: req.user.id,          // RLS WITH CHECK requires this == auth.uid()
      org_id: req.user.org_id || null,
    };
    const { data, error } = await req.user.supabase
      .from('assessment_templates').insert(row).select().single();
    if (error) return fail(res, 500, error.message);
    res.status(201).json(data);
  } catch (e) { fail(res, 500, e.message); }
});

// --- Instantiate a (library or owned) template as a NEW recruiter-owned work_sample. ---
// This is the "use this from the public library" action: it materializes a reusable
// template BLUEPRINT into a concrete, invite-able screen the caller owns (distinct from
// POST /:id/clone above, which copies a template into another template for editing).
// The source must be readable under RLS (public or owned). response_type is inferred
// from whether the template ships auto-grading test cases. Mirrors the work_samples
// insert shape in proof.js (POST /proof/work-samples).
router.post('/:id/use', requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { data: src, error: e0 } = await req.user.supabase
      .from('assessment_templates').select('*').eq('id', req.params.id).single();
    if (e0 || !src) return fail(res, 404, 'assessment template not found or not accessible');

    const hasTestCases = !!(src.tests && !Array.isArray(src.tests) && Array.isArray(src.tests.cases) && src.tests.cases.length);
    const row = {
      owner_id: req.user.id,               // RLS WITH CHECK on work_samples requires this == auth.uid()
      title: src.title,
      role_family: src.position || null,
      prompt_md: src.prompt_md,
      response_type: hasTestCases ? 'code' : 'markdown',
      duration_minutes: src.time_limit_min || 60,
      rubric: src.rubric,
      starter_files: Array.isArray(src.starter_files) ? src.starter_files : [],
      languages: Array.isArray(src.languages) ? src.languages : [],
      tests: hasTestCases ? src.tests : null,
      status: 'draft',                     // recruiter reviews/renames before inviting
    };
    const { data, error } = await req.user.supabase
      .from('work_samples').insert(row).select().single();
    if (error) return fail(res, 500, error.message);
    res.status(201).json(data);
  } catch (e) { fail(res, 500, e.message); }
});

module.exports = router;
