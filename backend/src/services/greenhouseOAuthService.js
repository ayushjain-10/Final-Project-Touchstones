/**
 * greenhouseOAuthService - Greenhouse Harvest v3 Partner OAuth (authorization-code grant).
 * https://harvestdocs.greenhouse.io/docs/harvest-partner-oauth
 *
 * ONE partner client (ours, provisioned by Greenhouse Partner Support, in backend env) and
 * PER-TENANT tokens obtained via the customer's consent redirect:
 *   • authorize: https://auth.greenhouse.io/authorize?response_type=code&client_id=...&redirect_uri=
 *     ...&scope=...&state=<HMAC-signed, 10 min>    (customer clicks "Connect with Greenhouse")
 *   • callback: exchange the code SYNCHRONOUSLY (codes live 1 minute) at the token endpoint with
 *     Basic(client_id:client_secret); response carries { access_token, refresh_token, expires_at }
 *     (expires_at ISO8601, NOT expires_in - same quirk as the client-credentials flow).
 *   • lifetimes: access ~1h, refresh ~24h. Refresh ROTATES BOTH tokens; the new pair is persisted
 *     BEFORE the token is handed to the caller, and refreshes are SINGLE-FLIGHT per tenant (two
 *     concurrent refreshes would burn the one-use rotating refresh token).
 *   • keep-alive: refresh tokens die within ~24h of inactivity, so a serialized background job
 *     re-refreshes every connected tenant on an interval (env-tunable, default 12h). All tenants
 *     share our one partner client and the token endpoint has its own 60s rate window, so the job
 *     spaces refreshes ~1s apart and honors Retry-After on 429. It only runs when
 *     GREENHOUSE_ASSESSMENTS_ENABLED is on AND connections exist.
 *
 * Tokens are stored cryptoVault-encrypted in greenhouse_oauth_connections (RLS deny-all,
 * migration 114). getAccessToken() NEVER throws - a dead connection returns null and flips the
 * row to needs_reauth so callers (greenhouseV3Service note write-back) degrade best-effort.
 */
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const cryptoVault = require('./cryptoVault');
const { assertPublicHttpsUrl } = require('./ssrfGuard');

const AUTHORIZE_URL = (process.env.GREENHOUSE_OAUTH_AUTHORIZE_URL || 'https://auth.greenhouse.io/authorize').trim();
const TOKEN_URL = (process.env.GREENHOUSE_AUTH_URL || 'https://auth.greenhouse.io/token').trim();
const DEFAULT_SCOPES = (process.env.GREENHOUSE_OAUTH_SCOPES
  || 'harvest:notes:create harvest:candidates:list harvest:applications:list').trim();
const GREENHOUSE_USER_AGENT = 'Touchstones-Integration/1.0';
const OUTBOUND_TIMEOUT_MS = 10000;
const RETRY_BACKOFF_MS = [400, 1500, 4000];
const RETRY_AFTER_CAP_MS = 30000;
const TOKEN_REFRESH_SKEW_MS = 120000; // treat the access token as stale ~120s before expires_at
const STATE_TTL_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clientId() { return (process.env.GREENHOUSE_OAUTH_CLIENT_ID || '').trim(); }
function clientSecret() { return (process.env.GREENHOUSE_OAUTH_CLIENT_SECRET || '').trim(); }
function isConfigured() { return !!(clientId() && clientSecret()); }
function flagEnabled() { return process.env.GREENHOUSE_ASSESSMENTS_ENABLED === 'true'; }

function redirectUri() {
  const base = (process.env.BACKEND_PUBLIC_URL || process.env.API_PUBLIC_URL || '').replace(/\/+$/, '');
  return base ? `${base}/api/integrations/greenhouse/oauth/callback` : null;
}

// --- signed state (CSRF): base64url payload + HMAC, 10 minute expiry --------------------------
function stateSecret() {
  const seed = process.env.GREENHOUSE_OAUTH_STATE_SECRET
    || process.env.JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!seed) throw new Error('greenhouse oauth: no state-signing secret available');
  return crypto.createHash('sha256').update('touchstones:gh-oauth-state:v1:' + seed).digest();
}
const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function signState(accountId) {
  const payload = b64url(JSON.stringify({
    a: accountId, n: crypto.randomBytes(8).toString('hex'), e: Date.now() + STATE_TTL_MS,
  }));
  const mac = b64url(crypto.createHmac('sha256', stateSecret()).update(payload).digest());
  return `${payload}.${mac}`;
}

/** Verify a state token → accountId, or null (tampered / expired / malformed). */
function verifyState(state) {
  try {
    const [payload, mac] = String(state || '').split('.');
    if (!payload || !mac) return null;
    const expected = b64url(crypto.createHmac('sha256', stateSecret()).update(payload).digest());
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!data.a || !data.e || Date.now() > Number(data.e)) return null;
    return data.a;
  } catch {
    return null;
  }
}

