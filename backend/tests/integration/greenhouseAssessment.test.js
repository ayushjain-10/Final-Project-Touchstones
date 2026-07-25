/**
 * Greenhouse Assessments partner integration - service + inbound-auth tests (mirrors ashby.test.js).
 *
 * Deterministic / env-independent: we mock the supabase client (a tiny chainable fake backed by an
 * in-memory store), the candidate-provisioning + trust-signal services, the invite-email notifier,
 * the SSRF guard, and global fetch (so the outbound completion PATCH never leaves the process).
 * Then we exercise the REAL greenhouseAssessmentService + the REAL partner router, asserting the
 * exact documented Greenhouse contract shapes (developers.greenhouse.io/assessment.html).
 */
const express = require('express');
const request = require('supertest');

process.env.GREENHOUSE_ASSESSMENTS_ENABLED = 'true';
process.env.ASHBY_ENC_KEY = 'a'.repeat(64); // 32-byte hex → deterministic cryptoVault key
process.env.FRONTEND_URL = 'https://app.test';

const ACCOUNT = '00000000-0000-0000-0000-0000000000aa';
const TEMPLATE = '11111111-1111-1111-1111-111111111111';
const PATCH_URL = 'https://app.greenhouse.io/integrations/testing_partners/take_home_tests/12345';
const PROFILE_URL = 'https://app.greenhouse.io/people/17681532?application_id=26234709';

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
    greenhouse_assessments: [],
    greenhouse_integration_settings: [],
    greenhouse_oauth_connections: [],
    api_keys: [],
  };
}

// ---- mocks (must be registered before requiring the service) ----
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
jest.mock('../../src/services/workflowNotify', () => ({
  candidateAssignedToScreen: jest.fn(async () => {}),
}));

const greenhouse = require('../../src/services/greenhouseAssessmentService');
const workflowNotify = require('../../src/services/workflowNotify');
const { hashKey } = require('../../src/services/apiKeyService');

let fetchCalls;
beforeEach(() => {
  process.env.GREENHOUSE_ASSESSMENTS_ENABLED = 'true';
  resetStore();
  mockSeq = 0;
  fetchCalls = [];
  workflowNotify.candidateAssignedToScreen.mockClear();
  global.fetch = jest.fn(async (url, opts) => {
    fetchCalls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  });
});

function sendPayload(overrides = {}) {
  return {
    partner_test_id: TEMPLATE,
    candidate: {
      first_name: 'Harry', last_name: 'Potter', preferred_name: 'The Chosen One',
      email: 'hpotter@hogwarts.edu', phone_number: '123-456-7890',
      greenhouse_profile_url: PROFILE_URL,
    },
    sent_by: 'recruiter@customer.example',
    url: PATCH_URL,
    ...overrides,
  };
}

