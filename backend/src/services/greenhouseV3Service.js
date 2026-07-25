/**
 * greenhouseV3Service — Greenhouse Harvest v3 note write-back (supersedes the v1 path in atsService
 * for the note push). Greenhouse sunsets Harvest v1/v2 on 2026-08-31; v3 is required.
 *
 * Two-legged, per-tenant:
 *   1. Token exchange (client-credentials): POST GREENHOUSE_AUTH_URL with HTTP Basic
 *      (client_id:client_secret) and form body grant_type=client_credentials(+sub). The response
 *      carries { access_token, expires_at } (ISO8601, NOT expires_in). Tokens are cached in-memory
 *      keyed by a hash of the client_id (never the raw secret) and reused until ~120s before expiry.
 *   2. Create note: POST GREENHOUSE_API_BASE + '/notes' with Bearer <access_token> and a JSON body
 *      { candidate_id, body, visibility, note_type:'NOTE', application_id?, user_id? }. v3 attaches to
 *      candidate_id (REQUIRED) — there is NO On-Behalf-Of header (use user_id in the body, or omit).
 *
 * Contract (matches atsService): best-effort. createNote() NEVER throws — a Greenhouse outage or a
 * missing credential returns { success, skipped?, error? } so the scoring/delivery path is never
 * broken or slowed. SSRF-guarded, explicit User-Agent, timeout, retry/backoff on 429/5xx, and a
 * one-shot token refresh on 401.
 *
 * Everything is behind GREENHOUSE_V3_ENABLED (isEnabled()); OFF by default.
 */
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const cryptoVault = require('./cryptoVault');
const { assertPublicHttpsUrl } = require('./ssrfGuard');
const { scoreNote } = require('./atsService');
const greenhouseOAuthService = require('./greenhouseOAuthService');

const GREENHOUSE_API_BASE = (process.env.GREENHOUSE_API_BASE || 'https://harvest.greenhouse.io/v3').replace(/\/+$/, '');
const GREENHOUSE_AUTH_URL = (process.env.GREENHOUSE_AUTH_URL || 'https://auth.greenhouse.io/token').trim();
const GREENHOUSE_USER_AGENT = 'Touchstones-Integration/1.0';
const OUTBOUND_TIMEOUT_MS = 10000;
const RETRY_BACKOFF_MS = [400, 1500, 4000];
const TOKEN_REFRESH_SKEW_MS = 120000; // refresh ~120s before expires_at

