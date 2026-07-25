/**
 * Unit tests for greenhouseOAuthService - Harvest v3 Partner OAuth (authorization-code grant,
 * rotating refresh tokens). Env-independent, fetch mocked, real cryptoVault (deterministic key).
 *
 * Asserted here:
 *   1. Authorize URL: response_type/client_id/redirect_uri/scope + HMAC-signed state that
 *      verifies back to the account and rejects tampering/expiry.
 *   2. Callback code exchange: Basic(client_id:client_secret) + urlencoded grant_type=
 *      authorization_code, tokens persisted ENCRYPTED (never plaintext), status connected.
 *   3. Rotation: refresh persists the NEW pair before returning; force bypasses a fresh token.
 *   4. Single-flight: concurrent refreshes share ONE token request (rotating refresh tokens are
 *      one-use; a parallel second refresh would invalidate the winner's pair).
 *   5. invalid_grant flips the row to needs_reauth and resolves null (best-effort contract).
 *   6. Retry-After is honored on 429 from the token endpoint.
 *   7. Keep-alive: no-op when the flag is off; serialized refresh of stale connections when on.
 */

process.env.GREENHOUSE_OAUTH_CLIENT_ID = 'partner-client-id';
process.env.GREENHOUSE_OAUTH_CLIENT_SECRET = 'partner-client-secret';
process.env.GREENHOUSE_AUTH_URL = 'https://auth.greenhouse.io/token';
process.env.GREENHOUSE_OAUTH_AUTHORIZE_URL = 'https://auth.greenhouse.io/authorize';
process.env.BACKEND_PUBLIC_URL = 'https://api.dev.test';
process.env.JWT_SECRET = 'unit-test-state-secret-32-bytes-minimum!!';
process.env.ASHBY_ENC_KEY = 'a'.repeat(64); // 32-byte hex → deterministic cryptoVault key

const ACCOUNT = '00000000-0000-0000-0000-0000000000aa';

// ---- chainable supabase fake over an in-memory greenhouse_oauth_connections store ----
let mockRows;
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from(table) {
      if (table !== 'greenhouse_oauth_connections') throw new Error('unexpected table ' + table);
      const ctx = { filters: [], orExpr: null, ups: null, upd: null, del: false };
      const match = (row) => ctx.filters.every(([c, v]) => row[c] === v);
      const matchOr = (row) => {
        if (!match(row)) return false;
        if (!ctx.orExpr) return true;
        return ctx.orExpr.split(',').some((clause) => {
          const firstDot = clause.indexOf('.');
          const secondDot = clause.indexOf('.', firstDot + 1);
          const col = clause.slice(0, firstDot);
          const op = clause.slice(firstDot + 1, secondDot);
          const val = clause.slice(secondDot + 1);
          if (op === 'is' && val === 'null') return row[col] == null;
          if (op === 'lt') return row[col] != null && String(row[col]) < val;
          return false;
        });
      };
      const resolve = () => {
        if (ctx.ups) {
          const existing = mockRows.find((r) => r.account_id === ctx.ups.account_id);
          if (existing) Object.assign(existing, ctx.ups); else mockRows.push({ ...ctx.ups });
          return { data: null, error: null };
        }
        if (ctx.upd) { mockRows.filter(match).forEach((r) => Object.assign(r, ctx.upd)); return { data: null, error: null }; }
        if (ctx.del) { for (let i = mockRows.length - 1; i >= 0; i--) if (match(mockRows[i])) mockRows.splice(i, 1); return { data: null, error: null }; }
        return { data: mockRows.filter(matchOr), error: null };
      };
      const q = {
        select() { return q; },
        eq(c, v) { ctx.filters.push([c, v]); return q; },
        or(e) { ctx.orExpr = e; return q; },
        limit() { return q; },
        upsert(o) { ctx.ups = o; return q; },
        update(o) { ctx.upd = o; return q; },
        delete() { ctx.del = true; return q; },
        maybeSingle: async () => ({ data: resolve().data[0] || null, error: null }),
        then(onF, onR) { return Promise.resolve(resolve()).then(onF, onR); },
      };
      return q;
    },
  },
}));
jest.mock('../../src/services/ssrfGuard', () => ({
  assertPublicHttpsUrl: jest.fn(async (u) => new URL(u)),
  SsrfError: class SsrfError extends Error {},
}));