describe('greenhouseAssessmentService', () => {
  test('listTests returns REAL templates (public + owned) in the Greenhouse shape', async () => {
    const tests = await greenhouse.listTests(ACCOUNT);
    expect(tests.find((t) => t.partner_test_id === TEMPLATE)).toEqual({
      partner_test_id: TEMPLATE, partner_test_name: 'Backend Real-Work Screen',
    });
    expect(tests.every((t) => typeof t.partner_test_id === 'string' && typeof t.partner_test_name === 'string')).toBe(true);
    expect(tests.find((t) => t.partner_test_id === '22222222-2222-2222-2222-222222222222')).toBeUndefined();
  });

  test('sendTest creates work_sample + submission + mapping, parses greenhouse ids, emails the invite', async () => {
    const { partner_interview_id, reused } = await greenhouse.sendTest(ACCOUNT, sendPayload());
    expect(partner_interview_id).toBeTruthy();
    expect(reused).toBe(false);
    expect(mockStore.work_samples).toHaveLength(1);
    expect(mockStore.work_sample_submissions).toHaveLength(1);
    expect(mockStore.work_sample_submissions[0].candidate_id).toBe('cand-hpotter@hogwarts.edu');
    const mapping = mockStore.greenhouse_assessments[0];
    expect(mapping.id).toBe(partner_interview_id);
    expect(mapping).toMatchObject({
      account_id: ACCOUNT, status: 'sent', candidate_email: 'hpotter@hogwarts.edu',
      gh_candidate_id: 17681532, gh_application_id: 26234709,
      gh_take_home_test_id: '12345', completion_patch_url: PATCH_URL,
      sent_by: 'recruiter@customer.example',
    });
    // Greenhouse delivers no candidate link - WE send the invite email (shared path, fire-and-forget).
    expect(workflowNotify.candidateAssignedToScreen).toHaveBeenCalledWith({
      candidateId: 'cand-hpotter@hogwarts.edu', workSampleId: mockStore.work_samples[0].id, inviterId: ACCOUNT,
    });
  });

  test('start gate (TOU-150): Greenhouse-created submission is unstarted (assigned, NULL started_at/deadline_at)', async () => {
    await greenhouse.sendTest(ACCOUNT, sendPayload());
    const sub = mockStore.work_sample_submissions[0];
    expect(sub.status).toBe('assigned');
    expect(sub.started_at ?? null).toBeNull();
    expect(sub.deadline_at ?? null).toBeNull();
  });

  test('sendTest is IDEMPOTENT on retry (same take_home_test url → same id, no duplicate)', async () => {
    const a = await greenhouse.sendTest(ACCOUNT, sendPayload());
    const b = await greenhouse.sendTest(ACCOUNT, sendPayload());
    expect(b.partner_interview_id).toBe(a.partner_interview_id);
    expect(b.reused).toBe(true);
    expect(mockStore.greenhouse_assessments).toHaveLength(1);
    expect(mockStore.work_sample_submissions).toHaveLength(1); // not assigned twice
  });

  test('sendTest falls back to (test, email) dedupe when the url carries no usable id', async () => {
    const noIdUrl = 'https://app.greenhouse.io/';
    const a = await greenhouse.sendTest(ACCOUNT, sendPayload({ url: noIdUrl }));
    const b = await greenhouse.sendTest(ACCOUNT, sendPayload({ url: noIdUrl }));
    expect(b.partner_interview_id).toBe(a.partner_interview_id);
    expect(b.reused).toBe(true);
    expect(mockStore.greenhouse_assessments).toHaveLength(1);
  });

  test('sendTest rejects an unknown / cross-tenant test (404, their documented not-found code)', async () => {
    await expect(greenhouse.sendTest(ACCOUNT, sendPayload({
      partner_test_id: '22222222-2222-2222-2222-222222222222', // private to someone else
    }))).rejects.toMatchObject({ name: 'GreenhouseSendError', httpStatus: 404 });
    expect(mockStore.greenhouse_assessments).toHaveLength(0);
  });

  test('sendTest rejects a forged completion url host (we must never PATCH credentials elsewhere)', async () => {
    await expect(greenhouse.sendTest(ACCOUNT, sendPayload({
      url: 'https://evil.example.com/integrations/testing_partners/take_home_tests/12345',
    }))).rejects.toMatchObject({ name: 'GreenhouseSendError', httpStatus: 400 });
    expect(mockStore.greenhouse_assessments).toHaveLength(0);
    expect(mockStore.work_samples).toHaveLength(0); // rejected before anything was written
  });

  test('testStatus answers "sent" while pending and null for an unknown id', async () => {
    const { partner_interview_id } = await greenhouse.sendTest(ACCOUNT, sendPayload());
    expect(await greenhouse.testStatus(ACCOUNT, partner_interview_id)).toEqual({ partner_status: 'sent' });
    expect(await greenhouse.testStatus(ACCOUNT, 'ffffffff-0000-0000-0000-000000000000')).toBeNull();
  });

  test('completion: marks the mapping complete FIRST, then sends the empty-body Basic-auth PATCH', async () => {
    const { key } = await greenhouse.mintAssessmentKey(ACCOUNT);
    const { partner_interview_id } = await greenhouse.sendTest(ACCOUNT, sendPayload());
    const sub = mockStore.greenhouse_assessments[0].submission_id;

    let statusWhenPatched = null;
    global.fetch = jest.fn(async (url, opts) => {
      fetchCalls.push({ url, opts });
      statusWhenPatched = mockStore.greenhouse_assessments[0].status; // observe DB state mid-PATCH
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    });

    const r = await greenhouse.reportCompletionForSubmission(sub, { score: 87.4, direction_score: 64 });
    expect(r.success).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toBe(PATCH_URL);
    expect(call.opts.method).toBe('PATCH');
    expect(call.opts.body).toBeUndefined(); // the contract is an EMPTY body
    expect(call.opts.headers.Authorization).toBe('Basic ' + Buffer.from(`${key}:`).toString('base64'));
    expect(call.opts.headers['User-Agent']).toBeTruthy();
    // Greenhouse GETs test_status immediately after our PATCH - the row must already be final.
    expect(statusWhenPatched).toBe('complete');

    const status = await greenhouse.testStatus(ACCOUNT, partner_interview_id);
    expect(status.partner_status).toBe('complete');
    expect(status.partner_score).toBe(87); // rounded
    expect(status.partner_profile_url).toBe(`https://app.test/app/result?submission=${sub}`);
    // metadata: FLAT object, primitive values only, keys are display labels.
    expect(status.metadata).toMatchObject({
      'Max score': 100, 'Proof of human': 'verified', Percentile: 72, 'AI direction': 64,
    });
    expect(Object.values(status.metadata).every((v) => ['string', 'number', 'boolean'].includes(typeof v))).toBe(true);
    expect(Object.values(status.metadata).every((v) => typeof v !== 'object')).toBe(true);
    expect(mockStore.greenhouse_assessments[0].last_patched_at).toBeTruthy();
  });

  test('completion is idempotent: a re-score does NOT re-PATCH', async () => {
    await greenhouse.mintAssessmentKey(ACCOUNT);
    await greenhouse.sendTest(ACCOUNT, sendPayload());
    const sub = mockStore.greenhouse_assessments[0].submission_id;
    await greenhouse.reportCompletionForSubmission(sub, { score: 90 });
    fetchCalls = [];
    const second = await greenhouse.reportCompletionForSubmission(sub, { score: 91 });
    expect(second).toMatchObject({ skipped: true, reason: 'already_complete' });
    expect(fetchCalls).toHaveLength(0);
  });

  test('completion without an org key still finalizes the row (test_status can answer), skips the PATCH', async () => {
    await greenhouse.sendTest(ACCOUNT, sendPayload());
    const sub = mockStore.greenhouse_assessments[0].submission_id;
    const r = await greenhouse.reportCompletionForSubmission(sub, { score: 55 });
    expect(r).toMatchObject({ skipped: true, reason: 'no_org_key' });
    expect(fetchCalls).toHaveLength(0);
    expect(mockStore.greenhouse_assessments[0].status).toBe('complete');
    const status = await greenhouse.testStatus(ACCOUNT, mockStore.greenhouse_assessments[0].id);
    expect(status.partner_status).toBe('complete');
  });

  test('completion is a no-op when the flag is off (never runs against real customers)', async () => {
    await greenhouse.sendTest(ACCOUNT, sendPayload());
    const sub = mockStore.greenhouse_assessments[0].submission_id;
    process.env.GREENHOUSE_ASSESSMENTS_ENABLED = 'false';
    const r = await greenhouse.reportCompletionForSubmission(sub, { score: 90 });
    expect(r).toMatchObject({ skipped: true, reason: 'greenhouse_assessments_disabled' });
    expect(mockStore.greenhouse_assessments[0].status).toBe('sent');
    expect(fetchCalls).toHaveLength(0);
  });

  test('assessment key: raw shown once at mint, stored ENCRYPTED, rotate revokes the old api_keys row', async () => {
    const first = await greenhouse.mintAssessmentKey(ACCOUNT);
    expect(first.key).toMatch(/^tsk_live_/);
    expect(first.last4).toBe(first.key.slice(-4));
    const settings = mockStore.greenhouse_integration_settings[0];
    expect(settings.assessment_api_key_enc).toMatch(/^v1:/);
    expect(settings.assessment_api_key_enc).not.toContain(first.key);
    expect(await greenhouse.getOrgApiKey(ACCOUNT)).toBe(first.key); // decrypts back for the PATCH
    expect(await greenhouse.getAssessmentKeySettings(ACCOUNT)).toEqual({ configured: true, last4: first.last4 });

    const second = await greenhouse.mintAssessmentKey(ACCOUNT); // rotate
    expect(second.key).not.toBe(first.key);
    const firstRow = mockStore.api_keys.find((k) => hashKey(first.key) === k.hashed_key);
    expect(firstRow.revoked_at).toBeTruthy();
    expect(await greenhouse.getOrgApiKey(ACCOUNT)).toBe(second.key);

    await greenhouse.clearAssessmentKey(ACCOUNT);
    expect(await greenhouse.getAssessmentKeySettings(ACCOUNT)).toEqual({ configured: false, last4: null });
    const secondRow = mockStore.api_keys.find((k) => hashKey(second.key) === k.hashed_key);
    expect(secondRow.revoked_at).toBeTruthy();
  });

  test('request_errors are logged onto the mapping row and never throw', async () => {
    const { partner_interview_id } = await greenhouse.sendTest(ACCOUNT, sendPayload());
    const r = await greenhouse.recordRequestErrors(ACCOUNT, {
      api_call: 'test_status',
      errors: ["partner_status is 'complete' but partner_profile url is missing"],
      partner_interview_id,
    });
    expect(r).toEqual({ status: 200 });
    expect(mockStore.greenhouse_assessments[0].last_error).toContain('test_status');
  });
});

