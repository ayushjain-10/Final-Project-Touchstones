/**
 * Ashby Assessments partner integration — service + inbound-auth tests.
 *
 * Deterministic / env-independent: we mock the supabase client (a tiny chainable fake backed by an
 * in-memory store), the candidate-provisioning + trust-signal services, the SSRF guard, and global
 * fetch (so the outbound assessment.update never leaves the process). Then we exercise the REAL
 * ashbyAssessmentService + the REAL partner router, asserting the exact Ashby contract shapes.
 */
const express = require('express');
const request = require('supertest');

process.env.ASHBY_ENC_KEY = 'a'.repeat(64); // 32-byte hex → deterministic cryptoVault key
process.env.FRONTEND_URL = 'https://app.test';
process.env.ASHBY_API_BASE = 'https://api.ashbyhq.com';

const ACCOUNT = '00000000-0000-0000-0000-0000000000aa';
const TEMPLATE = '11111111-1111-1111-1111-111111111111';

// ---- in-memory store (mock-prefixed so the jest.mock factory may reference it) ----
let mockStore;
let mockSeq = 0;
function resetStore() {
  mockStore = {
    assessment_templates: [
      { id: TEMPLATE, title: 'Backend Real-Work Screen', summary: 'Fix a real bug', position: 'backend',
        prompt_md: 'Do the thing', rubric: { criteria: [{ id: 'c', requirement: 'r', points_possible: 100, weight: 1 }] },
        starter_files: [{ path: 'solution.js', content: '//' }], languages: ['javascript'], tests: { command: 'node x' },
        time_limit_min: 45, is_public: true, created_by: null },
      { id: '22222222-2222-2222-2222-222222222222', title: 'Private Other', summary: 's', position: 'frontend',
        prompt_md: 'p', rubric: { criteria: [{ id: 'c', requirement: 'r', points_possible: 100, weight: 1 }] },
        is_public: false, created_by: 'someone-else' },
    ],
    work_samples: [],
    work_sample_submissions: [],
    ashby_assessments: [],
    ashby_integration_settings: [],
    api_keys: [],
  };
}

// ---- mocks (must be registered before requiring the service). The chainable supabase fake lives
// INSIDE the factory and references the mock-prefixed mockStore (jest permits mock* names). ----
jest.mock('../../src/config/supabase', () => {
  function makeDb() {
    return {
      from(table) {
        const rows = (mockStore[table] = mockStore[table] || []);
        const ctx = { filters: [], orExpr: null, ins: null, upd: null, ups: null, del: false };
        const match = (row) => ctx.filters.every(([c, v]) => row[c] === v);
        const matchOr = (row) => {
          if (!match(row)) return false;
          if (!ctx.orExpr) return true;
          return ctx.orExpr.split(',').some((clause) => {
            const [col, op, val] = clause.split('.');
            if (op !== 'eq') return false;
            const v = val === 'true' ? true : val === 'false' ? false : val;
            return row[col] === v;
          });
        };
        const applyInsert = () => {
          const obj = ctx.ins;
          const row = { id: obj.id || `row-${++mockSeq}`, ...obj };
          rows.push(row);
          return row;
        };
        const resolveMany = () => {
          if (ctx.ins) return { data: [applyInsert()], error: null };
          if (ctx.ups) {
            const obj = ctx.ups;
            const existing = rows.find((r) => r.account_id === obj.account_id);
            if (existing) Object.assign(existing, obj); else rows.push({ ...obj });
            return { data: null, error: null };
          }
          if (ctx.upd) { rows.filter(match).forEach((r) => Object.assign(r, ctx.upd)); return { data: null, error: null }; }
          if (ctx.del) { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1); return { data: null, error: null }; }
          return { data: rows.filter(matchOr), error: null };
        };
        const resolveOne = () => {
          if (ctx.ins) return { data: applyInsert(), error: null };
          const found = rows.filter(matchOr)[0];
          return { data: found || null, error: found ? null : { code: 'PGRST116' } };
        };
        const q = {
          select() { return q; },
          eq(c, v) { ctx.filters.push([c, v]); return q; },
          or(e) { ctx.orExpr = e; return q; },
          order() { return q; },
          limit() { return q; },
          insert(o) { ctx.ins = o; return q; },
          update(o) { ctx.upd = o; return q; },
          upsert(o) { ctx.ups = o; return q; },
          delete() { ctx.del = true; return q; },
          maybeSingle: async () => { const r = resolveOne(); return { data: r.data, error: null }; },
          single: async () => resolveOne(),
          then(onF, onR) { return Promise.resolve(resolveMany()).then(onF, onR); },
        };
        return q;
      },
    };
  }
  const db = makeDb();
  return { supabaseAdmin: db, supabase: db, createAuthenticatedClient: () => db, apiTenantDb: () => db };
});
jest.mock('../../src/services/userProvisioning', () => ({
  ensureAuthUser: jest.fn(async (email) => `cand-${email}`),
}));
jest.mock('../../src/services/integrityDigestService', () => ({
  computeDigest: jest.fn(async () => ({ verified_chain: true, summary: { typed_fraction: 0.9 } })),
}));
jest.mock('../../src/services/verifyService', () => ({
  deriveProofOfHumanState: jest.fn(() => 'verified'),
}));
jest.mock('../../src/services/calibrationService', () => ({
  calibrationForScore: jest.fn(async () => ({ percentile: 72 })),
}));
jest.mock('../../src/services/ssrfGuard', () => ({
  assertPublicHttpsUrl: jest.fn(async (u) => new URL(u)),
  SsrfError: class SsrfError extends Error {},
}));

