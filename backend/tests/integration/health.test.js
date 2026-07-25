/**
 * Health & Core Endpoint Tests
 * Tests basic server functionality and CORS
 */

const request = require('supertest');

const app = require('../../src/app');

describe('Health & Core Endpoints', () => {
  describe('GET /health', () => {
    it('should return 200 with status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
    });

    it('should respond within 500ms', async () => {
      const start = Date.now();
      await request(app).get('/health');
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500);
    });
  });

  describe('CORS Configuration', () => {
    it('should allow requests from localhost:3000', async () => {
      const res = await request(app)
        .get('/cors-test')
        .set('Origin', 'http://localhost:3000');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });

    it('should allow requests from production domain', async () => {
      const res = await request(app)
        .get('/cors-test')
        .set('Origin', 'https://touchstones.ai');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://touchstones.ai');
    });

    it('should handle OPTIONS preflight requests', async () => {
      const res = await request(app)
        .options('/api/jobs')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET');

      expect([200, 204]).toContain(res.status);
    });
  });

  describe('404 Handling', () => {
    it('should return 404 for non-existent routes', async () => {
      const res = await request(app).get('/api/nonexistent-route');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('message');
    });

    it('should return JSON for 404 errors', async () => {
      const res = await request(app).get('/api/nonexistent-route');
      expect(res.type).toBe('application/json');
    });
  });

  describe('Content-Type Handling', () => {
    it('should accept JSON content type', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send({ email: 'test@test.com', password: 'test' });

      // Will fail auth but should process JSON
      expect(res.type).toBe('application/json');
    });
  });
});
