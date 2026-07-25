/**
 * Unit tests for greenhouseV3Service — Greenhouse Harvest v3 note write-back. Env-independent → CI-safe.
 *
 * fetch is mocked so no real network call is made, and the outbound host is pinned to a public IP
 * literal (below) so the SSRF guard never needs DNS. Asserted here:
 *   1. Token exchange: HTTP Basic(client_id:client_secret) + urlencoded grant_type=client_credentials,
 *      expires_at parsed and cached, token reused, and re-exchanged on a 401.
 *   2. createNote payload shape: candidate_id (int) / body / visibility / note_type:'NOTE', Bearer + UA.
 *   3. Graceful no-op when disabled or unconfigured, and the never-throws contract.
 *   4. The client_secret is stored ENCRYPTED (cryptoVault token), never plaintext.
 */

// Pin env BEFORE requiring the service (it captures base URLs at import). Public IP literal → the
// SSRF guard passes without a DNS lookup, keeping the test deterministic offline.
process.env.GREENHOUSE_V3_ENABLED = 'true';
process.env.GREENHOUSE_API_BASE = 'https://93.184.216.34/v3';
process.env.GREENHOUSE_AUTH_URL = 'https://93.184.216.34/token';
process.env.ASHBY_ENC_KEY = process.env.ASHBY_ENC_KEY || 'a'.repeat(64); // 32-byte hex for cryptoVault

// Capture what setTenantCreds upserts without a real DB.
const mockState = { upserted: null };
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      upsert: (row) => { mockState.upserted = row; return Promise.resolve({ error: null }); },
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

const greenhouse = require('../../src/services/greenhouseV3Service');
const cryptoVault = require('../../src/services/cryptoVault');

const CLIENT_ID = 'gh-client-1234';
const CLIENT_SECRET = 'super-secret-value';
const futureIso = () => new Date(Date.now() + 3600 * 1000).toISOString();

// Route the mocked fetch by URL: /token → token handler, /notes → notes handler.
function routeFetch(handlers) {
  return jest.fn((url, opts) => {
    if (String(url).includes('/token')) return handlers.token(url, opts);
    if (String(url).endsWith('/notes')) return handlers.notes(url, opts);
    return Promise.reject(new Error('unexpected url ' + url));
  });
}
const okJson = (status, body) => Promise.resolve({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body)),
});

const realFetch = global.fetch;
beforeEach(() => { greenhouse._clearTokenCache(); mockState.upserted = null; });
afterEach(() => { global.fetch = realFetch; });

describe('exchangeToken', () => {
  test('sends Basic(client_id:client_secret) + urlencoded grant_type and parses expires_at', async () => {
    const exp = futureIso();
    global.fetch = routeFetch({
      token: () => okJson(200, { token_type: 'Bearer', access_token: 'jwt-abc', expires_at: exp }),
      notes: () => Promise.reject(new Error('notes should not be called')),
    });

    const entry = await greenhouse.exchangeToken(CLIENT_ID, CLIENT_SECRET);
    expect(entry.access_token).toBe('jwt-abc');
    expect(entry.expiresAtMs).toBe(Date.parse(exp));

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/token');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const expectedBasic = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    expect(opts.headers.Authorization).toBe(expectedBasic);
    expect(opts.headers['User-Agent']).toBe('Touchstones-Integration/1.0');
    expect(opts.body).toContain('grant_type=client_credentials');
  });

  test('includes sub in the form body when provided', async () => {
    global.fetch = routeFetch({
      token: () => okJson(200, { access_token: 'jwt', expires_at: futureIso() }),
      notes: () => Promise.reject(new Error('n/a')),
    });
    await greenhouse.exchangeToken(CLIENT_ID, CLIENT_SECRET, 4242);
    expect(global.fetch.mock.calls[0][1].body).toContain('sub=4242');
  });
});

