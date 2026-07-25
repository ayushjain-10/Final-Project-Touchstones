/**
 * Console API-key management for the Verify API (`/api/keys`).
 * -----------------------------------------------------------
 * These endpoints are part of the recruiter CONSOLE, so they sit behind the EXISTING
 * `supabaseAuth` (a logged-in Supabase session), NOT apiKeyAuth. Every row is scoped to
 * the caller's account (req.user.id == account_id == profiles.id). Reads/writes go through
 * the token-scoped client (req.user.supabase) so RLS (migration 039) is the tenant
 * boundary — we never hand service-role to these handlers.
 *
 * SECURITY: the FULL plaintext key is returned exactly ONCE — at create and at rotate.
 * Thereafter only the masked form (prefix + '...' + last4) is ever exposed; the hash is
 * never returned. There is no recovery path (rotate to get a new key).
 *
 *   POST   /api/keys            { name?, mode } → create; returns full key once + masked row
 *   GET    /api/keys                            → list masked keys for the account
 *   POST   /api/keys/:id/rotate                 → revoke old + issue new (full key once)
 *   DELETE /api/keys/:id                        → revoke (set revoked_at)
 */
const express = require('express');
const router = express.Router();
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const { generateKey, hashKey } = require('../../services/apiKeyService');

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// Masked, console-safe representation of a key row. NEVER includes hashed_key.
const maskRow = (row) => ({
  id: row.id,
  name: row.name,
  mode: row.mode,
  scopes: Array.isArray(row.scopes) ? row.scopes : [],
  masked_key: `${row.prefix}...${row.last4}`,
  prefix: row.prefix,
  last4: row.last4,
  created_at: row.created_at,
  last_used_at: row.last_used_at,
  revoked_at: row.revoked_at,
});

// All routes require a logged-in console user.
router.use(supabaseAuth);

// POST /api/keys — create a key. Body: { name?, mode }. mode ∈ {live,test}.
router.post('/', async (req, res) => {
  try {
    const { name, mode, scopes } = req.body || {};
    if (mode !== 'live' && mode !== 'test') {
      return fail(res, 400, "mode must be 'live' or 'test'");
    }
    const safeName = (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 120) : null;
    const safeScopes = Array.isArray(scopes)
      ? scopes.filter((s) => typeof s === 'string').slice(0, 32)
      : [];

    const { plaintext, prefix, last4 } = generateKey(mode);
    const hashed_key = hashKey(plaintext);

    const { data, error } = await req.user.supabase
      .from('api_keys')
      .insert({
        account_id: req.user.id,
        name: safeName,
        prefix,
        hashed_key,
        last4,
        mode,
        scopes: safeScopes,
      })
      .select()
      .single();
    if (error) return fail(res, 500, error.message);

    // Full plaintext key returned ONCE; the masked row for immediate display.
    res.status(201).json({ key: plaintext, api_key: maskRow(data) });
  } catch (e) { fail(res, 500, e.message); }
});

// GET /api/keys/usage — per-day, per-endpoint call counts for the account (Verify API metering).
// Reads api_usage (owner-RLS, migration 041) via the token-scoped client. Default window: 30 days.
// Registered before GET '/:id'-style routes is moot (apiKeys has no GET '/:id'); the '/webhooks'
// mount is matched earlier in app.js, so '/usage' resolves here cleanly.
router.get('/usage', async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data, error } = await req.user.supabase
      .from('api_usage')
      .select('day, endpoint, count')
      .eq('account_id', req.user.id)
      .gte('day', since)
      .order('day', { ascending: false });
    if (error) return fail(res, 500, error.message);
    const rows = data || [];
    const total = rows.reduce((s, r) => s + (r.count || 0), 0);
    res.json({ usage: rows, total, since, days });
  } catch (e) { fail(res, 500, e.message); }
});

// GET /api/keys/verifications — recent /v1 verifications for the account (the console "Logs" view).
// Owner-RLS read of verifications; returns a compact projection (never the full report blob).
router.get('/verifications', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { data, error } = await req.user.supabase
      .from('verifications')
      .select('id, candidate_ref, mode, status, source, created_at, completed_at, report')
      .eq('account_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return fail(res, 500, error.message);
    // Project a compact summary; pull just the score + proof state out of the report blob.
    const verifications = (data || []).map((v) => ({
      id: v.id,
      candidate_ref: v.candidate_ref,
      mode: v.mode,
      status: v.status,
      source: v.source,
      created_at: v.created_at,
      completed_at: v.completed_at,
      proof_state: v.report?.proof_of_human?.state || null,
      score: v.report?.score?.score ?? null,
      outcome: v.report?.score?.outcome || null,
    }));
    res.json({ verifications });
  } catch (e) { fail(res, 500, e.message); }
});

// GET /api/keys — list this account's keys, masked. Never exposes the hash.
router.get('/', async (req, res) => {
  try {
    const { data, error } = await req.user.supabase
      .from('api_keys')
      .select('id, name, mode, scopes, prefix, last4, created_at, last_used_at, revoked_at')
      .eq('account_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) return fail(res, 500, error.message);
    res.json({ api_keys: (data || []).map(maskRow) });
  } catch (e) { fail(res, 500, e.message); }
});

// POST /api/keys/:id/rotate — revoke the old key, mint a fresh one (same name/mode/scopes).
router.post('/:id/rotate', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');

    // RLS-scoped read: only the owner can see their own row.
    const { data: existing, error: readErr } = await req.user.supabase
      .from('api_keys')
      .select('id, name, mode, scopes, revoked_at')
      .eq('id', req.params.id)
      .maybeSingle();
    if (readErr) return fail(res, 500, readErr.message);
    if (!existing) return fail(res, 404, 'key not found');
    if (existing.revoked_at) return fail(res, 409, 'key already revoked');

    // B-19: mint the replacement FIRST; only revoke the old key after the new one is safely issued.
    // A failed insert must never leave the account with the old key already dead and no replacement.
    // The brief two-active-keys window is the standard (Stripe-style) rotation tradeoff.
    const { plaintext, prefix, last4 } = generateKey(existing.mode);
    const hashed_key = hashKey(plaintext);
    const { data, error: insErr } = await req.user.supabase
      .from('api_keys')
      .insert({
        account_id: req.user.id,
        name: existing.name,
        prefix,
        hashed_key,
        last4,
        mode: existing.mode,
        scopes: Array.isArray(existing.scopes) ? existing.scopes : [],
      })
      .select()
      .single();
    if (insErr) return fail(res, 500, insErr.message);

    // Now revoke the old key (the replacement is live).
    const { error: revokeErr } = await req.user.supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (revokeErr) return fail(res, 500, revokeErr.message);

    res.status(201).json({ key: plaintext, api_key: maskRow(data) });
  } catch (e) { fail(res, 500, e.message); }
});

// DELETE /api/keys/:id — revoke (soft delete: set revoked_at).
router.delete('/:id', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { data, error } = await req.user.supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .maybeSingle();
    if (error) return fail(res, 500, error.message);
    if (!data) return fail(res, 404, 'key not found');
    res.json({ api_key: maskRow(data) });
  } catch (e) { fail(res, 500, e.message); }
});

module.exports = router;