/** Build the customer-facing authorize URL. Throws when the partner client is unconfigured. */
function buildAuthorizeUrl(accountId, { scopes } = {}) {
  if (!isConfigured()) throw new Error('greenhouse oauth: partner client not configured');
  const redirect = redirectUri();
  if (!redirect) throw new Error('greenhouse oauth: BACKEND_PUBLIC_URL is not set');
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId());
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('scope', scopes || DEFAULT_SCOPES);
  url.searchParams.set('state', signState(accountId));
  return url.toString();
}

// --- token endpoint (shared by code exchange + refresh) ----------------------------------------
/**
 * POST the token endpoint with Basic(client_id:client_secret) and a form body. Retries on
 * 429 (honoring Retry-After) and 5xx; 400/401 are terminal and returned as
 * { ok: false, status } so callers can distinguish invalid_grant. Throws only on exhaustion.
 */
async function postTokenForm(params) {
  await assertPublicHttpsUrl(TOKEN_URL);
  const auth = Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64');
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OUTBOUND_TIMEOUT_MS);
    let waitMs = attempt < RETRY_BACKOFF_MS.length ? RETRY_BACKOFF_MS[attempt] : 0;
    try {
      const resp = await fetch(TOKEN_URL, {
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': GREENHOUSE_USER_AGENT,
        },
        body: new URLSearchParams(params).toString(),
      });
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        if (!data.access_token) throw new Error('greenhouse oauth: no access_token in response');
        return { ok: true, data };
      }
      if (resp.status < 500 && resp.status !== 429) {
        // 400 expired/invalid code or rotated-away refresh token, 401 bad client credential.
        const text = await resp.text().catch(() => '');
        return { ok: false, status: resp.status, error: text.slice(0, 200) };
      }
      if (resp.status === 429) {
        const retryAfter = Number(resp.headers && resp.headers.get && resp.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter >= 0) {
          waitMs = Math.min(retryAfter * 1000, RETRY_AFTER_CAP_MS);
        }
      }
      lastErr = `greenhouse token ${resp.status}`;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e.message;
    }
    if (attempt < RETRY_BACKOFF_MS.length) await sleep(waitMs);
  }
  throw new Error(`greenhouse token request failed: ${lastErr}`);
}

// --- connection persistence ---------------------------------------------------------------------
const tokenCache = new Map(); // accountId -> { token, expiresAtMs }

function parseExpiresAt(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Date.now() + 5 * 60000; // short TTL fallback like the v3 service
}

