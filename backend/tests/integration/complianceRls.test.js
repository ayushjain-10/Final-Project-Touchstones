/**
 * Compliance labels — cross-tenant / hard-auth security regression (CC1 v3).
 *
 * THE invariant: the compliance_demographic_labels table is the MOST SENSITIVE in the product
 * (employer-provided protected-class group labels). Its routes must be HARD-AUTHED — an
 * unauthenticated (or invalid-token) caller must NEVER reach the service-role (RLS-bypassing)
 * client, and must never receive another tenant's labels or adverse-impact results.
 *
 * Like candidateTenantIsolation.test.js, this runs with NO real DB: `../../src/config/supabase`
 * is mocked so the service-role client is a HONEYPOT pre-loaded with "Tenant B" labels. If any
 * handler ever touches it for a no-token request, the test fails. (The real Postgres RLS boundary
 * is owner-only by migration 063 and is verified live at ship time + by complianceService.spec.js.)
 */

// Tenant B's private demographic labels — the exact data that must never leak.
const TENANT_B_LABELS = [
  { id: 'l1', account_id: 'tenant-b', submission_id: 'sub-b1', attribute: 'race_ethnicity', value: 'Group B-Secret' },
];
const adminLeakResult = { data: TENANT_B_LABELS, error: null, count: TENANT_B_LABELS.length };
let adminQueried = false;
const makeLeakQuery = () => {
  const q = {
    select: () => q,
    insert: () => q,
    upsert: () => q,
    update: () => q,
    delete: () => q,
    eq: () => q,
    in: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: async () => { adminQueried = true; return { data: TENANT_B_LABELS[0], error: null }; },
    single: async () => { adminQueried = true; return { data: TENANT_B_LABELS[0], error: null }; },
    then: (resolve) => { adminQueried = true; return Promise.resolve(adminLeakResult).then(resolve); },
  };
  return q;
};

const mockGetUser = jest.fn();
const mockSupabaseAdmin = { __id: 'ADMIN', from: () => makeLeakQuery(), rpc: async () => { adminQueried = true; return { data: null, error: null }; } };

jest.mock('../../src/config/supabase', () => ({
  supabase: { auth: { getUser: (...a) => mockGetUser(...a) }, from: () => makeLeakQuery() },
  supabaseAdmin: mockSupabaseAdmin,
  createAuthenticatedClient: jest.fn((token) => ({ __id: 'SCOPED', token, from: () => makeLeakQuery() })),
  uploadResumeToStorage: jest.fn(),
}));

const request = require('supertest');

describe('compliance labels hard-auth / tenant isolation (CC1 v3)', () => {
  const savedMockDb = process.env.USE_MOCK_DB;
  let app;

  beforeAll(() => {
    process.env.USE_MOCK_DB = 'false'; // exercise the REAL auth path, not the mock-DB bypass
    app = require('../../src/app');
  });
  afterAll(() => { process.env.USE_MOCK_DB = savedMockDb; });
  beforeEach(() => { adminQueried = false; mockGetUser.mockReset(); });

  const assertBlocked = (res) => {
    expect(res.status).toBe(401);
    expect(adminQueried).toBe(false); // service-role honeypot must NOT be touched
    expect(JSON.stringify(res.body || {})).not.toContain('Group B-Secret');
  };

  test('UNAUTH POST /api/compliance/labels → 401, never reaches the service role', async () => {
    const res = await request(app).post('/api/compliance/labels')
      .send({ labels: [{ submission_id: '00000000-0000-0000-0000-000000000000', attribute: 'race_ethnicity', value: 'x' }] });
    assertBlocked(res);
  });

  test('UNAUTH GET /api/compliance/adverse-impact/role/:role → 401, no cross-tenant results', async () => {
    const res = await request(app).get('/api/compliance/adverse-impact/role/backend?attribute=race_ethnicity&outcome=advanced');
    assertBlocked(res);
  });

  test('UNAUTH GET /api/compliance/export/role/:role → 401', async () => {
    const res = await request(app).get('/api/compliance/export/role/backend');
    assertBlocked(res);
  });

  test('UNAUTH GET /api/compliance/roles → 401', async () => {
    const res = await request(app).get('/api/compliance/roles');
    assertBlocked(res);
  });

  test('INVALID token → 401, never escalates to the service role', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    const res = await request(app).get('/api/compliance/roles').set('Authorization', 'Bearer not-a-real-token');
    assertBlocked(res);
  });
});
