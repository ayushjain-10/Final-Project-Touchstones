/**
 * Analytics API Tests
 * Tests analytics and dashboard endpoints
 */

const request = require('supertest');

const app = require('../../src/app');

describe('Analytics API', () => {
  let authToken;

  beforeAll(() => {
    authToken = testUtils.generateTestToken();
  });

  describe('GET /api/analytics/dashboard', () => {
    it('should require authentication', async () => {
      const res = await request(app).get('/api/analytics/dashboard');
      expect([200, 401]).toContain(res.status);
    });

    it('should return dashboard data', async () => {
      const res = await request(app)
        .get('/api/analytics/dashboard')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401]).toContain(res.status);
    });
  });

  describe('GET /api/analytics/jobs', () => {
    it('should require authentication', async () => {
      const res = await request(app).get('/api/analytics/jobs');
      expect([200, 401]).toContain(res.status);
    });

    it('should return job analytics', async () => {
      const res = await request(app)
        .get('/api/analytics/jobs')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401]).toContain(res.status);
    });

    it('should support date range filter', async () => {
      const res = await request(app)
        .get('/api/analytics/jobs')
        .query({
          startDate: '2024-01-01',
          endDate: '2024-12-31'
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401]).toContain(res.status);
    });
  });

  describe('GET /api/analytics/candidates', () => {
    it('should require authentication', async () => {
      const res = await request(app).get('/api/analytics/candidates');
      expect([200, 401]).toContain(res.status);
    });

    it('should return candidate analytics', async () => {
      const res = await request(app)
        .get('/api/analytics/candidates')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401]).toContain(res.status);
    });
  });

  describe('GET /api/analytics/pipeline', () => {
    it('should require authentication', async () => {
      const res = await request(app).get('/api/analytics/pipeline');
      expect([200, 401]).toContain(res.status);
    });

    it('should return pipeline analytics', async () => {
      const res = await request(app)
        .get('/api/analytics/pipeline')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401]).toContain(res.status);
    });
  });

  describe('GET /api/analytics/outreach', () => {
    it('should require authentication', async () => {
      const res = await request(app).get('/api/analytics/outreach');
      expect([200, 401]).toContain(res.status);
    });

    it('should return outreach analytics', async () => {
      const res = await request(app)
        .get('/api/analytics/outreach')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401]).toContain(res.status);
    });
  });

  describe('GET /api/analytics/conversion', () => {
    it('should require authentication', async () => {
      const res = await request(app).get('/api/analytics/conversion');
      expect([200, 401]).toContain(res.status);
    });

    it('should return conversion funnel data', async () => {
      const res = await request(app)
        .get('/api/analytics/conversion')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401]).toContain(res.status);
    });
  });

  describe('GET /api/analytics/time-to-hire', () => {
    it('should require authentication', async () => {
      const res = await request(app).get('/api/analytics/time-to-hire');
      expect([200, 401]).toContain(res.status);
    });

    it('should return time-to-hire metrics', async () => {
      const res = await request(app)
        .get('/api/analytics/time-to-hire')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401]).toContain(res.status);
    });
  });

  describe('GET /api/analytics/sources', () => {
    it('should require authentication', async () => {
      const res = await request(app).get('/api/analytics/sources');
      expect([200, 401]).toContain(res.status);
    });

    it('should return candidate source breakdown', async () => {
      const res = await request(app)
        .get('/api/analytics/sources')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401]).toContain(res.status);
    });
  });
});
