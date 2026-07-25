/**
 * Phase 2 billing enforcement — verified-screen gate at SEND time.
 *
 * Covers routes/supabase/proof.js:
 *   POST /api/proof/work-samples/:id/assign   (recruiter sends a screen)
 *   POST /api/proof/work-samples/:id/invite   (recruiter sends a screen by email)
 *
 * Both must 402 once the recruiter is at/over their monthly verified-screen cap,
 * and proceed normally when under it.
 *
 * Env-independent / deterministic → runs in CI. We mock:
 *   - the planLimits service (so usage is forced at/under limit without a DB),
 *   - supabaseAuth (injects a fixed recruiter user with a chainable supabase fake),
 *   - the supabase config (admin client used for the submission insert),
 *   - emailService (invite path must not actually send mail),
 * then mount the real proof router so the REAL gate code runs.
 */

const express = require('express');
const request = require('supertest');

const OWNER = '00000000-0000-0000-0000-000000000001';
const WS_ID = '11111111-1111-1111-1111-111111111111';
const CAND_ID = '22222222-2222-2222-2222-222222222222';

// ---- mock the metering service: each test sets the forced usage ----
const mockGetScreenUsage = jest.fn();
jest.mock('../../src/services/planLimits', () => ({
  getScreenUsage: (...args) => mockGetScreenUsage(...args),
}));

// ---- mock email so /invite never sends ----
jest.mock('../../src/services/emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue({ ok: true }),
}));

// ---- mock auth: inject the recruiter + a work-sample-owning RLS client ----
// The token-scoped client is attached HERE (not app-side) because the real proof
// router calls router.use(supabaseAuth) internally, which would otherwise clobber
// any client we patched onto req.user upstream.
jest.mock('../../src/middleware/supabaseAuth', () => {
  const WS = '11111111-1111-1111-1111-111111111111';
  const wsFake = {
    from(table) {
      const q = {};
      q.select = () => q;
      q.eq = () => q;
      q.single = async () => {
        if (table === 'work_samples') {
          return { data: { id: WS, title: 'Screen', owner_id: '00000000-0000-0000-0000-000000000001', duration_minutes: 60, job_id: null }, error: null };
        }
        if (table === 'profiles') {
          return { data: { first_name: 'Rec', last_name: 'Ruiter', company: 'Acme' }, error: null };
        }
        return { data: null, error: { code: 'PGRST116' } };
      };
      return q;
    },
  };
  return {
    supabaseAuth: (req, _res, next) => {
      req.user = { id: '00000000-0000-0000-0000-000000000001', email: 'rec@acme.test', supabase: wsFake };
      next();
    },
  };
});

// ---- mock the admin client used for the submission insert on /assign ----
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from() {
      const q = {};
      q.insert = () => ({ select: () => ({ single: async () => ({ data: { id: 'sub-1', status: 'assigned' }, error: null }) }) });
      q.select = () => q;
      q.eq = () => q;
      q.order = () => q;
      // idempotency pre-check on /assign: no existing submission for this (screen, candidate)
      q.limit = () => Promise.resolve({ data: [], error: null });
      q.single = async () => ({ data: null, error: { code: 'PGRST116' } });
      return q;
    },
  },
}));

// Build a minimal app that mounts the REAL proof router (so the real gate runs).
// The router applies the mocked supabaseAuth itself via router.use(...).
const proofRouter = require('../../src/routes/supabase/proof');

const app = express();
app.use(express.json());
app.use('/api/proof', proofRouter);

beforeEach(() => {
  process.env.FRONTEND_URL = 'https://app.test';
  mockGetScreenUsage.mockReset();
});

describe('POST /work-samples/:id/assign — verified-screen gate', () => {
  it('returns 402 with the upgrade payload when at the free limit', async () => {
    mockGetScreenUsage.mockResolvedValue({ plan: 'free', limit: 5, used: 5, remaining: 0 });
    const res = await request(app)
      .post(`/api/proof/work-samples/${WS_ID}/assign`)
      .send({ candidate_id: CAND_ID });

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ upgrade: true, plan: 'free', limit: 5, used: 5 });
    expect(res.body.error).toMatch(/5 verified screens this month/i);
  });

  it('proceeds (201) when under the limit', async () => {
    mockGetScreenUsage.mockResolvedValue({ plan: 'free', limit: 5, used: 2, remaining: 3 });
    const res = await request(app)
      .post(`/api/proof/work-samples/${WS_ID}/assign`)
      .send({ candidate_id: CAND_ID });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id', 'sub-1');
  });

  it('proceeds for an unlimited (growth) plan even at high usage', async () => {
    mockGetScreenUsage.mockResolvedValue({ plan: 'growth', limit: Infinity, used: 999, remaining: Infinity });
    const res = await request(app)
      .post(`/api/proof/work-samples/${WS_ID}/assign`)
      .send({ candidate_id: CAND_ID });

    expect(res.status).toBe(201);
  });
});

describe('POST /work-samples/:id/invite — verified-screen gate', () => {
  it('returns 402 when at the limit (and does not send the invite)', async () => {
    mockGetScreenUsage.mockResolvedValue({ plan: 'free', limit: 5, used: 5, remaining: 0 });
    const res = await request(app)
      .post(`/api/proof/work-samples/${WS_ID}/invite`)
      .send({ email: 'candidate@example.com' });

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ upgrade: true, plan: 'free', limit: 5, used: 5 });
  });

  it('proceeds (200 with a link) when under the limit', async () => {
    mockGetScreenUsage.mockResolvedValue({ plan: 'startup', limit: 50, used: 10, remaining: 40 });
    const res = await request(app)
      .post(`/api/proof/work-samples/${WS_ID}/invite`)
      .send({ email: 'candidate@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('link');
  });
});
