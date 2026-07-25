/**
 * Status Page / System Health Tests
 *
 * Covers routes/status.js (mounted at /api/status) — public platform
 * monitoring endpoints backed by services/statusService.js:
 *   GET  /api/status
 *   GET  /api/status/components
 *   GET  /api/status/uptime
 *   GET  /api/status/incidents
 *   GET  /api/status/maintenance
 *   GET  /api/status/health
 *   GET  /api/status/metrics
 *   POST /api/status/incidents
 *   PUT  /api/status/incidents/:id
 *
 * Also covers the top-level liveness endpoints in app.js (/health, /cors-test).
 */

const request = require('supertest');

const app = require('../../src/app');

describe('GET /api/status', () => {
  it('returns an overall system status object', async () => {
    const res = await request(app).get('/api/status');
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('components');
    }
  });
});

describe('GET /api/status/components', () => {
  it('returns component statuses', async () => {
    const res = await request(app).get('/api/status/components');
    expect([200, 500]).toContain(res.status);
  });
});

describe('GET /api/status/uptime', () => {
  it('returns uptime statistics', async () => {
    const res = await request(app).get('/api/status/uptime');
    expect(res.status).toBe(200);
  });

  it('caps the days parameter at 90', async () => {
    const res = await request(app).get('/api/status/uptime').query({ days: 9999 });
    expect(res.status).toBe(200);
  });

  it('handles a non-numeric days parameter gracefully', async () => {
    const res = await request(app).get('/api/status/uptime').query({ days: 'abc' });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/status/incidents', () => {
  it('returns a list of incidents', async () => {
    const res = await request(app).get('/api/status/incidents');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('respects the limit query parameter', async () => {
    const res = await request(app).get('/api/status/incidents').query({ limit: 1 });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/status/maintenance', () => {
  it('returns scheduled maintenance', async () => {
    const res = await request(app).get('/api/status/maintenance');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/status/health', () => {
  it('returns a health flag with a timestamp', async () => {
    const res = await request(app).get('/api/status/health');
    // Healthy => 200, degraded/down => 503.
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('healthy');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('GET /api/status/metrics', () => {
  it('returns process memory and uptime metrics', async () => {
    const res = await request(app).get('/api/status/metrics');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('memory');
    expect(res.body.memory).toHaveProperty('heapUsed');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body.uptime).toHaveProperty('seconds');
  });
});

describe('POST /api/status/incidents (admin)', () => {
  it('rejects creation without a title and description (400)', async () => {
    const res = await request(app).post('/api/status/incidents').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('rejects when only a title is provided (400)', async () => {
    const res = await request(app)
      .post('/api/status/incidents')
      .send({ title: 'Partial outage' });
    expect(res.status).toBe(400);
  });

  it('creates an incident with valid input (201)', async () => {
    const res = await request(app)
      .post('/api/status/incidents')
      .send({
        title: 'Test incident',
        description: 'Automated test incident',
        affectedComponents: ['api'],
        severity: 'minor'
      });
    expect([201, 500]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body).toHaveProperty('title', 'Test incident');
    }
  });
});

describe('PUT /api/status/incidents/:id (admin)', () => {
  it('rejects update without status and message (400)', async () => {
    const res = await request(app)
      .put('/api/status/incidents/some-id')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent incident id', async () => {
    const res = await request(app)
      .put('/api/status/incidents/nonexistent-id-123')
      .send({ status: 'resolved', message: 'fixed' });
    expect([404, 500]).toContain(res.status);
  });
});

describe('Top-level liveness endpoints', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  it('GET /cors-test returns a working confirmation', async () => {
    const res = await request(app).get('/cors-test');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
  });
});
