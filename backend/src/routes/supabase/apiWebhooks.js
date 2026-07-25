/**
 * Console webhook-endpoint management for the Verify API (`/api/keys/webhooks`).
 * -----------------------------------------------------------------------------
 * Part of the developer CONSOLE, so it sits behind the EXISTING `supabaseAuth` (a logged-in
 * Supabase session), NOT apiKeyAuth. Every row is scoped to the caller's account
 * (req.user.id == account_id == profiles.id) through the token-scoped client (req.user.supabase),
 * so RLS (migration 042) is the tenant boundary.
 *
 * These are OUTBOUND webhook endpoints — destinations Touchstones calls when a /v1 verification
 * reaches a terminal state (see services/webhookService.js). Distinct from routes/webhooks.js,
 * which RECEIVES inbound webhooks (Calendly/Stripe/Google).
 *
 *   GET    /api/keys/webhooks                 → list this account's endpoints (+ signing_secret, owner-only)
 *   POST   /api/keys/webhooks                 → create { url, description?, enabled_events[] }
 *   PATCH  /api/keys/webhooks/:id             → update { url?, description?, enabled_events?, status? }
 *   POST   /api/keys/webhooks/:id/rotate-secret → issue a fresh signing_secret
 *   POST   /api/keys/webhooks/:id/test        → deliver a one-off webhook.test event
 *   DELETE /api/keys/webhooks/:id             → delete the endpoint (cascades its delivery log)
 *   GET    /api/keys/webhooks/deliveries      → recent delivery log across the account's endpoints
 */
const express = require('express');
const router = express.Router();
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const webhookService = require('../../services/webhookService');
const { assertPublicHttpsUrl, SsrfError } = require('../../services/ssrfGuard');

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// The only events a verification can emit. Reject anything else at registration time so the
// console can't subscribe to a typo that would silently never fire.
const VALID_EVENTS = new Set([
  'verification.completed',
  'verification.needs_review',
  'verification.failed',
]);

function sanitizeEvents(events) {
  if (!Array.isArray(events)) return null;
  const cleaned = [...new Set(events.filter((e) => typeof e === 'string'))];
  for (const e of cleaned) {
    if (!VALID_EVENTS.has(e)) return { error: `unknown event: ${e}` };
  }
  return cleaned;
}

// SSRF-safe URL validation. Resolves the host and rejects private/loopback/link-local/metadata
// destinations (see services/ssrfGuard.js). Returns null on success, or an error message string.
// The AUTHORITATIVE re-check also runs at delivery time in webhookService (DNS-rebinding defense).
async function urlRejectReason(u) {
  if (typeof u !== 'string' || !u.trim()) return 'url is required';
  try { await assertPublicHttpsUrl(u.trim()); return null; }
  catch (e) { return e instanceof SsrfError ? e.message : 'Invalid url'; }
}

// Owner-safe representation. Endpoints ARE allowed to expose signing_secret to their owner
// (it's the shared secret the receiver needs); RLS guarantees only the owner reads this row.
const presentEndpoint = (row) => ({
  id: row.id,
  url: row.url,
  description: row.description || null,
  signing_secret: row.signing_secret,
  enabled_events: Array.isArray(row.enabled_events) ? row.enabled_events : [],
  status: row.status,
  created_at: row.created_at,
  last_delivery_at: row.last_delivery_at || null,
});

router.use(supabaseAuth);

// GET /api/keys/webhooks — list endpoints for the account.
router.get('/', async (req, res) => {
  try {
    const { data, error } = await req.user.supabase
      .from('webhook_endpoints')
      .select('id, url, description, signing_secret, enabled_events, status, created_at, last_delivery_at')
      .eq('account_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) return fail(res, 500, error.message);
    res.json({ webhook_endpoints: (data || []).map(presentEndpoint), valid_events: [...VALID_EVENTS] });
  } catch (e) { fail(res, 500, e.message); }
});

// GET /api/keys/webhooks/deliveries — recent delivery log across the account's endpoints.
// (Registered BEFORE '/:id' routes so 'deliveries' isn't captured as an :id.)
router.get('/deliveries', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { data, error } = await req.user.supabase
      .from('webhook_deliveries')
      .select('id, endpoint_id, verification_id, event_type, status, attempts, response_status, error, created_at, delivered_at, next_attempt_at')
      .eq('account_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return fail(res, 500, error.message);
    res.json({ deliveries: data || [] });
  } catch (e) { fail(res, 500, e.message); }
});