const VISIBILITIES = new Set(['admin_only', 'private', 'public']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Feature flag — OFF by default. */
function isEnabled() {
  return process.env.GREENHOUSE_V3_ENABLED === 'true';
}

// --- in-memory token cache, keyed by a hash of the client_id (never the raw secret) --------------
const tokenCache = new Map(); // clientIdHash -> { access_token, expiresAtMs }

function clientKey(clientId) {
  return crypto.createHash('sha256').update('gh-v3:' + String(clientId || '')).digest('hex');
}

/**
 * Exchange client credentials for a Bearer access token.
 * @returns {Promise<{ access_token: string, expiresAtMs: number }>}  — THROWS on failure (the caller
 *          in createNote catches and degrades to a best-effort error result).
 */
async function exchangeToken(clientId, clientSecret, sub) {
  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '').trim();
  if (!id || !secret) throw new Error('greenhouse: client_id and client_secret are required');

  // Host is customer-independent/trusted; assert anyway so a GREENHOUSE_AUTH_URL override can never
  // point at a private host.
  await assertPublicHttpsUrl(GREENHOUSE_AUTH_URL);

  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const params = new URLSearchParams({ grant_type: 'client_credentials' });
  if (sub) params.set('sub', String(sub));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OUTBOUND_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(GREENHOUSE_AUTH_URL, {
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': GREENHOUSE_USER_AGENT,
      },
      body: params.toString(),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`greenhouse token exchange failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  const data = await resp.json().catch(() => ({}));
  if (!data.access_token) throw new Error('greenhouse token exchange: no access_token in response');

  // expires_at is ISO8601 (NOT expires_in). Fall back to a short TTL if it is missing/unparseable.
  let expiresAtMs = Date.parse(data.expires_at);
  if (!Number.isFinite(expiresAtMs)) expiresAtMs = Date.now() + 5 * 60000;

  const entry = { access_token: data.access_token, expiresAtMs };
  tokenCache.set(clientKey(id), entry);
  return entry;
}

/** Return a cached token if still fresh, else exchange a new one. */
async function getToken(clientId, clientSecret, sub, { force = false } = {}) {
  const key = clientKey(clientId);
  if (!force) {
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAtMs - TOKEN_REFRESH_SKEW_MS > Date.now()) return cached.access_token;
  }
  const fresh = await exchangeToken(clientId, clientSecret, sub);
  return fresh.access_token;
}

// --- per-tenant credential resolution (encrypted at rest) ---------------------------------------
async function loadTenantCreds(accountId) {
  const { data } = await supabaseAdmin
    .from('greenhouse_integration_settings')
    .select('client_id, client_secret_enc, default_user_id, default_visibility')
    .eq('account_id', accountId)
    .maybeSingle();
  if (!data || !data.client_id || !data.client_secret_enc) return null;
  let secret = null;
  try { secret = cryptoVault.decrypt(data.client_secret_enc); } catch { return null; }
  if (!secret) return null;
  return {
    clientId: data.client_id,
    clientSecret: secret,
    defaultUserId: data.default_user_id || null,
    defaultVisibility: data.default_visibility || null,
  };
}

async function setTenantCreds(accountId, { clientId, clientSecret, defaultUserId } = {}) {
  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '').trim();
  if (!id) throw new Error('client_id is required');
  if (!secret) throw new Error('client_secret is required');
  const enc = cryptoVault.encrypt(secret);
  const row = {
    account_id: accountId,
    client_id: id,
    client_secret_enc: enc,
    updated_at: new Date().toISOString(),
  };
  if (defaultUserId !== undefined) row.default_user_id = defaultUserId ? String(defaultUserId) : null;
  const { error } = await supabaseAdmin
    .from('greenhouse_integration_settings')
    .upsert(row, { onConflict: 'account_id' });
  if (error) throw error;
  // Bust any cached token for this credential so a rotated secret takes effect immediately.
  tokenCache.delete(clientKey(id));
  return { configured: true, last4: id.slice(-4) };
}

async function getTenantSettings(accountId) {
  const { data } = await supabaseAdmin
    .from('greenhouse_integration_settings')
    .select('client_id')
    .eq('account_id', accountId)
    .maybeSingle();
  const clientId = data && data.client_id ? String(data.client_id) : null;
  return { configured: !!clientId, last4: clientId ? clientId.slice(-4) : null };
}

// Note defaults only (no credential requirement) - used by the Partner-OAuth path, where the
// tenant may have defaults stored without ever having pasted client credentials.
async function loadTenantDefaults(accountId) {
  const { data } = await supabaseAdmin
    .from('greenhouse_integration_settings')
    .select('default_user_id, default_visibility')
    .eq('account_id', accountId)
    .maybeSingle();
  return {
    defaultUserId: (data && data.default_user_id) || null,
    defaultVisibility: (data && data.default_visibility) || null,
  };
}

async function clearTenantCreds(accountId) {
  await supabaseAdmin.from('greenhouse_integration_settings').delete().eq('account_id', accountId);
  return { configured: false };
}

// --- create note (best-effort, never throws) ----------------------------------------------------
/**
 * @param {Object} opts
 * @param {string} [opts.account_id]    - resolve encrypted creds for this tenant (preferred)
 * @param {string} [opts.clientId]      - explicit creds (used by tests / direct callers)
 * @param {string} [opts.clientSecret]
 * @param {number|string} opts.candidate_id     - REQUIRED (v3 attaches notes to a candidate)
 * @param {number|string} [opts.application_id] - optional; must belong to the same candidate
 * @param {string} [opts.body]          - explicit note text; else built from summary via scoreNote
 * @param {Object} [opts.summary]       - score summary (used when body is absent)
 * @param {string} [opts.visibility]    - 'admin_only'|'private'|'public' (default 'private')
 * @param {number|string} [opts.user_id]        - Greenhouse user to attribute the note to
 * @param {number|string} [opts.sub]             - optional numeric Greenhouse user id for the token sub
 * @returns {Promise<Object>} { success, skipped?, error?, data? } — never rejects
 */
async function createNote(opts = {}) {
  try {
    if (!isEnabled()) return { success: false, skipped: true, reason: 'greenhouse_v3_disabled' };

    // Resolve auth: explicit creds win; otherwise Partner OAuth first (per-tenant rotating tokens,
    // one consent click), then the legacy client-credentials fallback - so tenants configured
    // before the OAuth upgrade keep working with zero action.
    let getTokenForRequest = null; // ({force}) => Promise<string|null>
    let clientId = opts.clientId;
    let clientSecret = opts.clientSecret;
    let defaultUserId = null;
    let defaultVisibility = null;
    if ((!clientId || !clientSecret) && opts.account_id) {
      const oauthToken = await greenhouseOAuthService.getAccessToken(opts.account_id);
      if (oauthToken) {
        getTokenForRequest = ({ force = false } = {}) =>
          greenhouseOAuthService.getAccessToken(opts.account_id, { force });
        const defaults = await loadTenantDefaults(opts.account_id);
        defaultUserId = defaults.defaultUserId;
        defaultVisibility = defaults.defaultVisibility;
      } else {
        const creds = await loadTenantCreds(opts.account_id);
        if (!creds) return { success: false, skipped: true, reason: 'greenhouse_not_configured' };
        clientId = creds.clientId;
        clientSecret = creds.clientSecret;
        defaultUserId = creds.defaultUserId;
        defaultVisibility = creds.defaultVisibility;
      }
    }
    if (!getTokenForRequest) {
      if (!clientId || !clientSecret) return { success: false, skipped: true, reason: 'greenhouse_not_configured' };
      getTokenForRequest = ({ force = false } = {}) => getToken(clientId, clientSecret, opts.sub, { force });
    }

    const candidateId = Number(opts.candidate_id);
    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      return { success: false, error: 'Greenhouse v3 requires a numeric candidate_id' };
    }

    const noteBody = (opts.body != null ? String(opts.body) : scoreNote(opts.summary || {})).trim();
    if (!noteBody) return { success: false, error: 'Greenhouse note body is empty' };

    let visibility = opts.visibility || defaultVisibility || 'private';
    if (!VISIBILITIES.has(visibility)) visibility = 'private';

    const payload = { candidate_id: candidateId, body: noteBody, visibility, note_type: 'NOTE' };
    const applicationId = opts.application_id != null ? Number(opts.application_id) : null;
    if (Number.isInteger(applicationId) && applicationId > 0) payload.application_id = applicationId;
    const userId = opts.user_id != null ? opts.user_id : defaultUserId;
    if (userId != null && String(userId).trim() !== '') {
      // user_id must be an integer Greenhouse user id; a non-numeric value would 422,
      // so omit it (v3 then defaults to the authenticated user) rather than send junk.
      const n = Number(userId);
      if (Number.isInteger(n)) payload.user_id = n;
    }

    return await postNote(getTokenForRequest, payload);
  } catch (e) {
    // Best-effort contract: never throw into the scoring/delivery path.
    return { success: false, error: e.message };
  }
}

/** POST /notes with a Bearer token, retry/backoff on 429/5xx (Retry-After honored), one-shot
 *  refresh on 401. getTokenFn abstracts the credential: client-credentials getToken() or the
 *  Partner-OAuth per-tenant token (which returns null, rather than throwing, when unusable). */
async function postNote(getTokenFn, payload) {
  const url = GREENHOUSE_API_BASE + '/notes';
  // Host is customer-independent/trusted; assert anyway so a GREENHOUSE_API_BASE override can never
  // point at a private host.
  await assertPublicHttpsUrl(url);

  let refreshedOn401 = false;
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    let waitMs = attempt < RETRY_BACKOFF_MS.length ? RETRY_BACKOFF_MS[attempt] : 0;
    let token;
    try {
      token = await getTokenFn({ force: refreshedOn401 });
    } catch (e) {
      lastErr = e.message;
      if (attempt < RETRY_BACKOFF_MS.length) { await sleep(waitMs); continue; }
      break;
    }
    if (!token) {
      lastErr = 'greenhouse token unavailable';
      if (attempt < RETRY_BACKOFF_MS.length) { await sleep(waitMs); continue; }
      break;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OUTBOUND_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': GREENHOUSE_USER_AGENT,
        },
        body: JSON.stringify(payload),
      });
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        return { success: true, status: resp.status, data };
      }
      // 401 → the token may be stale/revoked. Force a single refresh and retry once.
      if (resp.status === 401 && !refreshedOn401) {
        refreshedOn401 = true;
        lastErr = 'greenhouse 401 (refreshing token)';
        continue;
      }
      // Other 4xx (auth/validation) are terminal — do not retry.
      if (resp.status < 500 && resp.status !== 429) {
        const text = await resp.text().catch(() => '');
        return { success: false, status: resp.status, error: text.slice(0, 300) };
      }
      // 429: honor Retry-After (seconds) when present - documented Harvest v3 behavior.
      if (resp.status === 429) {
        const retryAfter = Number(resp.headers && resp.headers.get && resp.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter >= 0) {
          waitMs = Math.min(retryAfter * 1000, 30000);
        }
      }
      lastErr = `greenhouse ${resp.status}`;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e.message;
    }
    if (attempt < RETRY_BACKOFF_MS.length) await sleep(waitMs);
  }
  return { success: false, error: `notes.create failed: ${lastErr}` };
}

/** Test/maintenance helper — clear the in-memory token cache. */
function _clearTokenCache() {
  tokenCache.clear();
}

module.exports = {
  isEnabled,
  exchangeToken,
  createNote,
  loadTenantCreds,
  setTenantCreds,
  getTenantSettings,
  clearTenantCreds,
  GREENHOUSE_API_BASE,
  GREENHOUSE_AUTH_URL,
  _clearTokenCache,
};
