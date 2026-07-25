/**
 * Mock Mode Data Loading Tests
 *
 * CRITICAL: These tests verify that the API returns data properly in mock mode (USE_MOCK_DB=true).
 * This test would have caught the bug where jobs/candidates failed to load because
 * the supabaseAuth middleware wasn't handling mock mode properly.
 *
 * The bug: When USE_MOCK_DB=true, the auth middleware was still requiring a valid token
 * instead of bypassing auth and using mock user data. This caused:
 * - /api/jobs to return 401 "No authorization token provided"
 * - Frontend to show "Failed to load jobs" error
 */

const request = require('supertest');

const app = require('../../src/app');

describe('Mock Mode Data Loading (USE_MOCK_DB=true)', () => {
  /**
   * This test checks that the Jobs API works in mock mode WITHOUT requiring auth.
   *
   * FAILURE CONDITION (would have caught the bug):
   * - If this test fails with 401 "No authorization token provided",
   *   it means the supabaseAuth middleware is not properly checking USE_MOCK_DB
   * - The middleware should bypass auth when USE_MOCK_DB=true and create a mock user
   */
  describe('Jobs API - Mock Mode', () => {
    it('should return jobs data in mock mode without requiring auth token', async () => {
      const res = await request(app).get('/api/jobs');

      // In mock mode, this should return 200 with jobs array
      // NOT 401 "No authorization token provided"
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('jobs');
      expect(Array.isArray(res.body.jobs)).toBe(true);

      // Verify we got mock data
      if (res.body.jobs.length > 0) {
        const job = res.body.jobs[0];
        expect(job).toHaveProperty('id');
        expect(job).toHaveProperty('title');
        expect(job).toHaveProperty('company');
        expect(job).toHaveProperty('description');
      }
    });

    it('should return mock jobs with expected structure', async () => {
      const res = await request(app).get('/api/jobs');

      expect(res.status).toBe(200);
      expect(res.body.jobs.length).toBeGreaterThan(0);

      const job = res.body.jobs[0];
      // Verify all required fields are present
      expect(job).toHaveProperty('id');
      expect(job).toHaveProperty('title');
      expect(job).toHaveProperty('company');
      expect(job).toHaveProperty('description');
      expect(job).toHaveProperty('status');
      expect(job).toHaveProperty('recruiter_id');
    });

    it('should include pagination info', async () => {
      const res = await request(app).get('/api/jobs');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('limit');
      expect(res.body).toHaveProperty('offset');
    });

    it('should support status filter in mock mode', async () => {
      const res = await request(app)
        .get('/api/jobs')
        .query({ status: 'active' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('jobs');
    });
  });

  /**
   * This test checks that the Candidates API works in mock mode.
   * Uses optionalSupabaseAuth, but still needs mock data to be returned.
   */
  describe('Candidates API - Mock Mode', () => {
    it('should return candidates data in mock mode', async () => {
      const res = await request(app).get('/api/candidates');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('candidates');
      expect(Array.isArray(res.body.candidates)).toBe(true);

      // Verify we got mock data
      if (res.body.candidates.length > 0) {
        const candidate = res.body.candidates[0];
        expect(candidate).toHaveProperty('id');
        expect(candidate).toHaveProperty('name');
        expect(candidate).toHaveProperty('email');
      }
    });

    it('should return mock candidates with expected structure', async () => {
      const res = await request(app).get('/api/candidates');

      expect(res.status).toBe(200);
      expect(res.body.candidates.length).toBeGreaterThan(0);

      const candidate = res.body.candidates[0];
      expect(candidate).toHaveProperty('id');
      expect(candidate).toHaveProperty('name');
      expect(candidate).toHaveProperty('email');
      expect(candidate).toHaveProperty('title');
      expect(candidate).toHaveProperty('skills');
      expect(candidate).toHaveProperty('status');
    });

    it('should include pagination info', async () => {
      const res = await request(app).get('/api/candidates');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.pagination).toHaveProperty('total');
      expect(res.body.pagination).toHaveProperty('page');
      expect(res.body.pagination).toHaveProperty('limit');
    });

    it('should support search filter in mock mode', async () => {
      const res = await request(app)
        .get('/api/candidates')
        .query({ search: 'Smith' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('candidates');
    });

    it('should support source filter in mock mode', async () => {
      const res = await request(app)
        .get('/api/candidates')
        .query({ source: 'LinkedIn' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('candidates');
    });
  });

  /**
   * Talent Pool API - Mock Mode
   * This test checks that the Talent Pool page works in mock mode.
   */
  describe('Talent Pool API - Mock Mode', () => {
    it('should return talent candidates in mock mode', async () => {
      const res = await request(app).get('/api/talent');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('candidates');
      expect(Array.isArray(res.body.candidates)).toBe(true);
      expect(res.body.candidates.length).toBeGreaterThan(0);
    });

    it('should return talent candidates with expected structure', async () => {
      const res = await request(app).get('/api/talent');

      expect(res.status).toBe(200);
      const candidate = res.body.candidates[0];
      expect(candidate).toHaveProperty('id');
      expect(candidate).toHaveProperty('full_name');
      expect(candidate).toHaveProperty('email');
      expect(candidate).toHaveProperty('skills');
      expect(candidate).toHaveProperty('recruiterStatus');
    });

    it('should include pagination info', async () => {
      const res = await request(app).get('/api/talent');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('currentPage');
      expect(res.body).toHaveProperty('totalPages');
      expect(res.body).toHaveProperty('totalCandidates');
    });

    it('should support search filter', async () => {
      const res = await request(app)
        .get('/api/talent')
        .query({ search: 'Sarah' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('candidates');
    });

    it('should support status filter', async () => {
      const res = await request(app)
        .get('/api/talent')
        .query({ status: 'shortlisted' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('candidates');
    });
  });

  /**
   * Combined API health check for mock mode
   * Ensures all critical APIs work together
   */
  describe('Combined Mock Mode Health', () => {
    it('all three APIs should work simultaneously', async () => {
      const [jobsRes, candidatesRes, talentRes] = await Promise.all([
        request(app).get('/api/jobs'),
        request(app).get('/api/candidates'),
        request(app).get('/api/talent')
      ]);

      expect(jobsRes.status).toBe(200);
      expect(candidatesRes.status).toBe(200);
      expect(talentRes.status).toBe(200);

      expect(jobsRes.body.jobs.length).toBeGreaterThan(0);
      expect(candidatesRes.body.candidates.length).toBeGreaterThan(0);
      expect(talentRes.body.candidates.length).toBeGreaterThan(0);
    });
  });
});
