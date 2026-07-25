/**
 * Auth / tenant-isolation security regression (SYSTEM_DESIGN #1, #17).
 *
 * Guards THE catastrophic invariant: the auth middleware must never hand the
 * service-role client (`supabaseAdmin`) to a user-supplied token, and must reject any
 * token that isn't a valid Supabase session — including a custom JWT forged with our
 * own JWT_SECRET (the old escalation path). This runs in CI with NO database by mocking
 * the Supabase config, so it is a HARD gate on every push.
 */
const jwt = require('jsonwebtoken');

// Controllable Supabase mock. `mock`-prefixed names are the only out-of-scope vars a
// jest.mock factory may reference. `__id` lets us assert WHICH client was attached.
const mockGetUser = jest.fn();
const mockSupabaseAdmin = {
  __id: 'ADMIN',
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { code: 'PGRST116' } }) }) }) }),
};
const mockCreateAuthenticatedClient = jest.fn((token) => ({ __id: 'SCOPED', token }));

jest.mock('../../src/config/supabase', () => ({
  supabase: { auth: { getUser: (...a) => mockGetUser(...a) } },
  supabaseAdmin: mockSupabaseAdmin,
  createAuthenticatedClient: mockCreateAuthenticatedClient,
}));

const { supabaseAuth } = require('../../src/middleware/supabaseAuth');

function runAuth(headers) {
  return new Promise((resolve) => {
    const req = { headers: headers || {} };
    const res = {
      statusCode: 200,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve({ req, res: this, nexted: false }); },
    };
    const next = () => resolve({ req, res, nexted: true });
    supabaseAuth(req, res, next);
  });
}

describe('auth isolation (no service-role escalation)', () => {
  const savedMock = process.env.USE_MOCK_DB;
  beforeEach(() => {
    // Exercise the REAL auth path, not the mock-DB bypass.
    process.env.USE_MOCK_DB = 'false';
    mockGetUser.mockReset();
    mockCreateAuthenticatedClient.mockClear();
  });
  afterAll(() => { process.env.USE_MOCK_DB = savedMock; });

  test('missing token → 401, never calls next', async () => {
    const { res, nexted } = await runAuth({});
    expect(res.statusCode).toBe(401);
    expect(nexted).toBe(false);
  });

  test('invalid Supabase token → 401, no admin client attached', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    const { req, res, nexted } = await runAuth({ authorization: 'Bearer not-a-real-token' });
    expect(res.statusCode).toBe(401);
    expect(nexted).toBe(false);
    expect(req.user).toBeUndefined();
  });

  test('FORGED custom JWT (signed with our JWT_SECRET) is REJECTED — the escalation path is gone', async () => {
    // Pre-fix, this token took the custom-JWT branch and was handed supabaseAdmin.
    const forged = jwt.sign({ id: 'attacker', email: 'attacker@evil.com' }, process.env.JWT_SECRET || 'test-secret-key');
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'not a supabase token' } });
    const { res, nexted } = await runAuth({ authorization: `Bearer ${forged}` });
    expect(res.statusCode).toBe(401);
    expect(nexted).toBe(false);
    expect(mockCreateAuthenticatedClient).not.toHaveBeenCalled();
  });

  test('valid Supabase token → token-SCOPED client attached, NOT supabaseAdmin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'real@user.com' } }, error: null });
    const { req, res, nexted } = await runAuth({ authorization: 'Bearer real-supabase-token' });
    expect(nexted).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(req.user.id).toBe('user-1');
    expect(mockCreateAuthenticatedClient).toHaveBeenCalledWith('real-supabase-token');
    // The load-bearing assertion: the per-request client is RLS-scoped, never the admin.
    expect(req.user.supabase.__id).toBe('SCOPED');
    expect(req.user.supabase).not.toBe(mockSupabaseAdmin);
  });
});

/**
 * Live cross-tenant RLS test (SYSTEM_DESIGN #17). Requires a real Supabase test DB —
 * skipped in CI-without-DB. Wire SUPABASE_TEST_URL + two seeded recruiter sessions to
 * enforce: recruiter A gets 404/empty on recruiter B's work_samples / submissions /
 * proof_scores / comments. Until a CI test DB (Supabase branch) is wired, the mocked
 * isolation test above is the always-on gate.
 */
const hasLiveDb = !!process.env.SUPABASE_TEST_URL;
(hasLiveDb ? describe : describe.skip)('live cross-tenant RLS (requires SUPABASE_TEST_URL)', () => {
  test.todo('recruiter A cannot read recruiter B work_samples');
  test.todo('recruiter A cannot read recruiter B work_sample_submissions');
  test.todo('recruiter A cannot read recruiter B proof_scores');
});