describe('token caching + createNote payload', () => {
  test('createNote builds the v3 payload and reuses a cached token for a second call', async () => {
    let tokenCalls = 0;
    const noteCalls = [];
    global.fetch = routeFetch({
      token: () => { tokenCalls += 1; return okJson(200, { access_token: 'jwt-xyz', expires_at: futureIso() }); },
      notes: (url, opts) => { noteCalls.push(opts); return okJson(201, { id: 99 }); },
    });

    const r1 = await greenhouse.createNote({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
      candidate_id: '12345', application_id: 678, user_id: 42, visibility: 'admin_only',
      summary: { score: 87, outcome: 'advance' },
    });
    expect(r1.success).toBe(true);
    expect(r1.status).toBe(201);

    const sent = JSON.parse(noteCalls[0].body);
    expect(sent.candidate_id).toBe(12345);          // coerced to integer
    expect(sent.application_id).toBe(678);
    expect(sent.user_id).toBe(42);
    expect(sent.note_type).toBe('NOTE');
    expect(sent.visibility).toBe('admin_only');
    expect(typeof sent.body).toBe('string');
    expect(sent.body).toContain('87/100');
    expect(noteCalls[0].headers.Authorization).toBe('Bearer jwt-xyz');
    expect(noteCalls[0].headers['User-Agent']).toBe('Touchstones-Integration/1.0');

    // Second call reuses the cached token — only one token exchange total.
    const r2 = await greenhouse.createNote({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, candidate_id: 12345, summary: { score: 50 },
    });
    expect(r2.success).toBe(true);
    expect(tokenCalls).toBe(1);
  });

  test('defaults visibility to private when omitted/invalid', async () => {
    const noteCalls = [];
    global.fetch = routeFetch({
      token: () => okJson(200, { access_token: 'jwt', expires_at: futureIso() }),
      notes: (url, opts) => { noteCalls.push(opts); return okJson(201, { id: 1 }); },
    });
    await greenhouse.createNote({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, candidate_id: 7, visibility: 'bogus', summary: { score: 1 },
    });
    expect(JSON.parse(noteCalls[0].body).visibility).toBe('private');
  });

  test('refreshes the token once on a 401 and retries the note', async () => {
    let tokenCalls = 0;
    let noteCalls = 0;
    global.fetch = routeFetch({
      token: () => { tokenCalls += 1; return okJson(200, { access_token: 'jwt-' + tokenCalls, expires_at: futureIso() }); },
      notes: () => { noteCalls += 1; return noteCalls === 1 ? okJson(401, { error: 'expired' }) : okJson(201, { id: 5 }); },
    });
    const r = await greenhouse.createNote({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, candidate_id: 100, summary: { score: 70 },
    });
    expect(r.success).toBe(true);
    expect(tokenCalls).toBe(2); // initial + forced refresh on 401
    expect(noteCalls).toBe(2);
  });
});

describe('graceful no-op + never-throws contract', () => {
  test('no-ops (no fetch) when the flag is off', async () => {
    process.env.GREENHOUSE_V3_ENABLED = 'false';
    global.fetch = jest.fn(() => Promise.reject(new Error('fetch should not be called when disabled')));
    const r = await greenhouse.createNote({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, candidate_id: 1 });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('greenhouse_v3_disabled');
    expect(global.fetch).not.toHaveBeenCalled();
    process.env.GREENHOUSE_V3_ENABLED = 'true';
  });

  test('no-ops when unconfigured (no creds resolvable)', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('fetch should not be called when unconfigured')));
    const r = await greenhouse.createNote({ candidate_id: 1 });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('greenhouse_not_configured');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns an error (never throws) on a bad candidate_id', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('fetch should not be called')));
    const r = await greenhouse.createNote({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, candidate_id: 'not-a-number' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/candidate_id/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a terminal Greenhouse error is returned, not thrown', async () => {
    global.fetch = routeFetch({
      token: () => okJson(200, { access_token: 'jwt', expires_at: futureIso() }),
      notes: () => Promise.resolve({ ok: false, status: 422, text: () => Promise.resolve('invalid candidate') }),
    });
    const r = await greenhouse.createNote({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, candidate_id: 9, summary: { score: 1 },
    });
    expect(r.success).toBe(false);
    expect(r.status).toBe(422);
    expect(r.error).toContain('invalid candidate');
  });
});

describe('setTenantCreds stores the secret encrypted (not plaintext)', () => {
  test('upserts a cryptoVault token, never the raw client_secret', async () => {
    const res = await greenhouse.setTenantCreds('acct-1', {
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, defaultUserId: '77',
    });
    expect(res).toEqual({ configured: true, last4: CLIENT_ID.slice(-4) });

    const row = mockState.upserted;
    expect(row.client_id).toBe(CLIENT_ID);
    expect(row.default_user_id).toBe('77');
    expect(row.client_secret_enc).toBeTruthy();
    expect(row.client_secret_enc).not.toContain(CLIENT_SECRET); // not plaintext
    expect(row.client_secret_enc.startsWith('v1:')).toBe(true);  // versioned cryptoVault token
    expect(cryptoVault.decrypt(row.client_secret_enc)).toBe(CLIENT_SECRET); // round-trips
  });
});
