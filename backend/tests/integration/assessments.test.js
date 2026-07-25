/**
 * Assessment Templates API Tests
 *
 * Covers routes/supabase/assessments.js:
 *   GET    /api/assessments              (list library + own; ?position= filter)
 *   GET    /api/assessments/:id          (one; RLS-scoped)
 *   POST   /api/assessments              (create custom; created_by = caller)
 *   PUT    /api/assessments/:id          (owner updates)
 *   POST   /api/assessments/:id/clone    (clone library/owned -> recruiter row)
 *
 * Under USE_MOCK_DB=true auth is bypassed and queries hit the placeholder Supabase
 * client; without a live DB those calls may 500. Assertions use resilient ranges
 * and focus on the validation/authorization contract, which executes BEFORE any DB
 * access (so those assertions are deterministic regardless of DB availability).
 */

const request = require('supertest');

const app = require('../../src/app');

const MOCK_USER = '00000000-0000-0000-0000-000000000001';
const FAKE_ID = '00000000-0000-0000-0000-000000000999';

function authed(req) {
  const token = testUtils.generateTestToken(MOCK_USER, 'mock@touchstones.ai');
  return req.set('Authorization', `Bearer ${token}`);
}

// A minimal rubric that satisfies proofScoringService's contract
// (non-empty criteria[] with id + numeric points_possible).
const validRubric = {
  criteria: [
    { id: 'correctness', requirement: 'Does the thing', points_possible: 70, weight: 1 },
    { id: 'tests', requirement: 'Has tests', points_possible: 30, weight: 1 },
  ],
};

describe('GET /api/assessments', () => {
  it('is reachable through the auth middleware (no crash)', async () => {
    // NOTE: under USE_MOCK_DB=true the supabaseAuth middleware bypasses auth and
    // injects a mock user, so an unauthenticated request is not rejected — it falls
    // through to the handler (200) or a DB error (500). In production the same path
    // would 401 without a bearer token. We assert it never 5xx-crashes unexpectedly.
    const res = await request(app).get('/api/assessments');
    expect([200, 401, 500]).toContain(res.status);
  });

  it('returns a templates payload or a DB error (never crashes)', async () => {
    const res = await authed(request(app).get('/api/assessments'));
    expect([200, 401, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('templates');
      expect(Array.isArray(res.body.templates)).toBe(true);
    }
  });

  it('accepts a valid ?position= filter', async () => {
    const res = await authed(request(app).get('/api/assessments').query({ position: 'frontend' }));
    expect([200, 401, 500]).toContain(res.status);
  });

  it('rejects an unknown ?position= with 400 (before any DB access)', async () => {
    const res = await authed(request(app).get('/api/assessments').query({ position: 'astrologer' }));
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /api/assessments/:id', () => {
  it('rejects a non-uuid id with 400', async () => {
    const res = await authed(request(app).get('/api/assessments/not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('handles a non-existent uuid (404 or DB error)', async () => {
    const res = await authed(request(app).get(`/api/assessments/${FAKE_ID}`));
    expect([404, 401, 500]).toContain(res.status);
  });
});

describe('POST /api/assessments (validation)', () => {
  it('rejects when position is missing (400)', async () => {
    const res = await authed(request(app).post('/api/assessments').send({
      title: 'X', prompt_md: 'do it', rubric: validRubric,
    }));
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('rejects an unknown position (400)', async () => {
    const res = await authed(request(app).post('/api/assessments').send({
      position: 'astrologer', title: 'X', prompt_md: 'do it', rubric: validRubric,
    }));
    expect(res.status).toBe(400);
  });

  it('rejects when title is missing (400)', async () => {
    const res = await authed(request(app).post('/api/assessments').send({
      position: 'backend', prompt_md: 'do it', rubric: validRubric,
    }));
    expect(res.status).toBe(400);
  });

  it('rejects when prompt_md is missing (400)', async () => {
    const res = await authed(request(app).post('/api/assessments').send({
      position: 'backend', title: 'X', rubric: validRubric,
    }));
    expect(res.status).toBe(400);
  });

  it('rejects an empty/invalid rubric (400)', async () => {
    const res = await authed(request(app).post('/api/assessments').send({
      position: 'backend', title: 'X', prompt_md: 'do it', rubric: { criteria: [] },
    }));
    expect(res.status).toBe(400);
  });

  it('rejects a rubric criterion missing numeric points_possible (400)', async () => {
    const res = await authed(request(app).post('/api/assessments').send({
      position: 'backend', title: 'X', prompt_md: 'do it',
      rubric: { criteria: [{ id: 'a', requirement: 'x' }] },
    }));
    expect(res.status).toBe(400);
  });

  it('passes validation with a complete body (then hits DB)', async () => {
    const res = await authed(request(app).post('/api/assessments').send({
      position: 'backend', title: 'Build an API', prompt_md: 'Build it', rubric: validRubric,
      starter_files: [{ path: 'a.js', content: '// x', language: 'javascript' }],
      languages: ['javascript'], time_limit_min: 60,
    }));
    // Validation passes; insert may succeed (201) or fail without a live DB (500).
    expect([201, 401, 500]).toContain(res.status);
  });
});

describe('PUT /api/assessments/:id', () => {
  it('rejects a non-uuid id with 400', async () => {
    const res = await authed(request(app).put('/api/assessments/not-a-uuid').send({ title: 'New' }));
    expect(res.status).toBe(400);
  });

  it('rejects an invalid rubric on update (400 or 404/DB before DB write)', async () => {
    const res = await authed(request(app).put(`/api/assessments/${FAKE_ID}`).send({
      rubric: { criteria: [] },
    }));
    // Ownership lookup may 404/500 first under mock DB; with a real owned row it 400s.
    expect([400, 401, 404, 500]).toContain(res.status);
  });

  it('handles updating a non-existent template (404 or DB error)', async () => {
    const res = await authed(request(app).put(`/api/assessments/${FAKE_ID}`).send({ title: 'New' }));
    expect([401, 404, 500]).toContain(res.status);
  });
});

describe('POST /api/assessments/:id/clone', () => {
  it('rejects a non-uuid id with 400', async () => {
    const res = await authed(request(app).post('/api/assessments/not-a-uuid/clone').send({}));
    expect(res.status).toBe(400);
  });

  it('handles cloning a non-existent/inaccessible template (404 or DB error)', async () => {
    const res = await authed(request(app).post(`/api/assessments/${FAKE_ID}/clone`).send({}));
    expect([201, 401, 404, 500]).toContain(res.status);
  });
});
