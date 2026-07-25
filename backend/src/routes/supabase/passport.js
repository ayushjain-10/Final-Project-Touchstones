/**
 * Touchstones Passport (S4) — /api/passport
 * -----------------------------------------
 * A candidate-owned, portable proof-of-capability profile. ONE passport per
 * candidate (profiles.id), addressed by a public `handle`, aggregating their
 * VISIBLE verified results (each = an already-issued, public-safe credential +
 * snapshotted proof-of-human + optional score percentile).
 *
 * Auth shape (mirrors credentials.js): GET /:handle is PUBLIC — registered BEFORE
 * router.use(supabaseAuth), served by the SECURITY DEFINER get_passport() RPC
 * (redacted, no PII, no broad read policy). Everything else requires a session
 * and is RLS-scoped to the candidate (auth.uid()).
 */
const express = require('express');
const router = express.Router();
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const { supabase, supabaseAdmin } = require('../../config/supabase');
const integrityDigestService = require('../../services/integrityDigestService');
const calibrationService = require('../../services/calibrationService');
const {
  normalizeHandle,
  proofOfHumanFromDigest,
  pickPublicEntry,
} = require('../../services/passportService');

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

// ── PUBLIC: a candidate's shareable passport by handle (NO auth) ──
// Redacted via the get_passport RPC; we re-allowlist the entry shape as
// defense-in-depth. A missing/private handle is a plain 404 (no enumeration).
router.get('/:handle', async (req, res) => {
  try {
    const handle = String(req.params.handle || '');
    if (!handle || handle.length > 64 || !/^[a-zA-Z0-9-]+$/.test(handle)) {
      return res.status(404).json({ error: 'passport not found' });
    }
    const { data, error } = await supabase.rpc('get_passport', { p_handle: handle });
    if (error) return fail(res, 500, error.message);
    if (!data) return res.status(404).json({ error: 'passport not found' });
    const entries = Array.isArray(data.entries) ? data.entries.map(pickPublicEntry) : [];
    res.json({
      handle: data.handle,
      display_name: data.display_name,
      headline: data.headline,
      created_at: data.created_at,
      entries,
    });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// Everything below requires a logged-in user (the candidate who owns the passport).
router.use(supabaseAuth);

// GET /api/passport — the signed-in user's OWN passport + ALL entries (incl hidden),
// for management. Returns { passport: null } when they haven't claimed one yet.
router.get('/', async (req, res) => {
  try {
    const { data: passport } = await req.user.supabase
      .from('passports')
      .select('id, handle, display_name, headline, is_public, created_at, updated_at')
      .eq('candidate_id', req.user.id)
      .maybeSingle();
    if (!passport) return res.json({ passport: null, entries: [] });
    const { data: entries } = await req.user.supabase
      .from('passport_entries')
      .select('id, credential_id, submission_id, title, role_family, proof_of_human, percentile, is_visible, sort_order, created_at')
      .eq('passport_id', passport.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
    res.json({ passport, entries: entries || [] });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// POST /api/passport — create/claim a passport. body { handle, display_name?, headline? }.
router.post('/', async (req, res) => {
  try {
    const handle = normalizeHandle(req.body && req.body.handle);
    if (!handle) {
      return fail(res, 400, 'Pick a handle: 3-32 lowercase letters, numbers, or single hyphens.');
    }
    const row = {
      candidate_id: req.user.id,
      handle,
      display_name: clip(req.body && req.body.display_name, 80),
      headline: clip(req.body && req.body.headline, 160),
    };
    const { data, error } = await req.user.supabase.from('passports').insert(row).select().single();
    if (error) {
      // unique_violation: handle already taken OR this account already has a passport.
      if (error.code === '23505') return fail(res, 409, 'That handle is taken, or you already have a passport.');
      return fail(res, 500, error.message);
    }
    res.status(201).json({ passport: data });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// PATCH /api/passport — update display_name / headline / is_public on my passport.
router.patch('/', async (req, res) => {
  try {
    const patch = {};
    if (req.body && 'display_name' in req.body) patch.display_name = clip(req.body.display_name, 80);
    if (req.body && 'headline' in req.body) patch.headline = clip(req.body.headline, 160);
    if (req.body && 'is_public' in req.body) patch.is_public = !!req.body.is_public;
    if (req.body && req.body.handle != null) {
      const h = normalizeHandle(req.body.handle);
      if (!h) return fail(res, 400, 'Invalid handle.');
      patch.handle = h;
    }
    if (!Object.keys(patch).length) return fail(res, 400, 'Nothing to update.');
    patch.updated_at = new Date().toISOString();
    const { data, error } = await req.user.supabase
      .from('passports')
      .update(patch)
      .eq('candidate_id', req.user.id)
      .select()
      .single();
    if (error) {
      if (error.code === '23505') return fail(res, 409, 'That handle is taken.');
      return fail(res, 500, error.message);
    }
    if (!data) return fail(res, 404, 'No passport to update — claim a handle first.');
    res.json({ passport: data });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// POST /api/passport/entries — add one of MY verified credentials to my passport.
// body { credential_id }. Snapshots title/role/proof-of-human/percentile at add-time.
router.post('/entries', async (req, res) => {
  try {
    const body = req.body || {};
    const credentialId = body.credential_id;
    const token = typeof body.token === 'string' ? body.token.trim() : null;
    const tokenOk = token && token.length <= 128 && /^[0-9a-zA-Z]+$/.test(token);
    if (!isUUID(credentialId) && !tokenOk) {
      return fail(res, 400, 'Provide a credential_id or a verify token/link.');
    }

    // my passport must exist first.
    const { data: passport } = await req.user.supabase
      .from('passports').select('id').eq('candidate_id', req.user.id).maybeSingle();
    if (!passport) return fail(res, 400, 'Claim a handle before adding results.');

    // ownership gate: the candidate can read their OWN credential under RLS
    // (cred_candidate) — by id OR by its public verify token.
    let credQuery = req.user.supabase.from('verified_credentials').select('id, submission_id, score');
    credQuery = isUUID(credentialId) ? credQuery.eq('id', credentialId) : credQuery.eq('public_token', token);
    const { data: cred } = await credQuery.maybeSingle();
    if (!cred) return fail(res, 404, 'credential not found or not yours');

    // Resolve the authoritative display/trust fields SERVER-SIDE. (S4-1b: these columns are
    // NOT candidate-writable — migration 061 strips the column privilege — so they are set
    // here via the service role, never trusted from the client.)
    let title = null;
    let roleFamily = null;
    let ownerId = null;
    if (cred.submission_id) {
      const { data: sub } = await supabaseAdmin
        .from('work_sample_submissions').select('work_sample_id').eq('id', cred.submission_id).maybeSingle();
      if (sub && sub.work_sample_id) {
        const { data: ws } = await supabaseAdmin
          .from('work_samples').select('title, role_family, owner_id').eq('id', sub.work_sample_id).maybeSingle();
        if (ws) { title = ws.title || null; roleFamily = ws.role_family || null; ownerId = ws.owner_id || null; }
      }
    }

    // Proof-of-human from the integrity digest (behavioral; degrade to advisory 'review').
    let proofOfHuman = 'review';
    if (cred.submission_id) {
      try {
        proofOfHuman = proofOfHumanFromDigest(await integrityDigestService.computeDigest(cred.submission_id));
      } catch { /* advisory 'review' */ }
    }

    // Role-scoped percentile via the calibration engine (S4-5) — reuse calibrationService,
    // never an ad-hoc global query. Account-first with the k-anonymized global fallback;
    // null when below the sample floor so the UI degrades honestly.
    let percentile = null;
    try {
      const cal = await calibrationService.calibrationForScore({ score: cred.score, roleFamily, accountId: ownerId });
      percentile = cal && typeof cal.percentile === 'number' ? cal.percentile : null;
    } catch { /* leave null */ }

    // Base insert via the RLS-scoped client — migration 060 enforces credential ownership.
    // (Only the candidate-ownable columns; the trust columns are written by the service role
    // next, because authenticated has no column privilege for them — migration 061.)
    const { data: created, error } = await req.user.supabase
      .from('passport_entries')
      .insert({ passport_id: passport.id, credential_id: cred.id, submission_id: cred.submission_id })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') return fail(res, 409, 'That result is already on your passport.');
      return fail(res, 500, error.message);
    }

    // Authoritative trust fields (service role — candidates cannot forge these).
    const { data, error: uerr } = await supabaseAdmin
      .from('passport_entries')
      .update({ title, role_family: roleFamily, proof_of_human: proofOfHuman, percentile })
      .eq('id', created.id)
      .select()
      .single();
    if (uerr) return fail(res, 500, uerr.message);
    res.status(201).json({ entry: data });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// PATCH /api/passport/entries/:id — toggle visibility / reorder one of my entries.
router.patch('/entries/:id', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const patch = {};
    if (req.body && 'is_visible' in req.body) patch.is_visible = !!req.body.is_visible;
    if (req.body && 'sort_order' in req.body) patch.sort_order = Number(req.body.sort_order) || 0;
    if (!Object.keys(patch).length) return fail(res, 400, 'Nothing to update.');
    const { data, error } = await req.user.supabase
      .from('passport_entries').update(patch).eq('id', req.params.id).select().maybeSingle();
    if (error) return fail(res, 500, error.message);
    if (!data) return fail(res, 404, 'entry not found');
    res.json({ entry: data });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// DELETE /api/passport/entries/:id — remove one of my entries (RLS-scoped).
router.delete('/entries/:id', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { error } = await req.user.supabase
      .from('passport_entries').delete().eq('id', req.params.id);
    if (error) return fail(res, 500, error.message);
    res.json({ deleted: true, id: req.params.id });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

module.exports = router;
