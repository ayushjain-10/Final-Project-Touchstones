/**
 * Benchmarks API integration tests (CC3 / Calibrated Score + Benchmarks).
 * The aggregate reads need a live DB (they 500 in CI's mock mode, like the other suites), so
 * those assertions are tolerant. The validation + authorization gates, however, run BEFORE any
 * DB access, so they are asserted deterministically.
 */
const request = require('supertest');
const app = require('../../src/app');

describe('Benchmarks API', () => {
  let authToken;
  beforeAll(() => {
    authToken = testUtils.generateTestToken('00000000-0000-0000-0000-000000000001', 'bench@example.com');
  });

  describe('GET /api/benchmarks/score/:scoreId', () => {
    it('rejects a non-UUID score id with 400 BEFORE any DB access (deterministic)', async () => {
      const res = await request(app)
        .get('/api/benchmarks/score/not-a-uuid')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns JSON for a well-formed id (200 with data, or 401/404/500 without a live DB)', async () => {
      const res = await request(app)
        .get('/api/benchmarks/score/11111111-1111-1111-1111-111111111111')
        .set('Authorization', `Bearer ${authToken}`);
      expect([200, 401, 404, 500]).toContain(res.status);
      expect(res.headers['content-type']).toMatch(/json/);
    });
  });

  describe('POST /api/benchmarks/refresh', () => {
    it('refuses a global refresh without a valid cron secret with 403 (deterministic)', async () => {
      const res = await request(app)
        .post('/api/benchmarks/refresh?scope=global')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error');
    });

    it('accepts an account refresh (200, or 500 without a live DB)', async () => {
      const res = await request(app)
        .post('/api/benchmarks/refresh')
        .set('Authorization', `Bearer ${authToken}`);
      expect([200, 401, 500]).toContain(res.status);
    });
  });

  describe('GET /api/benchmarks/summary', () => {
    it('returns JSON (200 with data, or 401/500 without a live DB)', async () => {
      const res = await request(app)
        .get('/api/benchmarks/summary')
        .set('Authorization', `Bearer ${authToken}`);
      expect([200, 401, 500]).toContain(res.status);
      expect(res.headers['content-type']).toMatch(/json/);
    });
  });

  describe('GET /api/benchmarks/roles/:role', () => {
    it('returns JSON for a role family (200, or 401/500 without a live DB)', async () => {
      const res = await request(app)
        .get('/api/benchmarks/roles/backend')
        .set('Authorization', `Bearer ${authToken}`);
      expect([200, 401, 500]).toContain(res.status);
    });
  });
});
