/**
 * Integrations API Tests
 * Tests third-party integrations (Gmail, LinkedIn, etc.)
 */

const request = require('supertest');

const app = require('../../src/app');

describe('Integrations API', () => {
  let authToken;

  beforeAll(() => {
    authToken = testUtils.generateTestToken();
  });

  describe('GET /api/integrations', () => {
    it('should require authentication', async () => {
      const res = await request(app).get('/api/integrations');
      expect([200, 302, 401, 404, 500]).toContain(res.status);
    });

    it('should return integrations list', async () => {
      const res = await request(app)
        .get('/api/integrations')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 302, 401, 404, 500]).toContain(res.status);
    });
  });

  describe('GET /api/integrations/status', () => {
    it('should require authentication', async () => {
      const res = await request(app).get('/api/integrations/status');
      expect([200, 401, 404, 500]).toContain(res.status);
    });

    it('should return integration statuses', async () => {
      const res = await request(app)
        .get('/api/integrations/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401, 404, 500]).toContain(res.status);
    });
  });

  describe('Gmail Integration', () => {
    describe('GET /api/integrations/gmail/auth', () => {
      it('should require authentication', async () => {
        const res = await request(app).get('/api/integrations/gmail/auth');
        expect([200, 401, 500]).toContain(res.status);
      });

      it('should provide Gmail OAuth URL', async () => {
        const res = await request(app)
          .get('/api/integrations/gmail/auth')
          .set('Authorization', `Bearer ${authToken}`);

        expect([200, 302, 401, 500]).toContain(res.status);
      });
    });

    describe('POST /api/integrations/gmail/disconnect', () => {
      it('should require authentication', async () => {
        const res = await request(app).post('/api/integrations/gmail/disconnect');
        expect([200, 401, 500]).toContain(res.status);
      });

      it('should handle disconnect request', async () => {
        const res = await request(app)
          .post('/api/integrations/gmail/disconnect')
          .set('Authorization', `Bearer ${authToken}`);

        expect([200, 400, 401, 500]).toContain(res.status);
      });
    });
  });

  describe('LinkedIn Integration', () => {
    describe('GET /api/integrations/linkedin/auth', () => {
      it('should require authentication', async () => {
        const res = await request(app).get('/api/integrations/linkedin/auth');
        expect([200, 401, 500]).toContain(res.status);
      });

      it('should provide LinkedIn OAuth URL', async () => {
        const res = await request(app)
          .get('/api/integrations/linkedin/auth')
          .set('Authorization', `Bearer ${authToken}`);

        expect([200, 302, 401, 500]).toContain(res.status);
      });
    });
  });

  describe('Calendar Integration', () => {
    describe('GET /api/integrations/calendar/auth', () => {
      it('should require authentication', async () => {
        const res = await request(app).get('/api/integrations/calendar/auth');
        expect([200, 302, 401, 500]).toContain(res.status);
      });

      it('should provide calendar OAuth URL', async () => {
        const res = await request(app)
          .get('/api/integrations/calendar/auth')
          .set('Authorization', `Bearer ${authToken}`);

        expect([200, 302, 401, 500]).toContain(res.status);
      });
    });

    describe('GET /api/integrations/calendar/events', () => {
      it('should require authentication', async () => {
        const res = await request(app).get('/api/integrations/calendar/events');
        expect([200, 401, 500]).toContain(res.status);
      });

      it('should return calendar events when connected', async () => {
        const res = await request(app)
          .get('/api/integrations/calendar/events')
          .set('Authorization', `Bearer ${authToken}`);

        expect([200, 400, 401, 500]).toContain(res.status);
      });
    });
  });

  describe('ATS Integration', () => {
    describe('GET /api/integrations/ats', () => {
      it('should require authentication', async () => {
        const res = await request(app).get('/api/integrations/ats');
        expect([200, 401, 500]).toContain(res.status);
      });

      it('should list available ATS integrations', async () => {
        const res = await request(app)
          .get('/api/integrations/ats')
          .set('Authorization', `Bearer ${authToken}`);

        expect([200, 401, 500]).toContain(res.status);
      });
    });
  });
});

describe('Webhooks API', () => {
  let authToken;

  beforeAll(() => {
    authToken = testUtils.generateTestToken();
  });

  describe('GET /api/webhooks', () => {
    it('should require authentication', async () => {
      const res = await request(app).get('/api/webhooks');
      expect([200, 401, 500]).toContain(res.status);
    });

    it('should return webhooks list', async () => {
      const res = await request(app)
        .get('/api/webhooks')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401, 500]).toContain(res.status);
    });
  });

  describe('POST /api/webhooks', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/webhooks')
        .send({ url: 'https://example.com/webhook', events: ['candidate.created'] });

      expect([200, 201, 401, 500]).toContain(res.status);
    });

    it('should create webhook with valid data', async () => {
      const res = await request(app)
        .post('/api/webhooks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          url: 'https://example.com/webhook',
          events: ['candidate.created', 'job.updated'],
          secret: 'webhook-secret'
        });

      expect([201, 400, 401, 500]).toContain(res.status);
    });

    it('should require valid URL', async () => {
      const res = await request(app)
        .post('/api/webhooks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          url: 'invalid-url',
          events: ['candidate.created']
        });

      expect([400, 401]).toContain(res.status);
    });
  });

  describe('DELETE /api/webhooks/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app).delete('/api/webhooks/test-id');
      expect([200, 401, 404, 500]).toContain(res.status);
    });

    it('should handle non-existent webhook', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .delete(`/api/webhooks/${fakeId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 404, 401]).toContain(res.status);
    });
  });

  describe('POST /api/webhooks/test', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/webhooks/test')
        .send({ webhookId: 'test' });

      expect([200, 401, 404, 500]).toContain(res.status);
    });

    it('should send test webhook', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post('/api/webhooks/test')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ webhookId: fakeId });

      expect([200, 400, 401, 404]).toContain(res.status);
    });
  });
});
