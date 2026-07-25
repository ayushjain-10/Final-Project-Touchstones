/**
 * apiKeyAuth middleware — Verify API Phase 1 auth + tenancy.
 * ---------------------------------------------------------
 * CI-safe: NO live DB. `../../src/config/supabase` is mocked with a tiny in-memory
 * api_keys store keyed by hashed_key; the middleware is driven directly with fake
 * req/res objects (deterministic, no network).
 *
 * Asserts the contract:
 *   - a valid key → next() + req.apiAccount = { accountId, mode, scopes, keyId, db }
 *   - unknown / revoked / malformed / missing → 401 with { error:{ type:'auth_error', message } }
 *   - the key's mode must match its prefix (a tampered prefix is rejected)
 *   - TENANCY: account A's key resolves ONLY account A (never B)
 *   - requireScope gates with 403 on a missing scope
 */

const crypto = require('crypto');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// --- in-memory api_keys store, seeded per test via __setKeys --------------------------
// Lives inside the mock factory (jest hoists jest.mock above imports). Each "row" is
// looked up by .eq('hashed_key', <hash>).maybeSingle().
jest.mock('../../src/config/supabase', () => {
  let rows = [];
  const makeQuery = (table) => {
    const q = { _table: table, _filters: [], _update: null };
    q.select = () => q;
    q.update = (patch) => { q._update = patch; return q; };
    q.eq = (col, val) => { q._filters.push((r) => r[col] === val); return q; };
    const match = () => rows.filter((r) => q._filters.every((f) => f(r)));
    q.maybeSingle = async () => {
      const m = match();
      // Apply a pending update (last_used_at bump) in-place so the store reflects it.
      if (q._update) m.forEach((r) => Object.assign(r, q._update));
      return { data: m[0] || null, error: null };
    };
    // The last_used_at bump awaits the update builder directly (no .single()).
    q.then = (resolve) => {
      if (q._update) match().forEach((r) => Object.assign(r, q._update));
      return Promise.resolve({ data: null, error: null }).then(resolve);
    };
    return q;
  };
  return {
    supabaseAdmin: { __id: 'ADMIN', from: (t) => makeQuery(t) },
    createAuthenticatedClient: jest.fn((token) => ({ __id: 'SCOPED', token })),
    __setKeys: (k) => { rows = k; },
  };
});

const { __setKeys, supabaseAdmin } = require('../../src/config/supabase');
const { apiKeyAuth, requireScope } = require('../../src/middleware/apiKeyAuth');
const { generateKey } = require('../../src/services/apiKeyService');

