/**
 * Candidate Network — accept idempotency (CC3/v3), behavioral.
 * ----------------------------------------------------------------------------------------
 * The employer accepts an application by REUSING the v2 accept-prior upsert
 * (credential_acceptances, idempotent on (credential_id, accepting_account_id)). This test
 * drives the real route with a STATEFUL in-memory mock of the service-role client and asserts:
 *   • accepting the SAME application twice records ONE acceptance (idempotent) — accepted_count
 *     stays 1, no double-count.
 *   • a DIFFERENT team accepting the SAME credential increments the distinct-team counter to 2
 *     (the network signal that compounds).
 *
 * Runs in USE_MOCK_DB mode, where supabaseAuth attaches our mock as req.user.supabase, so both
 * the RLS-scoped gate read and the service-role writes hit the same stateful store.
 */

// ── Fixtures ──
const REQ_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CRED_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const APP_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CANDIDATE = 'dddddddd-dddd-dddd-dddd-dddddddddddd'; // the applicant (not a req owner)
const TEAM_A = '11111111-1111-1111-1111-111111111111';
const TEAM_B = '22222222-2222-2222-2222-222222222222';

const store = { acceptances: [], appStatus: 'submitted', appCandidateId: CANDIDATE };

const rowFor = (table, eq) => {
  if (table === 'credential_applications' && eq.id === APP_ID) {
    return { id: APP_ID, req_id: REQ_ID, candidate_id: store.appCandidateId, credential_id: CRED_ID, status: store.appStatus };
  }
  if (table === 'verified_credentials' && eq.id === CRED_ID) {
    return { id: CRED_ID, public_token: 'tok-cred', revoked_at: null };
  }
  if (table === 'network_reqs' && eq.id === REQ_ID) {
    return { id: REQ_ID, title: 'Senior Backend Engineer' };
  }
  return null;
};

const makeFrom = (table) => {
  const eq = {};
  let countMode = false;
  let upsertRow = null;
  let updatePatch = null;
  const b = {
    select: (_sel, opts) => { if (opts && opts.count) countMode = true; return b; },
    eq: (col, val) => { eq[col] = val; return b; },
    in: () => b,
    order: () => b,
    update: (patch) => { updatePatch = patch; return b; },
    insert: () => b,
    upsert: (row) => { upsertRow = row; return b; },
    maybeSingle: async () => ({ data: rowFor(table, eq), error: null }),
    single: async () => ({ data: rowFor(table, eq), error: null }),
    then: (resolve, reject) => {
      try {
        if (table === 'credential_acceptances' && upsertRow) {
          const { credential_id, accepting_account_id } = upsertRow;
          const exists = store.acceptances.find(
            (a) => a.credential_id === credential_id && a.accepting_account_id === accepting_account_id,
          );
          if (!exists) store.acceptances.push({ ...upsertRow });
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
        if (table === 'credential_acceptances' && countMode) {
          const n = store.acceptances.filter((a) => a.credential_id === eq.credential_id).length;
          return Promise.resolve({ count: n, data: null, error: null }).then(resolve, reject);
        }
        if (table === 'credential_applications' && updatePatch) {
          if (eq.id === APP_ID && updatePatch.status) store.appStatus = updatePatch.status;
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e);
      }
    },
  };
  return b;
};

const mockSupabase = { from: makeFrom, rpc: async () => ({ data: null, error: null }) };

jest.mock('../../src/config/supabase', () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: null }, error: null }) }, from: makeFrom, rpc: async () => ({ data: null, error: null }) },
  supabaseAdmin: mockSupabase,
  createAuthenticatedClient: () => mockSupabase,
  uploadResumeToStorage: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');

// In USE_MOCK_DB mode the auth middleware decodes (not verifies) the token's `sub` as the user
// id when it's a UUID — that becomes accepting_account_id. So we mint a token per team.
const tokenFor = (uuid) => jwt.sign({ sub: uuid, email: `${uuid}@team.test` }, 'test-secret-key');

describe('network accept idempotency (CC3)', () => {
  const saved = { mockDb: process.env.USE_MOCK_DB, env: process.env.NODE_ENV };
  let app;

  beforeAll(() => {
    process.env.USE_MOCK_DB = 'true';
    process.env.NODE_ENV = 'test'; // mock-auth requires NODE_ENV !== 'production'
    app = require('../../src/app');
  });
  afterAll(() => {
    process.env.USE_MOCK_DB = saved.mockDb;
    process.env.NODE_ENV = saved.env;
  });
  beforeEach(() => {
    store.acceptances = [];
    store.appStatus = 'submitted';
    store.appCandidateId = CANDIDATE;
  });

  test('a candidate CANNOT accept their OWN application (self-acceptance blocked) → 403', async () => {
    store.appCandidateId = TEAM_A; // the applicant IS TEAM_A
    const res = await request(app)
      .post(`/api/network/applications/${APP_ID}/accept`)
      .set('Authorization', `Bearer ${tokenFor(TEAM_A)}`)
      .send({});
    expect(res.status).toBe(403);
    expect(store.acceptances.length).toBe(0); // no fraudulent acceptance recorded
    expect(store.appStatus).toBe('submitted'); // status not forged to 'accepted'
  });

  test('accepting the SAME application twice records ONE acceptance (idempotent)', async () => {
    const auth = `Bearer ${tokenFor(TEAM_A)}`;
    const first = await request(app).post(`/api/network/applications/${APP_ID}/accept`).set('Authorization', auth).send({});
    expect(first.status).toBe(201);
    expect(first.body.accepted).toBe(true);
    expect(first.body.accepted_count).toBe(1);
    expect(store.appStatus).toBe('accepted');

    const second = await request(app).post(`/api/network/applications/${APP_ID}/accept`).set('Authorization', auth).send({});
    expect(second.status).toBe(201);
    expect(second.body.accepted_count).toBe(1); // still ONE — no double-count
    expect(store.acceptances.length).toBe(1);
  });

  test('a DIFFERENT team accepting the same credential → distinct-team counter = 2', async () => {
    await request(app).post(`/api/network/applications/${APP_ID}/accept`).set('Authorization', `Bearer ${tokenFor(TEAM_A)}`).send({});
    const second = await request(app).post(`/api/network/applications/${APP_ID}/accept`).set('Authorization', `Bearer ${tokenFor(TEAM_B)}`).send({});
    expect(second.status).toBe(201);
    expect(second.body.accepted_count).toBe(2);
    expect(store.acceptances.length).toBe(2);
  });
});
