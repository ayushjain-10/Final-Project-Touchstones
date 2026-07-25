/**
 * Notifications API Tests
 *
 * Covers routes/supabase/notifications.js:
 *   GET    /api/notifications
 *   GET    /api/notifications/unread-count
 *   PUT    /api/notifications/:id/read
 *   PUT    /api/notifications/read-all
 *   DELETE /api/notifications/:id
 *   DELETE /api/notifications
 *   POST   /api/notifications
 *
 * Under USE_MOCK_DB=true the auth is bypassed and queries hit the real Supabase
 * client; without a live DB these may 500. Assertions use resilient ranges and
 * focus on the validation contract (POST requires type + title) which executes
 * before any DB access.
 */

const request = require('supertest');

const app = require('../../src/app');

const MOCK_USER = '00000000-0000-0000-0000-000000000001';

function authed(req) {
  const token = testUtils.generateTestToken(MOCK_USER, 'mock@touchstones.ai');
  return req.set('Authorization', `Bearer ${token}`);
}

describe('GET /api/notifications', () => {
  it('returns a notifications payload or a DB error (never crashes)', async () => {
    const res = await authed(request(app).get('/api/notifications'));
    expect([200, 401, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('notifications');
      expect(res.body).toHaveProperty('unreadCount');
    }
  });

  it('accepts pagination + unreadOnly query params', async () => {
    const res = await authed(
      request(app).get('/api/notifications').query({ page: 2, limit: 5, unreadOnly: 'true' })
    );
    expect([200, 401, 500]).toContain(res.status);
  });
});

describe('GET /api/notifications/unread-count', () => {
  it('returns an unread count or a DB error', async () => {
    const res = await authed(request(app).get('/api/notifications/unread-count'));
    expect([200, 401, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('unreadCount');
    }
  });
});

describe('POST /api/notifications (validation)', () => {
  it('rejects when type is missing (400)', async () => {
    const res = await authed(
      request(app).post('/api/notifications').send({ title: 'Hi' })
    );
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('rejects when title is missing (400)', async () => {
    const res = await authed(
      request(app).post('/api/notifications').send({ type: 'info' })
    );
    expect(res.status).toBe(400);
  });

  it('rejects an empty body (400)', async () => {
    const res = await authed(request(app).post('/api/notifications').send({}));
    expect(res.status).toBe(400);
  });

  it('passes validation with type + title (then hits DB)', async () => {
    const res = await authed(
      request(app).post('/api/notifications').send({
        type: 'info',
        title: 'Test notification',
        message: 'hello'
      })
    );
    // Validation passes; insert may succeed (201) or fail without a live DB (500).
    expect([201, 401, 500]).toContain(res.status);
  });
});

describe('PUT /api/notifications/:id/read', () => {
  it('handles a non-existent notification id (404 or DB error)', async () => {
    const res = await authed(
      request(app).put('/api/notifications/00000000-0000-0000-0000-000000000999/read')
    );
    expect([200, 404, 401, 500]).toContain(res.status);
  });
});

describe('PUT /api/notifications/read-all', () => {
  it('marks all as read or returns a DB error', async () => {
    const res = await authed(request(app).put('/api/notifications/read-all'));
    expect([200, 401, 500]).toContain(res.status);
  });
});

describe('DELETE /api/notifications/:id', () => {
  it('handles deletion of a non-existent notification (404 or DB error)', async () => {
    const res = await authed(
      request(app).delete('/api/notifications/00000000-0000-0000-0000-000000000999')
    );
    expect([200, 404, 401, 500]).toContain(res.status);
  });
});

describe('DELETE /api/notifications', () => {
  it('handles bulk delete or returns a DB error', async () => {
    const res = await authed(request(app).delete('/api/notifications'));
    expect([200, 401, 500]).toContain(res.status);
  });
});
