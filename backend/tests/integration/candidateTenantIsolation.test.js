/**
 * Tenant-isolation security regression — REVIEW-2026-06 §D.
 *
 * THE invariant under test: an UNAUTHENTICATED caller must NEVER receive another
 * tenant's candidate PII. Pre-fix, the candidate READ/SEARCH routes used
 * `optionalSupabaseAuth` with a `req.user?.supabase || supabaseAdmin` fallback, so a
 * no-token request was handed the RLS-BYPASSING service-role client AND the
 * `recruiter_id` filter was skipped — leaking every recruiter's candidates. The fix
 * makes these routes hard-authed (`supabaseAuth`), so a missing token is a 401 and the
 * service-role client is never reachable from an unauthenticated request.
 *
 * This runs with NO database: `../../src/config/supabase` is mocked so the service-role
 * client is a HONEYPOT that would return Tenant B's rows if any handler ever touched it.
 * An unauthenticated request must 401 BEFORE reaching it — never see those rows.
 */

// Tenant B's private candidate rows. If the service-role honeypot is ever queried by an
// unauthenticated request, these PII rows would leak into the response — the exact bug.
const TENANT_B_ROWS = [
  { id: 'b1', name: 'Victim One', email: 'victim1@tenant-b.com', recruiter_id: 'tenant-b' },
  { id: 'b2', name: 'Victim Two', email: 'victim2@tenant-b.com', recruiter_id: 'tenant-b' },
];

// A builder whose every terminal awaits to Tenant B's rows. Models the service-role
// (RLS-bypassing) client: it would happily return cross-tenant data.
const adminLeakResult = { data: TENANT_B_ROWS, error: null, count: TENANT_B_ROWS.length };
let adminQueried = false;
const makeLeakQuery = () => {
  const q = {
    select: () => q,
    order: () => q,
    range: () => q,
    eq: () => q,
    or: () => q,
    limit: () => q,
    single: async () => { adminQueried = true; return { data: TENANT_B_ROWS[0], error: null }; },
    then: (resolve) => { adminQueried = true; return Promise.resolve(adminLeakResult).then(resolve); },
  };
  return q;
};

const mockGetUser = jest.fn();
const mockSupabaseAdmin = { __id: 'ADMIN', from: () => makeLeakQuery() };

jest.mock('../../src/config/supabase', () => ({
  supabase: { auth: { getUser: (...a) => mockGetUser(...a) }, from: () => makeLeakQuery() },
  supabaseAdmin: mockSupabaseAdmin,
  createAuthenticatedClient: jest.fn((token) => ({ __id: 'SCOPED', token, from: () => makeLeakQuery() })),
  uploadResumeToStorage: jest.fn(),
}));

const request = require('supertest');

describe('candidate tenant isolation (REVIEW-2026-06 §D)', () => {
  const savedMockDb = process.env.USE_MOCK_DB;
  let app;

  beforeAll(() => {
    // Exercise the REAL auth path, not the mock-DB bypass that attaches supabaseAdmin.
    process.env.USE_MOCK_DB = 'false';
    process.env.ENABLE_SOURCING = 'true';
    app = require('../../src/app');
  });
  afterAll(() => { process.env.USE_MOCK_DB = savedMockDb; });

  beforeEach(() => {
    adminQueried = false;
    mockGetUser.mockReset();
  });

  test('UNAUTHENTICATED GET /api/candidates → 401, never leaks another tenant rows', async () => {
    const res = await request(app).get('/api/candidates');

    // Hard-auth: no token must be rejected outright.
    expect(res.status).toBe(401);

    // The service-role (RLS-bypass) honeypot must NEVER be touched for a no-token request.
    expect(adminQueried).toBe(false);

    // And under no circumstances may Tenant B's PII appear in the body.
    const body = JSON.stringify(res.body || {});
    expect(body).not.toContain('victim1@tenant-b.com');
    expect(body).not.toContain('Victim One');
    expect(res.body.candidates).toBeUndefined();
  });

  test('UNAUTHENTICATED GET /api/candidates/:id → 401, no cross-tenant row by id', async () => {
    const res = await request(app).get('/api/candidates/b1');
    expect(res.status).toBe(401);
    expect(adminQueried).toBe(false);
    expect(JSON.stringify(res.body || {})).not.toContain('victim1@tenant-b.com');
  });

  test('UNAUTHENTICATED POST /api/candidates/search → 401, no widened result set', async () => {
    const res = await request(app)
      .post('/api/candidates/search')
      .send({ jobDescription: 'any role' });
    expect(res.status).toBe(401);
    expect(adminQueried).toBe(false);
    expect(JSON.stringify(res.body || {})).not.toContain('victim1@tenant-b.com');
  });

  test('UNAUTHENTICATED GET /api/pipeline → 401, never service-role', async () => {
    const res = await request(app).get('/api/pipeline');
    expect(res.status).toBe(401);
    expect(adminQueried).toBe(false);
  });

  test('an INVALID token is rejected (401) and never escalates to service-role', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    const res = await request(app)
      .get('/api/candidates')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(adminQueried).toBe(false);
    expect(JSON.stringify(res.body || {})).not.toContain('victim1@tenant-b.com');
  });
});