// Minimal fake res capturing status + json body.
const makeRes = () => {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const run = (req) => new Promise((resolve) => {
  const res = makeRes();
  let nexted = false;
  apiKeyAuth(req, res, () => { nexted = true; resolve({ res, nexted }); })
    .then(() => { if (!nexted) resolve({ res, nexted }); });
});

const ACCOUNT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACCOUNT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Build a seed row from a generated plaintext key.
const seedRow = (overrides = {}) => {
  const mode = overrides.mode || 'live';
  const { plaintext, prefix, last4 } = generateKey(mode);
  const row = {
    id: overrides.id || crypto.randomUUID(),
    account_id: overrides.account_id || ACCOUNT_A,
    mode,
    scopes: overrides.scopes || [],
    prefix,
    last4,
    hashed_key: sha256(plaintext),
    revoked_at: overrides.revoked_at || null,
    last_used_at: null,
    ...overrides,
  };
  return { row, plaintext };
};

beforeEach(() => {
  __setKeys([]);
  delete process.env.SUPABASE_JWT_SECRET; // fallback (supabaseAdmin) path for db assertions
});

describe('apiKeyAuth — accept', () => {
  test('valid key → next() with req.apiAccount = {accountId, mode, scopes, keyId, db}', async () => {
    const { row, plaintext } = seedRow({ account_id: ACCOUNT_A, mode: 'live', scopes: ['verifications:write'] });
    __setKeys([row]);

    const req = { headers: { authorization: `Bearer ${plaintext}` } };
    const { res, nexted } = await run(req);

    expect(nexted).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(req.apiAccount).toBeDefined();
    expect(req.apiAccount.accountId).toBe(ACCOUNT_A);
    expect(req.apiAccount.mode).toBe('live');
    expect(req.apiAccount.scopes).toEqual(['verifications:write']);
    expect(req.apiAccount.keyId).toBe(row.id);
    // No SUPABASE_JWT_SECRET → db is the supabaseAdmin fallback.
    expect(req.apiAccount.db).toBe(supabaseAdmin);
  });

  test('accepts the key via the X-API-Key header too', async () => {
    const { row, plaintext } = seedRow();
    __setKeys([row]);
    const { res, nexted } = await run({ headers: { 'x-api-key': plaintext } });
    expect(nexted).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  test('best-effort last_used_at bump is applied', async () => {
    const { row, plaintext } = seedRow();
    __setKeys([row]);
    await run({ headers: { authorization: `Bearer ${plaintext}` } });
    // Allow the fire-and-forget update microtask to settle.
    await new Promise((r) => setImmediate(r));
    expect(row.last_used_at).not.toBe(null);
  });
});

describe('apiKeyAuth — reject (401, auth_error envelope)', () => {
  const expectAuthError = (res) => {
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: { type: 'auth_error', message: expect.any(String) } });
  };

  test('missing key → 401', async () => {
    const { res, nexted } = await run({ headers: {} });
    expect(nexted).toBe(false);
    expectAuthError(res);
  });

  test('malformed key (not tsk_) → 401, never hits the DB', async () => {
    const spy = jest.spyOn(supabaseAdmin, 'from');
    const { res, nexted } = await run({ headers: { authorization: 'Bearer garbage' } });
    expect(nexted).toBe(false);
    expectAuthError(res);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('unknown key (no matching hash) → 401', async () => {
    __setKeys([]); // empty store
    const { plaintext } = generateKey('live');
    const { res, nexted } = await run({ headers: { authorization: `Bearer ${plaintext}` } });
    expect(nexted).toBe(false);
    expectAuthError(res);
  });

  test('revoked key → 401', async () => {
    const { row, plaintext } = seedRow({ revoked_at: new Date().toISOString() });
    __setKeys([row]);
    const { res, nexted } = await run({ headers: { authorization: `Bearer ${plaintext}` } });
    expect(nexted).toBe(false);
    expectAuthError(res);
  });

  test('mode/prefix mismatch (tampered prefix) → 401', async () => {
    // Plaintext says live, but the stored row claims test → reject.
    const { plaintext } = generateKey('live');
    const row = {
      id: crypto.randomUUID(),
      account_id: ACCOUNT_A,
      mode: 'test', // mismatch vs the live prefix
      scopes: [],
      revoked_at: null,
      hashed_key: sha256(plaintext),
    };
    __setKeys([row]);
    const { res, nexted } = await run({ headers: { authorization: `Bearer ${plaintext}` } });
    expect(nexted).toBe(false);
    expectAuthError(res);
  });
});

describe('apiKeyAuth — tenancy', () => {
  test("account A's key resolves ONLY account A (never B)", async () => {
    const a = seedRow({ account_id: ACCOUNT_A });
    const b = seedRow({ account_id: ACCOUNT_B });
    __setKeys([a.row, b.row]);

    const reqA = { headers: { authorization: `Bearer ${a.plaintext}` } };
    await run(reqA);
    expect(reqA.apiAccount.accountId).toBe(ACCOUNT_A);

    const reqB = { headers: { authorization: `Bearer ${b.plaintext}` } };
    await run(reqB);
    expect(reqB.apiAccount.accountId).toBe(ACCOUNT_B);

    // Cross check: A's key never yields B's account.
    expect(reqA.apiAccount.accountId).not.toBe(ACCOUNT_B);
  });
});

describe('requireScope', () => {
  const callScope = (scope, scopes) => {
    const req = { apiAccount: { accountId: ACCOUNT_A, scopes } };
    const res = makeRes();
    let nexted = false;
    requireScope(scope)(req, res, () => { nexted = true; });
    return { res, nexted };
  };

  test('passes when the key has the scope', () => {
    const { res, nexted } = callScope('verifications:write', ['verifications:write']);
    expect(nexted).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  test('403 (auth_error) when the scope is missing — fail closed', () => {
    const { res, nexted } = callScope('verifications:write', []);
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: { type: 'auth_error', message: expect.any(String) } });
  });
});