const oauth = require('../../src/services/greenhouseOAuthService');
const cryptoVault = require('../../src/services/cryptoVault');

const futureIso = (mins = 60) => new Date(Date.now() + mins * 60000).toISOString();
const pastIso = (mins = 60) => new Date(Date.now() - mins * 60000).toISOString();
const okToken = (n = '1') => ({
  ok: true, status: 200,
  json: async () => ({ token_type: 'Bearer', access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_at: futureIso() }),
  text: async () => '',
});

const realFetch = global.fetch;
beforeEach(() => {
  mockRows = [];
  oauth._clearCaches();
  process.env.GREENHOUSE_ASSESSMENTS_ENABLED = 'true';
});
afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

function seedConnection({ access = 'old-access', refresh = 'old-refresh', expiresAt = pastIso(), status = 'connected', lastRefreshed = pastIso(120) } = {}) {
  mockRows.push({
    account_id: ACCOUNT,
    access_token_enc: cryptoVault.encrypt(access),
    refresh_token_enc: cryptoVault.encrypt(refresh),
    access_expires_at: expiresAt,
    status,
    last_refreshed_at: lastRefreshed,
  });
}

describe('authorize URL + signed state', () => {
  test('buildAuthorizeUrl carries the partner-OAuth params and a verifiable state', () => {
    const url = new URL(oauth.buildAuthorizeUrl(ACCOUNT));
    expect(url.origin + url.pathname).toBe('https://auth.greenhouse.io/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('partner-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.dev.test/api/integrations/greenhouse/oauth/callback');
    expect(url.searchParams.get('scope')).toContain('harvest:notes:create');
    expect(oauth.verifyState(url.searchParams.get('state'))).toBe(ACCOUNT);
  });

  test('verifyState rejects tampered, malformed, and expired states', () => {
    const state = oauth.signState(ACCOUNT);
    const [payload] = state.split('.');
    expect(oauth.verifyState(`${payload}.AAAA-forged-mac`)).toBeNull();
    expect(oauth.verifyState('garbage')).toBeNull();
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 11 * 60000); // past the 10 min TTL
    expect(oauth.verifyState(state)).toBeNull();
  });
});

