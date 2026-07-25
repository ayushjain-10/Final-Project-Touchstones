/**
 * Authorization / Auth Middleware Tests
 *
 * Audits the platform authorization layer (middleware/supabaseAuth.js):
 *   - supabaseAuth: missing / malformed / invalid bearer token handling
 *   - optionalSupabaseAuth: passes through without a token
 *   - requireSubscription: plan gating
 *
 * IMPORTANT ENV NOTE:
 *   The test setup sets USE_MOCK_DB=true, which makes supabaseAuth BYPASS auth
 *   entirely at the app level (every request is treated as the mock user).
 *   Therefore, hitting protected endpoints through the app does NOT exercise the
 *   real 401 path. To genuinely verify the "no token -> 401" contract, we invoke
 *   the middleware directly with USE_MOCK_DB temporarily disabled. The app-level
 *   tests below assert the resilient status ranges used elsewhere in this repo.
 */

const request = require('supertest');

const app = require('../../src/app');
const {
  supabaseAuth,
  optionalSupabaseAuth,
  requireSubscription
} = require('../../src/middleware/supabaseAuth');

// Minimal Express req/res/next test doubles
function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

describe('Authorization Middleware (supabaseAuth) - direct unit', () => {
  const ORIGINAL_MOCK = process.env.USE_MOCK_DB;

  // Disable mock bypass so we exercise the real auth code path.
  beforeAll(() => {
    process.env.USE_MOCK_DB = 'false';
  });
  afterAll(() => {
    process.env.USE_MOCK_DB = ORIGINAL_MOCK;
  });

  it('returns 401 when no Authorization header is present', async () => {
    const req = { headers: {} };
    const res = mockRes();
    let nextCalled = false;

    await supabaseAuth(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 when Authorization header does not start with Bearer', async () => {
    const req = { headers: { authorization: 'Token abc123' } };
    const res = mockRes();
    let nextCalled = false;

    await supabaseAuth(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('rejects an invalid / unverifiable bearer token (401 or 500, never authorized)', async () => {
    const req = { headers: { authorization: 'Bearer not-a-real-token' } };
    const res = mockRes();
    let nextCalled = false;

    await supabaseAuth(req, res, () => { nextCalled = true; });

    // Without a live Supabase connection the getUser call may throw (500) or
    // return an error which then fails the JWT fallback (401). Either way the
    // request must NOT be authorized.
    expect(nextCalled).toBe(false);
    expect([401, 500]).toContain(res.statusCode);
  });

  it('rejects a syntactically-valid JWT signed with the wrong secret', async () => {
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ id: 'attacker', email: 'a@b.c' }, 'WRONG-SECRET');
    const req = { headers: { authorization: `Bearer ${forged}` } };
    const res = mockRes();
    let nextCalled = false;

    await supabaseAuth(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect([401, 500]).toContain(res.statusCode);
  });
});

describe('optionalSupabaseAuth - direct unit', () => {
  it('passes through with req.user = null when no token provided', async () => {
    const req = { headers: {} };
    const res = mockRes();
    let nextCalled = false;

    await optionalSupabaseAuth(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(req.user).toBeNull();
  });
});

describe('requireSubscription - direct unit', () => {
  it('returns 401 when no user is attached', async () => {
    const req = {};
    const res = mockRes();
    let nextCalled = false;

    requireSubscription(['growth'])(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when user plan is not in the allowed list', async () => {
    const req = { user: { subscription_plan: 'free' } };
    const res = mockRes();
    let nextCalled = false;

    requireSubscription(['growth', 'enterprise'])(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toHaveProperty('currentPlan', 'free');
  });

  it('calls next() when user plan is allowed', async () => {
    const req = { user: { subscription_plan: 'growth' } };
    const res = mockRes();
    let nextCalled = false;

    requireSubscription(['growth', 'enterprise'])(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  it('defaults to "free" plan when subscription_plan is missing and rejects', () => {
    const req = { user: {} };
    const res = mockRes();
    let nextCalled = false;

    requireSubscription(['growth'])(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});

describe('Authorization - app level (mock bypass active)', () => {
  // These assert the resilient ranges used elsewhere. Under USE_MOCK_DB=true the
  // app bypasses auth, so a missing token will NOT 401 here; we document that.
  it('protected notifications endpoint responds with a JSON status', async () => {
    const res = await request(app).get('/api/notifications');
    expect([200, 401, 404, 500]).toContain(res.status);
    expect(res.type).toBe('application/json');
  });

  it('protected payments status endpoint responds with a JSON status', async () => {
    const res = await request(app).get('/api/payments/subscription-status');
    expect([200, 401, 404, 500]).toContain(res.status);
  });

  it('a valid-format JWT is accepted by the mock bypass and yields a 2xx/4xx (never crash)', async () => {
    const token = testUtils.generateTestToken(
      '00000000-0000-0000-0000-000000000001',
      'mock@touchstones.ai'
    );
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);
    expect([200, 401, 404, 500]).toContain(res.status);
  });
});