// makeDb closure needs the same `store`; the mock above captured makeDb at module scope.
const ashby = require('../../src/services/ashbyAssessmentService');
const { hashKey } = require('../../src/services/apiKeyService');

let fetchCalls;
beforeEach(() => {
  resetStore();
  mockSeq = 0;
  fetchCalls = [];
  global.fetch = jest.fn(async (url, opts) => {
    fetchCalls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    return { ok: true, status: 200, json: async () => ({ success: true }), text: async () => '' };
  });
});

describe('ashbyAssessmentService', () => {
  test('listAssessmentTypes returns REAL templates (public + owned), Ashby shape', async () => {
    const types = await ashby.listAssessmentTypes(ACCOUNT);
    // public seed is visible; the other-owner private one is not
    expect(types.find((t) => t.assessment_type_id === TEMPLATE)).toMatchObject({
      assessment_type_id: TEMPLATE, name: 'Backend Real-Work Screen',
    });
    expect(types.every((t) => 'assessment_type_id' in t && 'name' in t && 'description' in t)).toBe(true);
    expect(types.find((t) => t.assessment_type_id === '22222222-2222-2222-2222-222222222222')).toBeUndefined();
  });

  test('startAssessment creates work_sample + submission + mapping and returns assessment_id', async () => {
    const payload = {
      assessment_type_id: TEMPLATE,
      candidate: { ashby_id: 'ac1', first_name: 'Ada', last_name: 'L', email: 'ada@x.com', ashby_profile_url: 'https://ashby/c' },
      application: { ashby_id: 'app1', status: 'Interview' },
      job: { ashby_id: 'job1', name: 'Backend', ashby_job_url: 'https://ashby/j' },
    };
    const { assessment_id, reused } = await ashby.startAssessment(ACCOUNT, payload);
    expect(assessment_id).toBeTruthy();
    expect(reused).toBe(false);
    expect(mockStore.work_samples).toHaveLength(1);
    expect(mockStore.work_sample_submissions).toHaveLength(1);
    expect(mockStore.work_sample_submissions[0].candidate_id).toBe('cand-ada@x.com');
    const mapping = mockStore.ashby_assessments[0];
    expect(mapping.id).toBe(assessment_id);
    expect(mapping).toMatchObject({ account_id: ACCOUNT, ashby_application_id: 'app1', status: 'started' });
  });

  test('start gate (TOU-150): Ashby-created submission is unstarted (status assigned, NULL started_at/deadline_at)', async () => {
    await ashby.startAssessment(ACCOUNT, {
      assessment_type_id: TEMPLATE, candidate: { email: 'gate@x.com' },
      application: { ashby_id: 'app-gate' }, job: {},
    });
    expect(mockStore.work_sample_submissions).toHaveLength(1);
    const sub = mockStore.work_sample_submissions[0];
    // The shared createSubmission helper (proof.js) creates the row: the timer must NOT be
    // running yet; only the candidate's explicit POST /submissions/:id/start stamps both.
    expect(sub.status).toBe('assigned');
    expect(sub.started_at ?? null).toBeNull();
    expect(sub.deadline_at ?? null).toBeNull();
  });

  test('startAssessment is IDEMPOTENT on retry (same application + type → same id, no duplicate)', async () => {
    const payload = {
      assessment_type_id: TEMPLATE,
      candidate: { email: 'ada@x.com', first_name: 'Ada', ashby_id: 'ac1' },
      application: { ashby_id: 'app1', status: 'Interview' },
      job: { ashby_id: 'job1', name: 'Backend', ashby_job_url: 'u' },
    };
    const a = await ashby.startAssessment(ACCOUNT, payload);
    const b = await ashby.startAssessment(ACCOUNT, payload);
    expect(b.assessment_id).toBe(a.assessment_id);
    expect(b.reused).toBe(true);
    expect(mockStore.ashby_assessments).toHaveLength(1);
    expect(mockStore.work_sample_submissions).toHaveLength(1); // not assigned twice
  });

  test('startAssessment is idempotent even WITHOUT application.ashby_id (falls back to type+email)', async () => {
    const payload = { assessment_type_id: TEMPLATE, candidate: { email: 'noapp@x.com' }, application: {}, job: {} };
    const a = await ashby.startAssessment(ACCOUNT, payload);
    const b = await ashby.startAssessment(ACCOUNT, payload);
    expect(b.assessment_id).toBe(a.assessment_id);
    expect(b.reused).toBe(true);
    expect(mockStore.ashby_assessments).toHaveLength(1);
  });

  test('startAssessment rejects an unknown / cross-tenant template (422)', async () => {
    await expect(ashby.startAssessment(ACCOUNT, {
      assessment_type_id: '22222222-2222-2222-2222-222222222222', // private to someone else
      candidate: { email: 'a@x.com' }, application: { ashby_id: 'app9' }, job: {},
    })).rejects.toMatchObject({ name: 'AshbyStartError', httpStatus: 422 });
  });

  test('cancelAssessment archives the screen + marks the mapping cancelled', async () => {
    const { assessment_id } = await ashby.startAssessment(ACCOUNT, {
      assessment_type_id: TEMPLATE, candidate: { email: 'a@x.com' },
      application: { ashby_id: 'app2' }, job: {},
    });
    const r = await ashby.cancelAssessment(ACCOUNT, assessment_id);
    expect(r.assessment_id).toBe(assessment_id);
    expect(mockStore.ashby_assessments[0].status).toBe('cancelled');
    expect(mockStore.work_samples[0].status).toBe('archived');
  });

  test('outbound reportToAshby builds a correctly-shaped assessment.update (key as Basic-auth username, int ms timestamp, valid blob types)', async () => {
    await ashby.setTenantAshbyKey(ACCOUNT, 'ashby_secret_key_abcd');
    const mapping = { id: 'asmt-1', account_id: ACCOUNT, work_sample_id: 'ws1', submission_id: 'sub1', last_reported_ms: 0 };
    const completion = await ashby.buildCompletionBlobs(mapping, { score: 87.4, direction_score: 64, result_url: 'https://app.test/r' });
    await ashby.reportToAshby(mapping, 'complete', completion);

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('https://api.ashbyhq.com/assessment.update');
    // Basic auth = base64("key:")  (key in username, blank password)
    expect(call.headers.Authorization).toBe('Basic ' + Buffer.from('ashby_secret_key_abcd:').toString('base64'));
    expect(call.headers.Accept).toBe('application/json; version=1');
    expect(call.headers['User-Agent']).toBeTruthy(); // Cloudflare 1010 blocks a default/empty UA
    const b = call.body;
    expect(b.assessment_id).toBe('asmt-1');
    expect(Number.isInteger(b.timestamp)).toBe(true); // ms-since-epoch integer, NOT ISO
    // assessment_result present == "complete" signal; headline numeric_score rounded
    expect(b.assessment_result).toMatchObject({ identifier: 'score', type: 'numeric_score', value: 87 });
    const ALLOWED = ['numeric_score', 'numeric_duration_minutes', 'url', 'string', 'boolean_success'];
    const allBlobs = [b.assessment_result, ...(b.metadata || []), b.assessment_profile_url].filter(Boolean);
    expect(allBlobs.every((x) => ALLOWED.includes(x.type))).toBe(true);
    expect(allBlobs.every((x) => 'identifier' in x && 'label' in x && 'value' in x)).toBe(true);
    // proof-of-human + percentile + result url carried
    expect((b.metadata || []).find((m) => m.identifier === 'proof_of_human')).toMatchObject({ type: 'string', value: 'verified' });
    expect((b.metadata || []).find((m) => m.identifier === 'percentile')).toMatchObject({ value: 72 });
    expect(b.assessment_profile_url).toMatchObject({ type: 'url', value: 'https://app.test/r' });
  });

  test('reportToAshby is a graceful no-op when no outbound key is configured', async () => {
    const r = await ashby.reportToAshby({ id: 'x', account_id: ACCOUNT }, 'started');
    expect(r).toMatchObject({ skipped: true, reason: 'no_ashby_key' });
    expect(fetchCalls).toHaveLength(0);
  });

  test('reportCompletionForSubmission fires EXACTLY ONE completion update and is idempotent', async () => {
    // Start with NO outbound key so the fire-and-forget 'started' report is a no-op skip, then
    // flush it before configuring the key — isolating the completion update we want to count.
    const { assessment_id } = await ashby.startAssessment(ACCOUNT, {
      assessment_type_id: TEMPLATE, candidate: { email: 'a@x.com' }, application: { ashby_id: 'app3' }, job: {},
    });
    await new Promise((r) => setTimeout(r, 10));
    await ashby.setTenantAshbyKey(ACCOUNT, 'k');
    const sub = mockStore.ashby_assessments.find((m) => m.id === assessment_id).submission_id;
    fetchCalls = [];
    await ashby.reportCompletionForSubmission(sub, { score: 90, result_url: 'https://app.test/r' });
    const second = await ashby.reportCompletionForSubmission(sub, { score: 90 }); // re-score → must NOT re-report
    expect(fetchCalls).toHaveLength(1);
    expect(second).toMatchObject({ skipped: true });
    expect(mockStore.ashby_assessments.find((m) => m.id === assessment_id).status).toBe('complete');
  });

  test('settings: key stored encrypted (never plaintext), get returns only configured+last4', async () => {
    const r = await ashby.setTenantAshbyKey(ACCOUNT, 'super_secret_value_9999');
    expect(r).toEqual({ configured: true, last4: '9999' });
    const stored = mockStore.ashby_integration_settings[0];
    expect(stored.api_key_enc).toMatch(/^v1:/);
    expect(stored.api_key_enc).not.toContain('super_secret_value');
    expect(await ashby.getTenantAshbyKey(ACCOUNT)).toBe('super_secret_value_9999'); // decrypts back
    expect(await ashby.getTenantSettings(ACCOUNT)).toEqual({ configured: true, last4: '9999' });
  });
});

