/**
 * Candidate Network / "Apply with Touchstones" (CC3/v3) — route authorization wiring.
 * ----------------------------------------------------------------------------------------
 * Runs with NO database: `../../src/config/supabase` is mocked so the service-role client is a
 * HONEYPOT. The invariants under test (the v2 lessons, at the route layer):
 *   • Every candidate/employer WRITE + private READ is HARD-AUTHED — a missing/invalid token is
 *     a 401 BEFORE any handler touches the RLS-bypassing service-role client.
 *   • The PUBLIC /apply/:token page is REDACTED: it proxies the locked get_req() RPC and the
 *     route only ever forwards the allowlisted public fields — never owner_id / PII (the
 *     redaction is asserted by feeding the RPC a row WITH owner_id and proving it's stripped).
 *   • A FORGED / malformed apply token is rejected (404) — a bad-shape token never even reaches
 *     the RPC; a well-formed-but-unknown token returns 404 (no enumeration, no leak).
 */

// Honeypot: a terminal query that, if ever awaited, flags that the service-role client was
// touched. The protected routes must 401 BEFORE this is reachable.
let adminTouched = false;
const leakQuery = () => {
  const q = {
    select: () => q,
    eq: () => q,
    in: () => q,
    order: () => q,
    update: () => q,
    insert: () => q,
    upsert: () => q,
    maybeSingle: async () => { adminTouched = true; return { data: null, error: null }; },
    single: async () => { adminTouched = true; return { data: null, error: null }; },
    then: (resolve) => { adminTouched = true; return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve); },
  };
  return q;
};

const mockGetUser = jest.fn();
const mockAdminRpc = jest.fn();

jest.mock('../../src/config/supabase', () => ({
  supabase: { auth: { getUser: (...a) => mockGetUser(...a) }, from: () => leakQuery(), rpc: async () => ({ data: null, error: null }) },
  supabaseAdmin: { from: () => leakQuery(), rpc: (...a) => mockAdminRpc(...a) },
  createAuthenticatedClient: jest.fn((token) => ({ __scoped: true, token, from: () => leakQuery() })),
  uploadResumeToStorage: jest.fn(),
}));

const request = require('supertest');

describe('network route authorization (CC3)', () => {
  const savedMockDb = process.env.USE_MOCK_DB;
  let app;

  beforeAll(() => {
    // Exercise the REAL auth path, not the mock-DB bypass (which would attach supabaseAdmin).
    process.env.USE_MOCK_DB = 'false';
    app = require('../../src/app');
  });
  afterAll(() => { process.env.USE_MOCK_DB = savedMockDb; });

  beforeEach(() => {
    adminTouched = false;
    mockGetUser.mockReset();
    mockAdminRpc.mockReset();
  });

  // ── Hard-auth: protected routes 401 with no token, never reaching the service-role client ──
  const protectedRoutes = [
    ['post', '/api/network/apply', { req_token: 'abc123', credential_id: '11111111-1111-1111-1111-111111111111' }],
    ['get', '/api/network/credentials', null],
    ['get', '/api/network/applications', null],
    ['post', '/api/network/reqs', { title: 'Backend Engineer' }],
    ['get', '/api/network/reqs', null],
    ['post', '/api/network/applications/11111111-1111-1111-1111-111111111111/accept', {}],
    ['delete', '/api/network/applications/11111111-1111-1111-1111-111111111111', null],
  ];

  test.each(protectedRoutes)('UNAUTHENTICATED %s %s → 401, never service-role', async (method, path, body) => {
    let r = request(app)[method](path);
    if (body) r = r.send(body);
    const res = await r;
    expect(res.status).toBe(401);
    expect(adminTouched).toBe(false);
  });

  test('an INVALID token is rejected (401) and never escalates to service-role', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    const res = await request(app)
      .post('/api/network/apply')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ req_token: 'abc123', credential_id: '11111111-1111-1111-1111-111111111111' });
    expect(res.status).toBe(401);
    expect(adminTouched).toBe(false);
  });

  // ── PUBLIC /apply/:token — redaction + forged-token rejection ──
  test('PUBLIC GET /apply/:token redacts to public fields only (no owner_id / PII)', async () => {
    // The locked get_req() RPC returns a row that INCLUDES owner_id — the route must strip it.
    mockAdminRpc.mockResolvedValue({
      data: {
        title: 'Senior Backend Engineer',
        role_family: 'backend',
        company_label: 'Acme',
        is_open: true,
        created_at: '2026-06-26T00:00:00Z',
        owner_id: 'SECRET-OWNER-UUID',
        public_token: 'abc123',
      },
      error: null,
    });
    const res = await request(app).get('/api/network/apply/abc123');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.req).toEqual({
      title: 'Senior Backend Engineer',
      role_family: 'backend',
      company_label: 'Acme',
      is_open: true,
      created_at: '2026-06-26T00:00:00Z',
    });
    // The PII / internal fields must NOT survive the redaction.
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain('SECRET-OWNER-UUID');
    expect(res.body.req).not.toHaveProperty('owner_id');
    expect(res.body.req).not.toHaveProperty('public_token');
  });

  test('a MALFORMED apply token is 404 and never reaches the RPC', async () => {
    const res = await request(app).get('/api/network/apply/has%20space%21'); // not [0-9a-zA-Z]
    expect(res.status).toBe(404);
    expect(res.body.valid).toBe(false);
    expect(mockAdminRpc).not.toHaveBeenCalled();
  });

  test('a well-formed but UNKNOWN apply token returns 404 (no enumeration)', async () => {
    mockAdminRpc.mockResolvedValue({ data: null, error: null }); // RPC finds no req
    const res = await request(app).get('/api/network/apply/deadbeefdeadbeefdeadbeefdeadbeef');
    expect(res.status).toBe(404);
    expect(res.body.valid).toBe(false);
  });
});
