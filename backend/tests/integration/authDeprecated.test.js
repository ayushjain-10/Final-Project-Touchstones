/**
 * The legacy custom-JWT auth endpoints (/api/auth/register, /api/auth/login) are deprecated and
 * must return 410 Gone — the app authenticates via Supabase Auth, and these referenced columns
 * that no longer exist. This guards against accidentally re-enabling a broken path.
 */
jest.mock('../../src/config/supabase', () => ({
  supabase: { auth: {} },
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }) },
  createAuthenticatedClient: () => ({}),
}));
jest.mock('../../src/middleware/supabaseAuth', () => ({
  supabaseAuth: (req, res, next) => next(),
  optionalSupabaseAuth: (req, res, next) => next(),
}));
jest.mock('../../src/services/emailService', () => ({ sendEmail: async () => ({ skipped: true }) }));

const express = require('express');
const request = require('supertest');
const authRouter = require('../../src/routes/supabase/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

describe('deprecated legacy auth routes → 410 Gone', () => {
  test('POST /api/auth/register → 410', async () => {
    const r = await request(app).post('/api/auth/register').send({ email: 'x@y.com', password: 'abcdef' });
    expect(r.status).toBe(410);
    expect(r.body.error).toBe('Gone');
    expect(r.body.message).toMatch(/Supabase Auth/i);
  });

  test('POST /api/auth/login → 410', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'x@y.com', password: 'abcdef' });
    expect(r.status).toBe(410);
    expect(r.body.error).toBe('Gone');
  });
});