// ---- inbound partner router: Basic-auth via the existing /v1 key path ----
describe('Ashby partner router (inbound Basic auth)', () => {
  const VALID_KEY = 'tsk_test_abcdefghijklmnopqrstuvwxyz012345';
  let app;
  beforeEach(() => {
    // seed an active api_keys row for VALID_KEY so the REAL apiKeyAuth resolves the tenant
    mockStore.api_keys.push({ id: 'key1', account_id: ACCOUNT, mode: 'test', scopes: [], hashed_key: hashKey(VALID_KEY), revoked_at: null });
    const router = require('../../src/routes/integrations/ashby');
    app = express();
    app.use('/integrations/ashby', router);
  });

  const basic = (key) => 'Basic ' + Buffer.from(`${key}:`).toString('base64');

  test('assessment.list with a valid key in the Basic-auth username → 200 {success, results}', async () => {
    const res = await request(app).post('/integrations/ashby/assessment.list').set('Authorization', basic(VALID_KEY)).send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results[0]).toHaveProperty('assessment_type_id');
  });

  test('accepts the key in the PASSWORD field too', async () => {
    const inPassword = 'Basic ' + Buffer.from(`x:${VALID_KEY}`).toString('base64');
    const res = await request(app).post('/integrations/ashby/assessment.list').set('Authorization', inPassword).send({});
    expect(res.status).toBe(200);
  });

  test('missing / bad key → 401 (no tenant)', async () => {
    const noAuth = await request(app).post('/integrations/ashby/assessment.list').send({});
    expect(noAuth.status).toBe(401);
    const badKey = await request(app).post('/integrations/ashby/assessment.list').set('Authorization', basic('tsk_test_notarealkey00000000000000000000')).send({});
    expect(badKey.status).toBe(401);
  });

  test('assessment.start → {success, results:{assessment_id}}; assessment.cancel echoes the id', async () => {
    const startRes = await request(app).post('/integrations/ashby/assessment.start').set('Authorization', basic(VALID_KEY)).send({
      assessment_type_id: TEMPLATE,
      candidate: { ashby_id: 'ac1', first_name: 'Ada', last_name: 'L', email: 'ada@x.com', ashby_profile_url: 'u' },
      application: { ashby_id: 'app1', status: 'Interview' },
      job: { ashby_id: 'job1', name: 'Backend', ashby_job_url: 'u' },
    });
    expect(startRes.status).toBe(200);
    expect(startRes.body).toMatchObject({ success: true });
    const id = startRes.body.results.assessment_id;
    expect(id).toBeTruthy();

    const cancelRes = await request(app).post('/integrations/ashby/assessment.cancel').set('Authorization', basic(VALID_KEY)).send({ assessment_id: id });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.results.assessment_id).toBe(id);
  });

  test('customField.list → empty stub', async () => {
    const res = await request(app).post('/integrations/ashby/assessment.customField.list').set('Authorization', basic(VALID_KEY)).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fields: [] });
  });
});
