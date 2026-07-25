/**
 * /api/analytics/insights/* — the v3 Analytics & ROI surface (CI-safe, NO live DB).
 * ---------------------------------------------------------------------------------
 * Mocked deterministically:
 *   - ../../src/config/supabase     → an in-memory store + a chainable query builder
 *                                     (select/eq/neq/in/gte, awaitable → { data, error }).
 *   - ../../src/middleware/supabaseAuth → injects req.user = { id, supabase } from a header.
 * The REAL analytics router + REAL analyticsService aggregates run.
 *
 * Asserts:
 *   1. funnel/roi are REAL aggregates of seeded rows for the requesting account.
 *   2. ACCOUNT-SCOPING / no-cross-tenant: account A's funnel + ROI never include
 *      account B's submissions (the owner_id gate on work_samples).
 *   3. ROI recomputes from query-supplied (editable) assumptions; a brand-new
 *      account degrades to honest empty / insufficient_data.
 */

require('../../src/polyfill');
const express = require('express');
const request = require('supertest');

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; // brand-new account (no data)

jest.mock('../../src/config/supabase', () => {
  const store = {
    work_samples: [],
    work_sample_submissions: [],
    proof_scores: [],
    submission_outcomes: [],
  };
  const makeClient = () => ({
    from(table) {
      const q = { _f: [] };
      q.select = () => q;
      q.eq = (c, v) => { q._f.push((r) => r[c] === v); return q; };
      q.neq = (c, v) => { q._f.push((r) => r[c] !== v); return q; };
      q.in = (c, arr) => { q._f.push((r) => arr.includes(r[c])); return q; };
      q.gte = (c, v) => { q._f.push((r) => r[c] != null && r[c] >= v); return q; };
      q.then = (resolve, reject) => {
        let out;
        try {
          const rows = (store[table] || []).filter((r) => q._f.every((f) => f(r)));
          out = { data: rows, error: null };
        } catch (e) {
          out = { data: null, error: { message: e.message } };
        }
        return Promise.resolve(out).then(resolve, reject);
      };
      return q;
    },
  });
  const client = makeClient();
  return { supabaseAdmin: client, supabase: client, createAuthenticatedClient: () => client, __store: store };
});

jest.mock('../../src/middleware/supabaseAuth', () => {
  const { supabase } = require('../../src/config/supabase');
  return {
    supabaseAuth: (req, res, next) => {
      req.user = { id: req.header('x-test-user') || 'anon', supabase };
      next();
    },
  };
});

const { __store } = require('../../src/config/supabase');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', require('../../src/routes/supabase/analytics'));
  return app;
}

function seed() {
  const now = new Date().toISOString();
  __store.work_samples.push(
    { id: 'wA', owner_id: A, role_family: 'backend', title: 'A screen', status: 'published' },
    { id: 'wB', owner_id: B, role_family: 'backend', title: 'B screen', status: 'published' },
  );
  __store.work_sample_submissions.push(
    { id: 'aA1', work_sample_id: 'wA', started_at: now, submitted_at: now, status: 'scored', created_at: now },
    { id: 'aA2', work_sample_id: 'wA', started_at: now, submitted_at: now, status: 'submitted', created_at: now },
    { id: 'bB1', work_sample_id: 'wB', started_at: now, submitted_at: now, status: 'scored', created_at: now },
  );
  __store.proof_scores.push(
    { submission_id: 'aA1', normalized_score: 88, outcome: 'advance', created_at: now, superseded_by: null },
    { submission_id: 'bB1', normalized_score: 91, outcome: 'advance', created_at: now, superseded_by: null },
  );
  __store.submission_outcomes.push(
    { submission_id: 'aA1', advanced: true, got_offer: true, hired: true, retained_90d: null, labeled_at: now },
    { submission_id: 'bB1', advanced: true, got_offer: true, hired: true, retained_90d: true, labeled_at: now },
  );
}

beforeEach(() => {
  for (const k of Object.keys(__store)) __store[k].length = 0;
  seed();
});

const app = buildApp();
const asUser = (id, path) => request(app).get(path).set('x-test-user', id);

describe('GET /insights/funnel — real aggregate, account-scoped', () => {
  it("returns account A's own funnel (2 submissions, 1 scored, 1 advanced)", async () => {
    const res = await asUser(A, '/api/analytics/insights/funnel');
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.stages.map((s) => [s.key, s.count]));
    expect(by.created).toBe(2); // aA1, aA2
    expect(by.submitted).toBe(2);
    expect(by.scored).toBe(1); // only aA1 has a live score
    expect(by.advanced).toBe(1); // only aA1 advanced
    expect(res.body.total).toBe(2);
  });

  it("does NOT leak account B's submission into account A's funnel", async () => {
    const res = await asUser(A, '/api/analytics/insights/funnel');
    expect(res.body.total).toBe(2); // would be 3 if B's bB1 leaked
    const resB = await asUser(B, '/api/analytics/insights/funnel');
    expect(resB.body.total).toBe(1); // B sees only its own
  });
});

describe('GET /insights/roi — recomputes from editable assumptions × real counts', () => {
  it('multiplies the query-supplied inputs by account A counts', async () => {
    const res = await asUser(A, '/api/analytics/insights/roi?hoursPerOnsite=5&hourlyCost=200');
    expect(res.status).toBe(200);
    expect(res.body.inputs).toEqual({ hoursPerOnsite: 5, hourlyCost: 200 });
    // A: completed=2 → onsites_avoided=2 → hours_saved=10, dollars=2000
    expect(res.body.counts.completed).toBe(2);
    expect(res.body.results.onsites_avoided).toBe(2);
    expect(res.body.results.hours_saved).toBe(10);
    expect(res.body.results.dollars_saved).toBe(2000);
  });

  it('changing an input changes the served output', async () => {
    const a = await asUser(A, '/api/analytics/insights/roi?hoursPerOnsite=4&hourlyCost=150');
    const b = await asUser(A, '/api/analytics/insights/roi?hoursPerOnsite=8&hourlyCost=150');
    expect(b.body.results.hours_saved).not.toBe(a.body.results.hours_saved);
    expect(b.body.results.hours_saved).toBe(16); // completed(2) * 8
  });

  it("ROI is account-scoped (A's counts exclude B)", async () => {
    const res = await asUser(A, '/api/analytics/insights/roi');
    expect(res.body.counts.completed).toBe(2); // not 3
  });

  it('a brand-new account degrades to honest empty / insufficient_data', async () => {
    const res = await asUser(C, '/api/analytics/insights/roi');
    expect(res.status).toBe(200);
    expect(res.body.insufficient_data).toBe(true);
    expect(res.body.counts.completed).toBe(0);
    expect(res.body.results.dollars_saved).toBe(0);
    expect(res.body.results.cost_per_qualified).toBeNull();

    const funnel = await asUser(C, '/api/analytics/insights/funnel');
    expect(funnel.body.empty).toBe(true);
    expect(funnel.body.total).toBe(0);
  });
});

describe('GET /insights/throughput + /insights/roles — scoped', () => {
  it('throughput returns the requester rows only', async () => {
    const res = await asUser(A, '/api/analytics/insights/throughput');
    expect(res.status).toBe(200);
    expect(res.body.counts.total).toBe(2);
  });
  it('roles lists the account role families', async () => {
    const res = await asUser(A, '/api/analytics/insights/roles');
    expect(res.status).toBe(200);
    expect(res.body.roles).toContain('backend');
    expect(res.body.screens_total).toBe(1);
  });
});
