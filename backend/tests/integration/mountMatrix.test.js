/**
 * Mount-Matrix Contract Test (audit A-5)
 * --------------------------------------
 * Loads the real Express app (src/app.js) and asserts, via supertest and WITHOUT any
 * network/DB writes, that each critical route is (a) MOUNTED (not a 404 from the
 * catch-all) and (b) enforces the RIGHT auth CONTRACT. This is a contract test, not a
 * data test — every assertion is on status code / auth envelope, never on row data.
 *
 * Auth-contract nuance (important): in mock-DB mode the app's supabaseAuth middleware
 * BYPASSES auth entirely (dev/test convenience — see middleware/supabaseAuth.js), so an
 * unauthenticated request would NOT 401. To assert the true 401 contract we flip
 * USE_MOCK_DB='false' for the unauth cases; supabaseAuth then returns 401 for a missing
 * Bearer header BEFORE it ever calls the DB (so still no network). For the "feature-flag
 * off → 404" case we need to reach the handler, so we use mock auth (USE_MOCK_DB='true')
 * which lets the request past the auth gate; the handler self-404s with no DB touch.
 *
 * The middleware reads USE_MOCK_DB at REQUEST time, so toggling it per-test is safe even
 * though the app module is required once.
 */
const request = require('supertest');

// Env-only workaround (NOT part of the contract under test): in this local node_modules,
// `natural` transitively requires `afinn-165`, which is now ESM-only and cannot be loaded
// by jest's CommonJS transform — so requiring src/app.js throws a SyntaxError before any
// route mounts. This breaks the ENTIRE existing app-requiring integration suite too (e.g.
// tests/integration/health.test.js reproduces the identical error), not just this spec.
// `natural` is used only by resumeScreeningService (the /api/candidates resume-screen path),
// which the route/auth contract below never exercises. Stub it so the REAL app boots and the
// REAL routers + auth middleware run; nothing about the mount/auth contract is faked.
jest.mock('natural', () => new Proxy({}, {
  get: () => function NaturalStub() { return {}; },
}));

// setup.js sets USE_MOCK_DB='true' + NODE_ENV='test'. Requiring the app now is safe:
// every background worker (deadlineSweep/webhookWorker/scoringQueue/waitlistNurture)
// is guarded by NODE_ENV !== 'test', so nothing touches the network at boot.
const app = require('../../src/app');

const ORIGINAL_MOCK_DB = process.env.USE_MOCK_DB;
afterAll(() => {
  if (ORIGINAL_MOCK_DB === undefined) delete process.env.USE_MOCK_DB;
  else process.env.USE_MOCK_DB = ORIGINAL_MOCK_DB;
});

describe('Mount-Matrix contract (A-5)', () => {
  describe('Liveness + public /v1 contract surface (no auth)', () => {
    it('GET /health/live → 200 {status:ok} (never touches DB)', async () => {
      const res = await request(app).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
    });

    it('GET /v1/openapi.json → 200 (public OpenAPI contract is mounted)', async () => {
      const res = await request(app).get('/v1/openapi.json');
      expect(res.status).toBe(200);
      // Mounted + served the real spec, not the SPA/404 fallback.
      expect(res.body).toHaveProperty('openapi');
    });
  });

  describe('Unauthenticated → 401 (real-auth path; USE_MOCK_DB=false)', () => {
    beforeEach(() => { process.env.USE_MOCK_DB = 'false'; });

    // Verify API `/v1` (apiKeyAuth). A missing key is rejected with the Verify API
    // error envelope BEFORE any DB lookup (extractKey → null).
    it('POST /v1/verifications (no key) → 401 auth_error envelope', async () => {
      const res = await request(app).post('/v1/verifications').send({});
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('type', 'auth_error');
    });

    it('GET /v1/verifications/:id (no key) → 401 (read surface is key-gated too)', async () => {
      const res = await request(app).get('/v1/verifications/anything');
      expect(res.status).toBe(401);
      expect(res.body.error).toHaveProperty('type', 'auth_error');
    });

    // Candidate/recruiter surface (supabaseAuth). No Bearer → hard 401 before DB.
    // These also prove the route is MOUNTED: an unmounted path would 404 from the
    // catch-all, not 401 from the router's auth guard.
    it('GET /api/proof/speech-token (unauth) → 401 (candidate-auth gate; route mounted)', async () => {
      const res = await request(app).get('/api/proof/speech-token');
      expect(res.status).toBe(401);
      expect(res.status).not.toBe(404);
    });

    it('GET /api/proof/activity (unauth) → 401 (representative existing /api/proof/* route)', async () => {
      const res = await request(app).get('/api/proof/activity');
      expect(res.status).toBe(401);
      expect(res.status).not.toBe(404);
    });

    it('GET /api/assessments/public (unauth) → 401', async () => {
      const res = await request(app).get('/api/assessments/public');
      expect(res.status).toBe(401);
      expect(res.status).not.toBe(404);
    });

    it('POST /api/assessments/:id/use (unauth) → 401', async () => {
      const res = await request(app).post('/api/assessments/00000000-0000-0000-0000-000000000000/use').send({});
      expect(res.status).toBe(401);
      expect(res.status).not.toBe(404);
    });

    it('GET /api/assessments (unauth) → 401 (representative list route)', async () => {
      const res = await request(app).get('/api/assessments');
      expect(res.status).toBe(401);
      expect(res.status).not.toBe(404);
    });
  });

  describe('Feature-flag OFF → 404 (authed handler reached via mock auth)', () => {
    // With mock auth the request passes the auth gate and reaches the handler, which
    // self-404s because ENABLE_SPEECH_WALKTHROUGH is unset (speechService.isEnabled()
    // === false). This proves the route is wired to speechService AND fails closed when
    // the flag is off — with no DB and no network (the token issuer is never called).
    it('GET /api/proof/speech-token (authed, speech flag off) → 404 not-enabled', async () => {
      process.env.USE_MOCK_DB = 'true';
      const res = await request(app)
        .get('/api/proof/speech-token')
        .set('Authorization', 'Bearer mock-test-token');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });
});
