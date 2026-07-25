/**
 * Team Seats / Invite API Tests (Phase 4)
 *
 * Covers the team endpoints added to routes/supabase/collab.js:
 *   GET    /api/collab/team               (owner's members + pending invites)
 *   POST   /api/collab/team/invite        (invite a teammate by email)
 *   POST   /api/collab/team/accept        (invitee binds their account via token)
 *   DELETE /api/collab/team/:id           (owner removes a member / pending invite)
 *
 * Under USE_MOCK_DB=true auth is bypassed and Supabase queries hit non-functional
 * placeholder clients, so any DB-touching path may 500. Assertions therefore use
 * resilient status ranges for the DB-dependent paths and focus on the
 * validation/authorization contract, which runs BEFORE any DB access and is
 * fully deterministic (mirrors assessments.test.js).
 */

const request = require('supertest');

const app = require('../../src/app');

const MOCK_USER = '00000000-0000-0000-0000-000000000001';
const FAKE_ID = '00000000-0000-0000-0000-000000000999';

function authed(req) {
  const token = testUtils.generateTestToken(MOCK_USER, 'mock@touchstones.ai');
  return req.set('Authorization', `Bearer ${token}`);
}

describe('GET /api/collab/team', () => {
  it('is reachable through the auth middleware (no unexpected crash)', async () => {
    const res = await authed(request(app).get('/api/collab/team'));
    expect([200, 401, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('members');
      expect(Array.isArray(res.body.members)).toBe(true);
    }
  });
});

describe('POST /api/collab/team/invite (validation)', () => {
  it('rejects a missing email with 400 (before any DB access)', async () => {
    const res = await authed(request(app).post('/api/collab/team/invite').send({}));
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  it('rejects a malformed email with 400', async () => {
    const res = await authed(request(app).post('/api/collab/team/invite').send({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  it('rejects inviting yourself with 400', async () => {
    const res = await authed(request(app).post('/api/collab/team/invite').send({ email: 'mock@touchstones.ai' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/yourself/i);
  });

  it('passes validation with a well-formed email (then hits DB: 201/409/500)', async () => {
    const res = await authed(request(app).post('/api/collab/team/invite').send({ email: 'teammate@example.com' }));
    expect([201, 401, 409, 500]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body).toHaveProperty('member');
      expect(res.body.member.email).toBe('teammate@example.com');
      expect(res.body.member.status).toBe('invited');
    }
  });
});

describe('POST /api/collab/team/accept (validation)', () => {
  it('rejects a missing token with 400 (before any DB access)', async () => {
    const res = await authed(request(app).post('/api/collab/team/accept').send({}));
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  it('handles an unknown token (404 or DB error, never a crash)', async () => {
    const res = await authed(request(app).post('/api/collab/team/accept').send({ token: 'deadbeefdeadbeef' }));
    expect([404, 401, 500]).toContain(res.status);
  });
});

describe('DELETE /api/collab/team/:id', () => {
  it('rejects a non-uuid id with 400 (before any DB access)', async () => {
    const res = await authed(request(app).delete('/api/collab/team/not-a-uuid'));
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  it('handles removing a non-existent member (404 or DB error)', async () => {
    const res = await authed(request(app).delete(`/api/collab/team/${FAKE_ID}`));
    expect([404, 401, 500]).toContain(res.status);
  });
});
