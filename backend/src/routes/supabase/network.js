/**
 * Candidate Network / "Apply with Touchstones" (CC3/v3) — /api/network
 * --------------------------------------------------------------------
 * The candidate-INITIATED side of the accept-prior network. v2 built the recruiter-initiated
 * accept-prior (credentials.js → credential_acceptances): a recruiter pastes a credential link
 * and accepts it. CC3 builds the other side: a candidate attaches one of THEIR OWN verified
 * credentials to an employer's open req (network_reqs) — reusing a screen they already passed
 * — and the employer accepts it WITHOUT re-screening. Every accepted credential strengthens
 * the standard (the venture-scale moat).
 *
 * Auth shape (mirrors credentials.js / passport.js): GET /apply/:token is PUBLIC — registered
 * BEFORE router.use(supabaseAuth), served by the SECURITY DEFINER get_req() RPC via the
 * service-role client (the RPC is REVOKEd from anon/authenticated — the strict 062 lesson —
 * so it is never directly reachable from a raw PostgREST call). Everything else requires a
 * Supabase session and is RLS-scoped to auth.uid().
 *
 * SECURITY (the v2 lessons — see migrations 071–073):
 *   • RLS-first ownership (the 060 lesson): a candidate applies ONLY with a credential they
 *     own, only AS themselves — enforced by credential_applications' INSERT WITH CHECK, not
 *     just by the Express read below. We read/insert through req.user.supabase (RLS-scoped),
 *     never the service-role client, on the candidate write path.
 *   • Server-authoritative columns (the 061 lesson): status / accepted_at are never client-set
 *     — status flips to 'accepted' only on the req-owner-gated accept route; accepted_at is
 *     stamped server-side. The candidate's credential token is read via the credential join
 *     (get_req_applications), so it is never denormalized onto the application row.
 *   • Reuse, don't duplicate: acceptance reuses the v2 accept-prior upsert + counter; tamper
 *     evidence is the existing get_credential_full() (credentials.js) — never re-implemented.
 */
const express = require('express');
const router = express.Router();
const { supabaseAuth, requireRecruiter } = require('../../middleware/supabaseAuth');
const { supabaseAdmin } = require('../../config/supabase');
const {
  tokenValid,
  tokenFromInput,
  clip,
  MAX_ROLE,
  MAX_COMPANY,
  normalizeReqTitle,
  pickPublicReq,
  buildApplicationInsert,
  summarizeReuse,
} = require('../../services/networkService');

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });
const frontendBase = () => (process.env.FRONTEND_URL || '').replace(/\/+$/, '');