/** Encrypt + upsert the (rotated) token pair. Persisting BEFORE returning is the rotation contract. */
async function persistTokens(accountId, data, { scopes } = {}) {
  const expiresAtMs = parseExpiresAt(data.expires_at);
  const row = {
    account_id: accountId,
    access_token_enc: cryptoVault.encrypt(data.access_token),
    refresh_token_enc: cryptoVault.encrypt(data.refresh_token || ''),
    access_expires_at: new Date(expiresAtMs).toISOString(),
    status: 'connected',
    last_refreshed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (scopes !== undefined) row.scopes = scopes;
  const { error } = await supabaseAdmin
    .from('greenhouse_oauth_connections').upsert(row, { onConflict: 'account_id' });
  if (error) throw new Error(`could not persist greenhouse oauth tokens: ${error.message}`);
  tokenCache.set(accountId, { token: data.access_token, expiresAtMs });
  return { expiresAtMs };
}

/**
 * OAuth callback: verify state, exchange the code SYNCHRONOUSLY (1 minute lifetime), persist.
 * Returns { accountId } on success; throws on any failure (the route redirects with ?greenhouse=error).
 */
async function handleCallback(code, state) {
  const accountId = verifyState(state);
  if (!accountId) throw new Error('invalid or expired state');
  if (!code) throw new Error('missing code');
  const r = await postTokenForm({
    grant_type: 'authorization_code',
    code: String(code),
    redirect_uri: redirectUri(),
  });
  if (!r.ok) throw new Error(`code exchange failed (${r.status})`);
  await persistTokens(accountId, r.data, { scopes: r.data.scope || DEFAULT_SCOPES });
  return { accountId };
}

// --- access-token resolution (cache -> stored -> single-flight refresh) --------------------------
const refreshInFlight = new Map(); // accountId -> Promise<string|null>

async function loadConnection(accountId) {
  const { data } = await supabaseAdmin.from('greenhouse_oauth_connections').select('*')
    .eq('account_id', accountId).maybeSingle();
  return data || null;
}

async function markNeedsReauth(accountId) {
  tokenCache.delete(accountId);
  await supabaseAdmin.from('greenhouse_oauth_connections')
    .update({ status: 'needs_reauth', updated_at: new Date().toISOString() })
    .eq('account_id', accountId).then(() => {}, () => {});
}

/** The actual refresh (callers go through the single-flight wrapper). Returns token or null. */
async function doRefresh(accountId, connection) {
  let refreshToken = null;
  try { refreshToken = cryptoVault.decrypt(connection.refresh_token_enc); } catch { refreshToken = null; }
  if (!refreshToken) {
    await markNeedsReauth(accountId);
    return null;
  }
  let r;
  try {
    r = await postTokenForm({ grant_type: 'refresh_token', refresh_token: refreshToken });
  } catch (e) {
    // Transient exhaustion: keep the connection (the keep-alive or next call retries).
    console.warn('greenhouse oauth refresh failed (transient):', e.message);
    return null;
  }
  if (!r.ok) {
    // 400/401: the rotating refresh token is dead - the customer must reconnect.
    await markNeedsReauth(accountId);
    return null;
  }
  await persistTokens(accountId, r.data);
  return r.data.access_token;
}

/**
 * Resolve a live access token for the tenant, refreshing (single-flight) when stale.
 * NEVER throws: returns null when no usable connection exists, so callers degrade best-effort.
 * { force: true } skips the caches and refreshes (used after a 401 from the API).
 */
async function getAccessToken(accountId, { force = false } = {}) {
  try {
    if (!accountId || !isConfigured()) return null;
    if (!force) {
      const cached = tokenCache.get(accountId);
      if (cached && cached.expiresAtMs - TOKEN_REFRESH_SKEW_MS > Date.now()) return cached.token;
    }
    const connection = await loadConnection(accountId);
    if (!connection) return null;
    if (connection.status === 'needs_reauth') return null;

    if (!force && connection.access_expires_at
        && Date.parse(connection.access_expires_at) - TOKEN_REFRESH_SKEW_MS > Date.now()) {
      let token = null;
      try { token = cryptoVault.decrypt(connection.access_token_enc); } catch { token = null; }
      if (token) {
        tokenCache.set(accountId, { token, expiresAtMs: Date.parse(connection.access_expires_at) });
        return token;
      }
    }

    // Single-flight per tenant: a concurrent second caller must NOT consume the one-use rotating
    // refresh token in parallel (the loser would invalidate the winner's freshly-minted pair).
    if (refreshInFlight.has(accountId)) return refreshInFlight.get(accountId);
    const p = doRefresh(accountId, connection).finally(() => refreshInFlight.delete(accountId));
    refreshInFlight.set(accountId, p);
    return await p;
  } catch (e) {
    console.warn('greenhouse oauth getAccessToken failed:', e.message);
    return null;
  }
}

// --- settings surface ----------------------------------------------------------------------------
async function getConnection(accountId) {
  const connection = await loadConnection(accountId);
  if (!connection) return { connected: false };
  return {
    connected: connection.status === 'connected',
    status: connection.status,
    scopes: connection.scopes || null,
    last_refreshed_at: connection.last_refreshed_at || null,
  };
}

async function disconnect(accountId) {
  tokenCache.delete(accountId);
  await supabaseAdmin.from('greenhouse_oauth_connections').delete().eq('account_id', accountId);
  // True revocation happens in the customer's Greenhouse (Configure > Dev Center > Connected
  // Integrations); the settings UI says so.
  return { connected: false };
}

// --- keep-alive refresher (the 24h rotating-refresh-token problem) -------------------------------
const KEEPALIVE_INTERVAL_MS = Number(process.env.GREENHOUSE_OAUTH_KEEPALIVE_INTERVAL_MS || 12 * 3600000);
const KEEPALIVE_MIN_AGE_MS = 60 * 60000;   // skip rows refreshed within the last hour
const KEEPALIVE_SPACING_MS = 1000;         // serialize: one shared partner client, 60s token window

async function runKeepAlive() {
  try {
    if (!flagEnabled() || !isConfigured()) return { skipped: true };
    const cutoff = new Date(Date.now() - KEEPALIVE_MIN_AGE_MS).toISOString();
    const { data: rows } = await supabaseAdmin.from('greenhouse_oauth_connections')
      .select('account_id, last_refreshed_at')
      .eq('status', 'connected')
      .or(`last_refreshed_at.is.null,last_refreshed_at.lt.${cutoff}`)
      .limit(500);
    let refreshed = 0;
    for (const row of rows || []) {
      const token = await getAccessToken(row.account_id, { force: true });
      if (token) refreshed += 1;
      await sleep(KEEPALIVE_SPACING_MS);
    }
    return { refreshed, seen: (rows || []).length };
  } catch (e) {
    console.warn('greenhouse oauth keep-alive failed (non-blocking):', e.message);
    return { error: e.message };
  }
}

let keepAliveTimer = null;
function startKeepAlive({ intervalMs = KEEPALIVE_INTERVAL_MS } = {}) {
  if (keepAliveTimer) return;
  if (!flagEnabled()) return; // flag OFF: no job at all (runKeepAlive re-checks per tick anyway)
  setTimeout(() => runKeepAlive().catch(() => {}), 60000); // shortly after boot
  keepAliveTimer = setInterval(() => runKeepAlive().catch(() => {}), intervalMs);
  if (keepAliveTimer.unref) keepAliveTimer.unref();
}
function stopKeepAlive() {
  if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
}

/** Test/maintenance helper - clear in-memory caches. */
function _clearCaches() {
  tokenCache.clear();
  refreshInFlight.clear();
}

module.exports = {
  isConfigured,
  buildAuthorizeUrl,
  signState,
  verifyState,
  handleCallback,
  getAccessToken,
  getConnection,
  disconnect,
  runKeepAlive,
  startKeepAlive,
  stopKeepAlive,
  redirectUri,
  _clearCaches,
};