describe('callback code exchange', () => {
  test('exchanges the code with Basic(client:secret) + urlencoded body and persists ENCRYPTED tokens', async () => {
    global.fetch = jest.fn(async () => okToken('cb'));
    const state = oauth.signState(ACCOUNT);
    const r = await oauth.handleCallback('the-code', state);
    expect(r).toEqual({ accountId: ACCOUNT });

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://auth.greenhouse.io/token');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Basic ' + Buffer.from('partner-client-id:partner-client-secret').toString('base64'));
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(opts.body).toContain('grant_type=authorization_code');
    expect(opts.body).toContain('code=the-code');
    expect(opts.body).toContain(encodeURIComponent('https://api.dev.test/api/integrations/greenhouse/oauth/callback'));

    const row = mockRows[0];
    expect(row.status).toBe('connected');
    expect(row.access_token_enc).toMatch(/^v1:/);
    expect(row.refresh_token_enc).toMatch(/^v1:/);
    expect(row.access_token_enc).not.toContain('access-cb');
    expect(cryptoVault.decrypt(row.access_token_enc)).toBe('access-cb');
    expect(cryptoVault.decrypt(row.refresh_token_enc)).toBe('refresh-cb');
  });

  test('rejects a bad state without ever calling the token endpoint', async () => {
    global.fetch = jest.fn(async () => okToken());
    await expect(oauth.handleCallback('code', 'forged-state')).rejects.toThrow(/state/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('getAccessToken: stored token, rotation, force', () => {
  test('uses a still-fresh stored access token without refreshing', async () => {
    seedConnection({ access: 'fresh-access', expiresAt: futureIso() });
    global.fetch = jest.fn(async () => { throw new Error('no refresh expected'); });
    expect(await oauth.getAccessToken(ACCOUNT)).toBe('fresh-access');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('refreshes when stale and persists the ROTATED pair before returning', async () => {
    seedConnection();
    global.fetch = jest.fn(async (url, opts) => {
      expect(opts.body).toContain('grant_type=refresh_token');
      expect(opts.body).toContain('refresh_token=old-refresh');
      return okToken('2');
    });
    const token = await oauth.getAccessToken(ACCOUNT);
    expect(token).toBe('access-2');
    // BOTH tokens rotated and persisted - losing the new refresh token would kill the connection.
    expect(cryptoVault.decrypt(mockRows[0].refresh_token_enc)).toBe('refresh-2');
    expect(cryptoVault.decrypt(mockRows[0].access_token_enc)).toBe('access-2');
    expect(mockRows[0].last_refreshed_at).toBeTruthy();
  });

  test('force:true bypasses a fresh stored token and refreshes (the 401-recovery path)', async () => {
    seedConnection({ access: 'fresh-access', expiresAt: futureIso() });
    global.fetch = jest.fn(async () => okToken('forced'));
    expect(await oauth.getAccessToken(ACCOUNT, { force: true })).toBe('access-forced');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('SINGLE-FLIGHT: concurrent callers share one refresh (rotating tokens are one-use)', async () => {
    seedConnection();
    let tokenCalls = 0;
    global.fetch = jest.fn(async () => { tokenCalls += 1; return okToken('sf'); });
    const [a, b] = await Promise.all([oauth.getAccessToken(ACCOUNT), oauth.getAccessToken(ACCOUNT)]);
    expect(a).toBe('access-sf');
    expect(b).toBe('access-sf');
    expect(tokenCalls).toBe(1);
  });

  test('invalid_grant (400) marks the connection needs_reauth and resolves null (never throws)', async () => {
    seedConnection();
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => 'invalid_grant' }));
    expect(await oauth.getAccessToken(ACCOUNT)).toBeNull();
    expect(mockRows[0].status).toBe('needs_reauth');
    // and subsequent calls short-circuit without touching the token endpoint again
    global.fetch = jest.fn(async () => { throw new Error('should not be called'); });
    expect(await oauth.getAccessToken(ACCOUNT)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('no connection row → null without any network call', async () => {
    global.fetch = jest.fn(async () => { throw new Error('should not be called'); });
    expect(await oauth.getAccessToken(ACCOUNT)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('honors Retry-After on a 429 from the token endpoint', async () => {
    seedConnection();
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 429, headers: { get: (h) => (h === 'retry-after' ? '0' : null) }, json: async () => ({}), text: async () => '' };
      }
      return okToken('429ok');
    });
    expect(await oauth.getAccessToken(ACCOUNT)).toBe('access-429ok');
    expect(calls).toBe(2);
  });
});

describe('keep-alive refresher', () => {
  test('no-ops entirely when GREENHOUSE_ASSESSMENTS_ENABLED is off', async () => {
    process.env.GREENHOUSE_ASSESSMENTS_ENABLED = 'false';
    seedConnection();
    global.fetch = jest.fn(async () => { throw new Error('should not be called'); });
    expect(await oauth.runKeepAlive()).toEqual({ skipped: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('refreshes stale connected rows (and reports counts)', async () => {
    seedConnection({ lastRefreshed: pastIso(13 * 60) }); // 13h old
    global.fetch = jest.fn(async () => okToken('ka'));
    const r = await oauth.runKeepAlive();
    expect(r).toEqual({ refreshed: 1, seen: 1 });
    expect(cryptoVault.decrypt(mockRows[0].refresh_token_enc)).toBe('refresh-ka');
  }, 15000);

  test('skips rows refreshed within the last hour', async () => {
    seedConnection({ lastRefreshed: new Date(Date.now() - 5 * 60000).toISOString() }); // 5 min ago
    global.fetch = jest.fn(async () => { throw new Error('should not be called'); });
    const r = await oauth.runKeepAlive();
    expect(r).toEqual({ refreshed: 0, seen: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('settings surface', () => {
  test('getConnection reflects the stored row; disconnect removes it', async () => {
    expect(await oauth.getConnection(ACCOUNT)).toEqual({ connected: false });
    seedConnection({ status: 'connected' });
    mockRows[0].scopes = 'harvest:notes:create';
    const c = await oauth.getConnection(ACCOUNT);
    expect(c.connected).toBe(true);
    expect(c.scopes).toBe('harvest:notes:create');
    await oauth.disconnect(ACCOUNT);
    expect(mockRows).toHaveLength(0);
    expect(await oauth.getConnection(ACCOUNT)).toEqual({ connected: false });
  });
});