// ── PUBLIC: redacted req context for the candidate-facing /apply/:token page (NO auth) ──
// Served by the SECURITY DEFINER get_req() RPC through the service-role client — the RPC is
// REVOKEd from anon/authenticated, so even a direct PostgREST call cannot read it. DATA only
// (title/role/company/is_open) — no owner id, no PII. A missing token is a plain 404.
router.get('/apply/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (!tokenValid(token)) return res.status(404).json({ valid: false });
    const { data, error } = await supabaseAdmin.rpc('get_req', { p_token: token });
    if (error) return fail(res, 500, error.message);
    if (!data) return res.status(404).json({ valid: false });
    res.json({ valid: true, req: pickPublicReq(data) });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// Everything below requires a logged-in user.
router.use(supabaseAuth);

// ───────────────────────── Candidate side ─────────────────────────

// GET /api/network/credentials — the candidate dashboard read: MY verified credentials with
// the network signal (reuse / "accepted by N teams"), whether each is on my passport, and how
// many reqs I've applied to it with. RLS-scoped to my own credentials.
router.get('/credentials', async (req, res) => {
  try {
    const { data: creds } = await req.user.supabase
      .from('verified_credentials')
      .select('id, public_token, score, direction_score, issued_at, revoked_at')
      .eq('candidate_id', req.user.id)
      .order('issued_at', { ascending: false });
    const rows = creds || [];
    const credIds = rows.map((c) => c.id);

    let reuse = {};
    const onPassport = new Set();
    const proofByCred = {};
    const appCount = {};
    if (credIds.length) {
      // Reuse counts — candidates cannot read credential_acceptances under RLS, so gather via
      // the service role keyed STRICTLY to my own (RLS-gated) credential ids; count in code.
      const { data: accs } = await supabaseAdmin
        .from('credential_acceptances')
        .select('credential_id, accepting_account_id')
        .in('credential_id', credIds);
      reuse = summarizeReuse(accs, credIds);

      // Which credentials are on my passport + the REAL proof-of-human snapshot (RLS-scoped to
      // my own entries; the snapshot is server-authoritative per migration 061 — never forged).
      const { data: entries } = await req.user.supabase
        .from('passport_entries')
        .select('credential_id, proof_of_human');
      for (const e of entries || []) {
        if (!e.credential_id) continue;
        onPassport.add(e.credential_id);
        if (e.proof_of_human) proofByCred[e.credential_id] = e.proof_of_human;
      }

      // How many reqs I've applied to with each credential (my own applications).
      const { data: apps } = await req.user.supabase
        .from('credential_applications')
        .select('credential_id')
        .eq('candidate_id', req.user.id);
      for (const a of apps || []) appCount[a.credential_id] = (appCount[a.credential_id] || 0) + 1;
    }

    res.json({
      credentials: rows.map((c) => ({
        id: c.id,
        token: c.public_token,
        score: c.score,
        direction_score: c.direction_score,
        issued_at: c.issued_at,
        revoked: !!c.revoked_at,
        // CF-2 (v3-hardening-2): a revoked credential is hidden on every PUBLIC surface
        // (get_credential_full / get_passport exclude revoked_at), so its network "accepted by
        // N teams" signal must read as 0 on the owner dashboard too — never surface a stale
        // reuse count for a credential that no longer verifies.
        reuse_count: c.revoked_at ? 0 : (reuse[c.id] || 0),
        on_passport: onPassport.has(c.id),
        proof_of_human: proofByCred[c.id] || null,
        application_count: appCount[c.id] || 0,
      })),
    });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// GET /api/network/applications — MY applications (RLS-scoped), each with its public-safe req
// context for display. The candidate cannot read network_reqs under RLS, so the display fields
// are resolved via the service role keyed strictly to the req ids on MY OWN gated applications.
router.get('/applications', async (req, res) => {
  try {
    const { data: apps } = await req.user.supabase
      .from('credential_applications')
      .select('id, req_id, credential_id, status, note, accepted_at, created_at')
      .eq('candidate_id', req.user.id)
      .order('created_at', { ascending: false });
    const rows = apps || [];

    const reqIds = [...new Set(rows.map((r) => r.req_id).filter(Boolean))];
    const reqsById = {};
    if (reqIds.length) {
      const { data: reqs } = await supabaseAdmin
        .from('network_reqs')
        .select('id, title, role_family, company_label, is_open, created_at')
        .in('id', reqIds);
      for (const r of reqs || []) reqsById[r.id] = pickPublicReq(r);
    }
    res.json({ applications: rows.map((a) => ({ ...a, req: reqsById[a.req_id] || null })) });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// POST /api/network/apply — apply to a req with one of MY OWN verified credentials.
// body { req_token, credential_id? | token?, note? }. Ownership is enforced by RLS
// (app_candidate_insert), not just the read below.
router.post('/apply', async (req, res) => {
  try {
    const body = req.body || {};
    const reqToken = tokenFromInput(body.req_token);
    if (!tokenValid(reqToken)) return fail(res, 400, 'A valid apply link or req token is required.');

    const credentialId = body.credential_id;
    const credToken = typeof body.token === 'string' ? tokenFromInput(body.token) : null;
    const credTokenOk = credToken && tokenValid(credToken);
    if (!isUUID(credentialId) && !credTokenOk) {
      return fail(res, 400, 'Choose one of your verified credentials to apply with.');
    }

    // Resolve the req by its public token (service role; network_reqs is not candidate-readable).
    const { data: reqRow } = await supabaseAdmin
      .from('network_reqs')
      .select('id, is_open')
      .eq('public_token', reqToken)
      .maybeSingle();
    if (!reqRow) return fail(res, 404, 'That req could not be found.');
    if (!reqRow.is_open) return fail(res, 409, 'This req is no longer accepting applications.');

    // OWNERSHIP GATE (RLS): read MY OWN credential under cred_candidate — by id OR verify token.
    // A credential that isn't mine simply isn't returned.
    let credQuery = req.user.supabase
      .from('verified_credentials')
      .select('id, revoked_at');
    credQuery = isUUID(credentialId)
      ? credQuery.eq('id', credentialId)
      : credQuery.eq('public_token', credToken);
    const { data: cred } = await credQuery.maybeSingle();
    if (!cred) return fail(res, 404, 'Credential not found or not yours.');
    if (cred.revoked_at) return fail(res, 409, 'That credential has been revoked.');

    // Base insert via the RLS-scoped client — migration 072 enforces candidate + credential
    // ownership in the policy. buildApplicationInsert strips any client-supplied trust/lifecycle
    // column (defense-in-depth over the stripped column grant).
    const insert = buildApplicationInsert({
      reqId: reqRow.id,
      candidateId: req.user.id,
      credentialId: cred.id,
      note: body.note,
    });
    const { data: created, error } = await req.user.supabase
      .from('credential_applications')
      .insert(insert)
      .select('id, status, created_at')
      .single();
    if (error) {
      if (error.code === '23505') {
        // Idempotent re-apply: surface the existing application (RLS-scoped to mine).
        const { data: existing } = await req.user.supabase
          .from('credential_applications')
          .select('id, status, created_at')
          .eq('req_id', reqRow.id)
          .eq('credential_id', cred.id)
          .maybeSingle();
        if (existing) return res.status(200).json({ application: existing, already: true });
        return fail(res, 409, 'You have already applied to this req with that credential.');
      }
      return fail(res, 500, error.message);
    }
    res.status(201).json({ application: created });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// DELETE /api/network/applications/:id — withdraw MY application (RLS-scoped delete).
router.delete('/applications/:id', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    // .select() returns the deleted rows so we can distinguish a real withdraw from a no-op
    // (wrong id, already-withdrawn, or an RLS-blocked row that silently deletes nothing).
    const { data, error } = await req.user.supabase
      .from('credential_applications')
      .delete()
      .eq('id', req.params.id)
      .select('id');
    if (error) return fail(res, 500, error.message);
    if (!data || data.length === 0) return fail(res, 404, 'Application not found.');
    res.json({ deleted: true, id: req.params.id });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// ───────────────────────── Employer side (req owner) ─────────────────────────

// POST /api/network/reqs — create an open req. body { title, role_family?, company_label? }.
// Returns the req + a shareable apply link. RLS req_owner_insert binds owner_id = auth.uid().
router.post('/reqs', requireRecruiter, async (req, res) => {
  try {
    const body = req.body || {};
    const title = normalizeReqTitle(body.title);
    if (!title) return fail(res, 400, 'A req title is required.');
    const row = {
      owner_id: req.user.id,
      title,
      role_family: clip(body.role_family, MAX_ROLE),
      company_label: clip(body.company_label, MAX_COMPANY),
    };
    const { data, error } = await req.user.supabase.from('network_reqs').insert(row).select().single();
    if (error) return fail(res, 500, error.message);
    res.status(201).json({ req: data, apply_url: `${frontendBase()}/apply/${data.public_token}` });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// GET /api/network/reqs — MY reqs with application counts + apply links. RLS-scoped to owner.
router.get('/reqs', requireRecruiter, async (req, res) => {
  try {
    const { data: reqs } = await req.user.supabase
      .from('network_reqs')
      .select('id, public_token, title, role_family, company_label, is_open, created_at')
      .eq('owner_id', req.user.id)
      .order('created_at', { ascending: false });
    const rows = reqs || [];
    const reqIds = rows.map((r) => r.id);

    const counts = {};
    if (reqIds.length) {
      // Application counts — the RLS-scoped read (app_req_owner_select) returns only apps to
      // reqs I own; count in code.
      const { data: apps } = await req.user.supabase
        .from('credential_applications')
        .select('req_id, status')
        .in('req_id', reqIds);
      for (const a of apps || []) {
        const c = counts[a.req_id] || (counts[a.req_id] = { total: 0, accepted: 0 });
        c.total += 1;
        if (a.status === 'accepted') c.accepted += 1;
      }
    }
    const base = frontendBase();
    res.json({
      reqs: rows.map((r) => ({
        ...r,
        apply_url: `${base}/apply/${r.public_token}`,
        application_count: counts[r.id]?.total || 0,
        accepted_count: counts[r.id]?.accepted || 0,
      })),
    });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// PATCH /api/network/reqs/:id — update title/role/company or open/close. RLS-scoped to owner.
router.patch('/reqs/:id', requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const body = req.body || {};
    const patch = {};
    if ('title' in body) {
      const t = normalizeReqTitle(body.title);
      if (!t) return fail(res, 400, 'Invalid title.');
      patch.title = t;
    }
    if ('role_family' in body) patch.role_family = clip(body.role_family, MAX_ROLE);
    if ('company_label' in body) patch.company_label = clip(body.company_label, MAX_COMPANY);
    if ('is_open' in body) patch.is_open = !!body.is_open;
    if (!Object.keys(patch).length) return fail(res, 400, 'Nothing to update.');
    patch.updated_at = new Date().toISOString();
    const { data, error } = await req.user.supabase
      .from('network_reqs')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();
    if (error) return fail(res, 500, error.message);
    if (!data) return fail(res, 404, 'Req not found.');
    res.json({ req: data });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// GET /api/network/reqs/:id/applications — the employer inbox for ONE req. The RLS-scoped read
// of network_reqs is the TENANT GATE (owner only); once gated, the service-role
// get_req_applications() RPC returns each application + the candidate's verified-credential
// summary (the req owner cannot read verified_credentials directly). No PII — only the
// candidate's PUBLIC passport handle is surfaced.
router.get('/reqs/:id/applications', requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { data: reqRow } = await req.user.supabase
      .from('network_reqs')
      .select('id, title, is_open')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!reqRow) return fail(res, 404, 'Req not found.');
    const { data, error } = await supabaseAdmin.rpc('get_req_applications', { p_req_id: req.params.id });
    if (error) return fail(res, 500, error.message);
    res.json({ req: reqRow, applications: Array.isArray(data) ? data : data || [] });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// POST /api/network/applications/:id/accept — the req owner accepts an application WITHOUT
// re-screening. Reuses the v2 accept-prior path (idempotent upsert + distinct-team counter);
// adds the req-ownership gate + the application status transition.
router.post('/applications/:id/accept', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');

    // Load the application. NOTE: credential_applications has TWO OR-ed SELECT policies
    // (app_candidate_select + app_req_owner_select), so a successful read here does NOT prove
    // req ownership — the applicant can also read their own row. We gate ownership separately.
    const { data: app } = await req.user.supabase
      .from('credential_applications')
      .select('id, req_id, candidate_id, credential_id, status')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!app) return fail(res, 404, 'Application not found.');

    // TENANT GATE (the real one): only the REQ OWNER may accept. network_reqs has an
    // owner-ONLY SELECT policy (req_owner_select, 071), so an RLS-scoped read that returns the
    // req proves ownership — unlike the application read above, which is OR-ed with the
    // candidate's own-row policy and would let an applicant self-accept.
    const { data: ownedReq } = await req.user.supabase
      .from('network_reqs')
      .select('id')
      .eq('id', app.req_id)
      .maybeSingle();
    if (!ownedReq) return fail(res, 403, 'Only the req owner can accept this application.');

    // Defense-in-depth: never let an account accept its OWN application — self-acceptance would
    // forge the "accepted by N teams" trust counter (accepting_account_id = the applicant).
    if (app.candidate_id === req.user.id) {
      return fail(res, 403, 'You cannot accept your own application.');
    }

    // Resolve the credential live (service role) and ensure it is still valid (not revoked).
    const { data: cred } = await supabaseAdmin
      .from('verified_credentials')
      .select('id, public_token, revoked_at')
      .eq('id', app.credential_id)
      .maybeSingle();
    if (!cred || cred.revoked_at) {
      return res.status(409).json({ error: 'Credential not found or revoked.' });
    }

    const { data: reqRow } = await supabaseAdmin
      .from('network_reqs')
      .select('id, title')
      .eq('id', app.req_id)
      .maybeSingle();

    // ACCEPT — REUSE accept-prior: idempotent upsert on (credential_id, accepting_account_id).
    // Same integrity / counter semantics as credentials.js; we additionally stamp req_id.
    const { error: aerr } = await supabaseAdmin.from('credential_acceptances').upsert(
      {
        credential_id: cred.id,
        public_token: cred.public_token,
        accepting_account_id: req.user.id,
        req_label: reqRow ? reqRow.title : null,
        req_id: app.req_id,
      },
      { onConflict: 'credential_id,accepting_account_id' },
    );
    if (aerr) return fail(res, 500, aerr.message);

    // Mark the application accepted (server-authoritative — service role). Check the error so a
    // recorded acceptance can't silently leave the application stuck at 'submitted'.
    const { error: uerr } = await supabaseAdmin
      .from('credential_applications')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', app.id);
    if (uerr) return fail(res, 500, uerr.message);

    // Fresh network counter — distinct accepting teams (same COUNT as accept-prior).
    const { count } = await supabaseAdmin
      .from('credential_acceptances')
      .select('id', { count: 'exact', head: true })
      .eq('credential_id', cred.id);
    res.status(201).json({ accepted: true, accepted_count: count ?? null });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

module.exports = router;