// POST /api/keys/webhooks — create an endpoint.
router.post('/', async (req, res) => {
  try {
    const { url, description, enabled_events } = req.body || {};
    const urlErr = await urlRejectReason(url);
    if (urlErr) return fail(res, 400, urlErr);
    const events = sanitizeEvents(enabled_events);
    if (events && events.error) return fail(res, 400, events.error);
    const safeEvents = (events && events.length) ? events : [...VALID_EVENTS]; // default: all
    const safeDesc = (typeof description === 'string' && description.trim())
      ? description.trim().slice(0, 280) : null;

    const signing_secret = webhookService.generateSigningSecret();
    const { data, error } = await req.user.supabase
      .from('webhook_endpoints')
      .insert({
        account_id: req.user.id,
        url,
        description: safeDesc,
        signing_secret,
        enabled_events: safeEvents,
        status: 'active',
      })
      .select()
      .single();
    if (error) return fail(res, 500, error.message);
    res.status(201).json({ webhook_endpoint: presentEndpoint(data) });
  } catch (e) { fail(res, 500, e.message); }
});

// PATCH /api/keys/webhooks/:id — update url / description / enabled_events / status.
router.patch('/:id', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const patch = {};
    const { url, description, enabled_events, status } = req.body || {};
    if (url !== undefined) {
      const urlErr = await urlRejectReason(url);
      if (urlErr) return fail(res, 400, urlErr);
      patch.url = url;
    }
    if (description !== undefined) {
      patch.description = (typeof description === 'string' && description.trim())
        ? description.trim().slice(0, 280) : null;
    }
    if (enabled_events !== undefined) {
      const events = sanitizeEvents(enabled_events);
      if (events && events.error) return fail(res, 400, events.error);
      patch.enabled_events = events || [];
    }
    if (status !== undefined) {
      if (status !== 'active' && status !== 'disabled') return fail(res, 400, "status must be 'active' or 'disabled'");
      patch.status = status;
      patch.disabled_at = status === 'disabled' ? new Date().toISOString() : null;
    }
    if (!Object.keys(patch).length) return fail(res, 400, 'no updatable fields provided');

    const { data, error } = await req.user.supabase
      .from('webhook_endpoints')
      .update(patch)
      .eq('id', req.params.id)
      .eq('account_id', req.user.id)
      .select()
      .maybeSingle();
    if (error) return fail(res, 500, error.message);
    if (!data) return fail(res, 404, 'endpoint not found');
    res.json({ webhook_endpoint: presentEndpoint(data) });
  } catch (e) { fail(res, 500, e.message); }
});

// POST /api/keys/webhooks/:id/rotate-secret — issue a fresh signing secret.
router.post('/:id/rotate-secret', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const signing_secret = webhookService.generateSigningSecret();
    const { data, error } = await req.user.supabase
      .from('webhook_endpoints')
      .update({ signing_secret })
      .eq('id', req.params.id)
      .eq('account_id', req.user.id)
      .select()
      .maybeSingle();
    if (error) return fail(res, 500, error.message);
    if (!data) return fail(res, 404, 'endpoint not found');
    res.json({ webhook_endpoint: presentEndpoint(data) });
  } catch (e) { fail(res, 500, e.message); }
});

// POST /api/keys/webhooks/:id/test — deliver a one-off webhook.test event.
router.post('/:id/test', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { data: endpoint, error } = await req.user.supabase
      .from('webhook_endpoints')
      .select('id, url, signing_secret, status')
      .eq('id', req.params.id)
      .eq('account_id', req.user.id)
      .maybeSingle();
    if (error) return fail(res, 500, error.message);
    if (!endpoint) return fail(res, 404, 'endpoint not found');
    const result = await webhookService.sendTest(req.user.id, endpoint);
    res.json({ test: result });
  } catch (e) { fail(res, 500, e.message); }
});

// DELETE /api/keys/webhooks/:id — remove the endpoint (its delivery log cascades).
router.delete('/:id', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { data, error } = await req.user.supabase
      .from('webhook_endpoints')
      .delete()
      .eq('id', req.params.id)
      .eq('account_id', req.user.id)
      .select()
      .maybeSingle();
    if (error) return fail(res, 500, error.message);
    if (!data) return fail(res, 404, 'endpoint not found');
    res.json({ deleted: true, id: req.params.id });
  } catch (e) { fail(res, 500, e.message); }
});

module.exports = router;
