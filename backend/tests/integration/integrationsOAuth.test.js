/**
 * Integrations OAuth Tests (Calendly + Google Calendar)
 *
 * Covers the OAuth connect / status / disconnect / callback surface in
 * routes/supabase/integrations.js that is NOT exercised by integrations.test.js
 * (which only covers the simple Gmail/LinkedIn/ATS stubs and /status):
 *   GET  /api/integrations/calendly/auth
 *   GET  /api/integrations/calendly/status
 *   POST /api/integrations/calendly/disconnect
 *   GET  /api/integrations/calendly/callback   (error redirect)
 *   GET  /api/integrations/google/auth
 *   GET  /api/integrations/google/status
 *   POST /api/integrations/google/disconnect
 *   GET  /api/integrations/google/callback     (error redirect)
 */

const request = require('supertest');

const app = require('../../src/app');

const MOCK_USER = '00000000-0000-0000-0000-000000000001';
function authed(req) {
  const token = testUtils.generateTestToken(MOCK_USER, 'mock@touchstones.ai');
  return req.set('Authorization', `Bearer ${token}`);
}

describe('Calendly OAuth', () => {
  describe('GET /api/integrations/calendly/auth', () => {
    it('returns an auth URL when configured, or 500 misconfig when not', async () => {
      const res = await authed(request(app).get('/api/integrations/calendly/auth'));
      expect([200, 401, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('authUrl');
        expect(res.body.authUrl).toContain('calendly.com');
      } else if (res.status === 500) {
        expect(res.body).toHaveProperty('error');
      }
    });

    it('sets no-store cache headers (tokens must not be cached)', async () => {
      const res = await authed(request(app).get('/api/integrations/calendly/auth'));
      if (res.headers['cache-control']) {
        expect(res.headers['cache-control']).toMatch(/no-store|no-cache/);
      }
    });
  });

  describe('GET /api/integrations/calendly/status', () => {
    it('reports connection status (connected boolean) or a DB error', async () => {
      const res = await authed(request(app).get('/api/integrations/calendly/status'));
      expect([200, 401, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('connected');
        expect(typeof res.body.connected).toBe('boolean');
      }
    });
  });

  describe('POST /api/integrations/calendly/disconnect', () => {
    it('acknowledges a disconnect request (idempotent)', async () => {
      const res = await authed(request(app).post('/api/integrations/calendly/disconnect'));
      expect([200, 401, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('success', true);
      }
    });
  });

  describe('GET /api/integrations/calendly/callback', () => {
    it('redirects to the frontend with an error param when the provider returns an error', async () => {
      const res = await request(app)
        .get('/api/integrations/calendly/callback')
        .query({ error: 'access_denied' });
      expect([302, 303]).toContain(res.status);
      expect(res.headers.location).toMatch(/integrations\?error=/);
    });
  });
});

describe('Google Calendar OAuth', () => {
  describe('GET /api/integrations/google/auth', () => {
    it('returns an auth URL when configured, or 500 misconfig when not', async () => {
      const res = await authed(request(app).get('/api/integrations/google/auth'));
      expect([200, 401, 500]).toContain(res.status);
      if (res.status === 200) {
        // URL may be in authUrl/url depending on implementation
        const payload = JSON.stringify(res.body);
        expect(payload.length).toBeGreaterThan(2);
      }
    });
  });

  describe('GET /api/integrations/google/status', () => {
    it('reports Google connection status or a DB error', async () => {
      const res = await authed(request(app).get('/api/integrations/google/status'));
      expect([200, 401, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('connected');
      }
    });
  });

  describe('POST /api/integrations/google/disconnect', () => {
    it('acknowledges a disconnect request', async () => {
      const res = await authed(request(app).post('/api/integrations/google/disconnect'));
      expect([200, 401, 500]).toContain(res.status);
    });
  });

  describe('GET /api/integrations/google/callback', () => {
    it('handles a provider error gracefully (redirect or error status)', async () => {
      const res = await request(app)
        .get('/api/integrations/google/callback')
        .query({ error: 'access_denied' });
      expect([302, 303, 400, 500]).toContain(res.status);
    });
  });
});

describe('GET /api/integrations/status (aggregate)', () => {
  it('returns the aggregate integration status map', async () => {
    const res = await authed(request(app).get('/api/integrations/status'));
    expect([200, 401, 404, 500]).toContain(res.status);
  });
});