// ---- inbound partner router: Basic-auth via the existing /v1 key path + the flag gate ----
describe('Greenhouse partner router (flag gate + inbound Basic auth)', () => {
  const VALID_KEY = 'tsk_live_abcdefghijklmnopqrstuvwxyz012345';
  let app;
  beforeEach(() => {
    // seed an active api_keys row for VALID_KEY so the REAL apiKeyAuth resolves the tenant
    mockStore.api_keys.push({ id: 'key1', account_id: ACCOUNT, mode: 'live', scopes: [], hashed_key: hashKey(VALID_KEY), revoked_at: null });
    const router = require('../../src/routes/integrations/greenhouse');
    app = express();
    app.use('/integrations/greenhouse', router);
  });

  const basic = (key) => 'Basic ' + Buffer.from(`${key}:`).toString('base64');

  test('the whole surface 404s when GREENHOUSE_ASSESSMENTS_ENABLED is off (even with a valid key)', async () => {
    process.env.GREENHOUSE_ASSESSMENTS_ENABLED = 'false';
    const res = await request(app).get('/integrations/greenhouse/list_tests').set('Authorization', basic(VALID_KEY));
    expect(res.status).toBe(404);
  });

  test('missing / bad key → 401 (no tenant)', async () => {
    const noAuth = await request(app).get('/integrations/greenhouse/list_tests');
    expect(noAuth.status).toBe(401);
    const badKey = await request(app).get('/integrations/greenhouse/list_tests')
      .set('Authorization', basic('tsk_live_notarealkey00000000000000000000'));
    expect(badKey.status).toBe(401);
  });

  test('GET list_tests → 200 bare array of { partner_test_id, partner_test_name }', async () => {
    const res = await request(app).get('/integrations/greenhouse/list_tests').set('Authorization', basic(VALID_KEY));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toEqual({ partner_test_id: TEMPLATE, partner_test_name: 'Backend Real-Work Screen' });
  });

  test('POST send_test → 200 { partner_interview_id } and an UNSTARTED submission via the start gate', async () => {
    const res = await request(app).post('/integrations/greenhouse/send_test')
      .set('Authorization', basic(VALID_KEY)).send(sendPayload());
    expect(res.status).toBe(200);
    expect(res.body.partner_interview_id).toBeTruthy();
    const sub = mockStore.work_sample_submissions[0];
    expect(sub.status).toBe('assigned');
    expect(sub.started_at ?? null).toBeNull();
    expect(sub.deadline_at ?? null).toBeNull();
  });

  test('POST send_test with an unknown test → 404', async () => {
    const res = await request(app).post('/integrations/greenhouse/send_test')
      .set('Authorization', basic(VALID_KEY))
      .send(sendPayload({ partner_test_id: '33333333-3333-3333-3333-333333333333' }));
    expect(res.status).toBe(404);
    expect(res.body.message).toBeTruthy();
  });

  test('GET test_status: pending shape, unknown → 404, complete shape after scoring', async () => {
    const sent = await request(app).post('/integrations/greenhouse/send_test')
      .set('Authorization', basic(VALID_KEY)).send(sendPayload());
    const id = sent.body.partner_interview_id;

    const pending = await request(app)
      .get(`/integrations/greenhouse/test_status?partner_interview_id=${id}`)
      .set('Authorization', basic(VALID_KEY));
    expect(pending.status).toBe(200);
    expect(pending.body).toEqual({ partner_status: 'sent' });

    const unknown = await request(app)
      .get('/integrations/greenhouse/test_status?partner_interview_id=ffffffff-0000-0000-0000-000000000000')
      .set('Authorization', basic(VALID_KEY));
    expect(unknown.status).toBe(404);

    await greenhouse.mintAssessmentKey(ACCOUNT);
    await greenhouse.reportCompletionForSubmission(mockStore.greenhouse_assessments[0].submission_id, { score: 81 });
    const complete = await request(app)
      .get(`/integrations/greenhouse/test_status?partner_interview_id=${id}`)
      .set('Authorization', basic(VALID_KEY));
    expect(complete.status).toBe(200);
    expect(complete.body.partner_status).toBe('complete');
    expect(complete.body.partner_score).toBe(81);
    expect(typeof complete.body.partner_profile_url).toBe('string');
    expect(complete.body.metadata['Max score']).toBe(100);
  });

  test('POST request_errors → always 200 { status: 200 }', async () => {
    const res = await request(app).post('/integrations/greenhouse/request_errors')
      .set('Authorization', basic(VALID_KEY))
      .send({ api_call: 'send_test', errors: ['bad partner_interview_id'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 200 });
  });
});
