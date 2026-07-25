/**
 * Verify API `/v1` — Phase 2 ingest + reads (CI-safe, NO live DB).
 * ----------------------------------------------------------------
 * Everything is mocked deterministically:
 *   - ../../src/config/supabase           → an in-memory store driving a chainable query builder
 *                                           + a stub for the append_integrity_event /
 *                                           increment_api_usage RPCs and computeDigest's read.
 *   - the engine services (proofScoringService / aiDirectionService / codeExecutionService)
 *                                         → fixed returns, so we assert the engine is CALLED with
 *                                           the right args (proving no forked logic) and that its
 *                                           returns flow into the Verification shape.
 * The REAL verify router + the REAL verifyService (deriveProofOfHumanState / assemble) run.
 *
 * Asserts:
 *   1. happy-path POST /v1/verifications → 200 with the Verification shape incl. proof_of_human.state
 *      AND that scoreSubmission was called with { accountId, reviewerId } = the API account.
 *   2. deriveProofOfHumanState — every branch (unit).
 *   3. tenant isolation — a verification owned by account B is NOT readable with account A's key.
 *   4. idempotency — the same Idempotency-Key returns the prior report and does NOT re-score.
 */

require('../../src/polyfill'); // Node 25 SlowBuffer/WebStreams shim — before any require chain

const express = require('express');
const request = require('supertest');

const ACCOUNT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACCOUNT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const KEY_A = 'key-aaaa-1111';

// ── in-memory DB + RPC stub (lives in the mock factory; jest hoists jest.mock) ───────────
jest.mock('../../src/config/supabase', () => {
  const store = {
    verifications: [],
    work_samples: [],
    work_sample_submissions: [],
    ai_interactions: [],
    processed_events: [],
    proof_scores: [],
    proof_audit_log: [],
    ai_direction_scores: [],
    verified_credentials: [],
    submission_integrity_events: [],
  };
  let idCounter = 1;
  const uuid = () => `00000000-0000-0000-0000-${String(idCounter++).padStart(12, '0')}`;

  const makeQuery = (table) => {
    const q = { _t: table, _filters: [], _insert: null, _update: null, _isFilters: [] };
    q.select = () => q;
    q.eq = (col, val) => { q._filters.push((r) => r[col] === val); return q; };
    q.is = (col, val) => { q._filters.push((r) => (r[col] ?? null) === val); return q; };
    q.order = () => q;
    q.limit = () => q;
    q.insert = (vals) => { q._insert = vals; return q; };
    q.update = (patch) => { q._update = patch; return q; };
    q.delete = () => { q._delete = true; return q; };
    const match = () => store[table].filter((r) => q._filters.every((f) => f(r)));
    // Enforce the unique constraints the route relies on:
    //   processed_events.event_key  (the idempotency claim → 23505 on replay)
    //   verifications(account_id, idempotency_key)  (the UNIQUE backstop)
    const conflict = (r) => {
      if (table === 'processed_events') {
        return store.processed_events.some((x) => x.event_key === r.event_key);
      }
      if (table === 'verifications' && r.idempotency_key != null) {
        return store.verifications.some(
          (x) => x.account_id === r.account_id && x.idempotency_key === r.idempotency_key,
        );
      }
      return false;
    };
    const applyInsert = () => {
      const rows = Array.isArray(q._insert) ? q._insert : [q._insert];
      for (const r of rows) if (conflict(r)) { q._conflictErr = { code: '23505', message: 'duplicate key' }; return null; }
      const inserted = rows.map((r) => {
        const row = { id: r.id || uuid(), created_at: new Date().toISOString(), ...r };
        if (table === 'verified_credentials' && !row.public_token) {
          row.public_token = 'tok_' + uuid().replace(/-/g, '');
          row.issued_at = new Date().toISOString();
        }
        store[table].push(row);
        return row;
      });
      return inserted;
    };
    const applyUpdate = () => { const m = match(); m.forEach((r) => Object.assign(r, q._update)); return m; };
    const applyDelete = () => {
      const keep = store[table].filter((r) => !q._filters.every((f) => f(r)));
      store[table].length = 0; store[table].push(...keep);
    };
    q.single = async () => {
      if (q._insert) { const ins = applyInsert(); if (q._conflictErr) return { data: null, error: q._conflictErr }; return { data: ins[0], error: null }; }
      if (q._update) { const m = applyUpdate(); return { data: m[0] || null, error: m.length ? null : { code: 'PGRST116' } }; }
      const m = match();
      return { data: m[0] || null, error: m.length ? null : { code: 'PGRST116' } };
    };
    q.maybeSingle = async () => {
      if (q._update) { const m = applyUpdate(); return { data: m[0] || null, error: null }; }
      const m = match();
      return { data: m[0] || null, error: null };
    };
    // Awaitable (insert/update/delete without .single()).
    q.then = (resolve) => {
      let data = null, error = null;
      if (q._insert) { data = applyInsert(); if (q._conflictErr) error = q._conflictErr; }
      else if (q._update) applyUpdate();
      else if (q._delete) applyDelete();
      else data = match();
      return Promise.resolve({ data, error }).then(resolve);
    };
    return q;
  };

  const supabaseAdmin = {
    __id: 'ADMIN',
    __store: store,
    from: (t) => makeQuery(t),
    rpc: jest.fn(async (fn, args) => {
      if (fn === 'append_integrity_event') {
        const seq = store.submission_integrity_events.filter((e) => e.submission_id === args.p_submission_id).length + 1;
        const row = {
          submission_id: args.p_submission_id, seq, type: args.p_type, category: args.p_category,
          meta: args.p_meta, client_ts: args.p_client_ts, source: args.p_source,
          prev_hash: 'p' + seq, row_hash: 'h' + seq,
        };
        store.submission_integrity_events.push(row);
        return { data: [{ out_seq: seq, out_row_hash: row.row_hash, out_prev_hash: row.prev_hash }], error: null };
      }
      if (fn === 'increment_api_usage') return { data: null, error: null };
      return { data: null, error: null };
    }),
  };
  return {
    supabaseAdmin,
    supabase: { rpc: jest.fn(async () => ({ data: null, error: null })) },
    createAuthenticatedClient: jest.fn(() => supabaseAdmin),
    __store: store,
  };
});

// ── mock the integrity digest (avoid real chain math; we drive verified_chain/summary) ──
const mockComputeDigest = jest.fn();
jest.mock('../../src/services/integrityDigestService', () => ({
  computeDigest: (...a) => mockComputeDigest(...a),
  // pass-through helpers (not exercised in these tests)
  canonicalJson: (v) => JSON.stringify(v),
  contentHash: () => 'x',
  verifyLinkage: () => true,
  genesis: () => 'g',
}));

// ── mock the engine services (assert the CALL shape; return fixed outcomes) ──────────────
const mockScoreSubmission = jest.fn();
jest.mock('../../src/services/proofScoringService', () => ({
  scoreSubmission: (...a) => mockScoreSubmission(...a),
}));
const mockScoreAiDirection = jest.fn();
jest.mock('../../src/services/aiDirectionService', () => ({
  scoreAiDirection: (...a) => mockScoreAiDirection(...a),
}));
jest.mock('../../src/services/codeExecutionService', () => ({
  isEnabled: () => false,
  runTests: jest.fn(),
}));
jest.mock('../../src/services/scoringQueue', () => ({
  enqueue: jest.fn(async () => ({ id: 'job-1', status: 'queued' })),
}));

const { supabaseAdmin, __store } = require('../../src/config/supabase');
const verifyRoutes = require('../../src/routes/supabase/verify');
const verifyService = require('../../src/services/verifyService');

// Build an app that injects req.apiAccount (stand-in for apiKeyAuth) then mounts the REAL router.
function appForAccount(accountId, mode = 'live') {
  const app = express();
  app.use(express.json());
  app.use('/v1', (req, _res, next) => {
    req.apiAccount = { accountId, mode, scopes: [], keyId: KEY_A, db: supabaseAdmin };
    next();
  }, verifyRoutes);
  return app;
}

const validBody = (overrides = {}) => ({
  candidate_ref: 'cand-external-123',
  rubric: { criteria: [{ id: 'c1', requirement: 'Solves the task', points_possible: 10 }] },
  rubric_version: 1,
  prompt_md: 'Do the thing',
  work: { response_text: 'My answer to the task.' },
  ...overrides,
});

function resetStore() {
  for (const k of Object.keys(__store)) __store[k].length = 0;
}

beforeEach(() => {
  resetStore();
  delete process.env.USE_SCORING_QUEUE;
  process.env.FRONTEND_URL = 'https://app.test';
  mockComputeDigest.mockReset();
  mockScoreSubmission.mockReset();
  mockScoreAiDirection.mockReset();
  supabaseAdmin.rpc.mockClear();
  // Default: clean human, verified chain.
  mockComputeDigest.mockResolvedValue({
    submission_id: 's', event_count: 2, server_observed_count: 1, head_hash: 'HEAD123',
    verified_chain: true,
    summary: { tab_hidden_count: 0, window_blur_count: 0, paste_count: 0, paste_chars: 0,
      typed_chars: 200, final_chars: 200, typed_fraction: 1, bot_verdict: null },
    ide_activity: null,
  });
  mockScoreSubmission.mockResolvedValue({
    scoreId: 'score-1', normalized_score: 82, outcome: 'advance', score_variance: 1.2,
    injection_flag: false, per_criterion: [{ id: 'c1', points_awarded: 8, points_possible: 10 }],
    overall_explanation: 'Strong.',
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
describe('POST /v1/verifications — happy path', () => {
  it('returns 200 with the Verification shape and calls the engine with the account identity', async () => {
    const app = appForAccount(ACCOUNT_A);
    const res = await request(app).post('/v1/verifications').send(validBody());

    expect(res.status).toBe(200);
    const v = res.body;
    // Verification object shape (spec step 10).
    expect(v).toHaveProperty('id');
    expect(v.candidate_ref).toBe('cand-external-123');
    expect(v.mode).toBe('live');
    expect(v.status).toBe('completed');
    expect(v).toHaveProperty('proof_of_human');
    expect(v.proof_of_human.state).toBe('verified');
    expect(v.proof_of_human.verified_chain).toBe(true);
    expect(v.proof_of_human.digest.head_hash).toBe('HEAD123');
    expect(v.score).toMatchObject({ score: 82, outcome: 'advance' });
    expect(v.ai_direction).toBeNull();          // no transcript → omitted
    expect(v.code_execution).toBeNull();         // run_tests not requested
    expect(v).toHaveProperty('audit_url');
    expect(v).toHaveProperty('created_at');
    expect(v).toHaveProperty('completed_at');

    // ENGINE REUSE PROOF: scoreSubmission called with the internal submission id + the
    // account identity (accountId + reviewerId), exactly like proof.js.
    expect(mockScoreSubmission).toHaveBeenCalledTimes(1);
    const [submissionId, opts] = mockScoreSubmission.mock.calls[0];
    expect(typeof submissionId).toBe('string');
    expect(opts).toMatchObject({ accountId: ACCOUNT_A, reviewerId: ACCOUNT_A });

    // candidate_id rule: the internal submission's candidate_id == accountId (NOT candidate_ref).
    const sub = __store.work_sample_submissions[0];
    expect(sub.candidate_id).toBe(ACCOUNT_A);
    expect(sub.candidate_id).not.toBe('cand-external-123');
    // The verifications row carries the opaque candidate_ref.
    expect(__store.verifications[0].candidate_ref).toBe('cand-external-123');
    // The internal work_sample is owned by the account and published.
    expect(__store.work_samples[0]).toMatchObject({ owner_id: ACCOUNT_A, status: 'published' });
  });

  it('scores AI direction when an ai_transcript is supplied, and inserts client_attested events', async () => {
    mockScoreAiDirection.mockResolvedValue({
      status: 'scored', direction_score: 74, prompt_quality: 80, error_catching: 70,
      verification_rigor: 60, interaction_count: 2, reasoning: 'Directed well.',
    });
    const app = appForAccount(ACCOUNT_A);
    const res = await request(app).post('/v1/verifications').send(validBody({
      ai_transcript: [{ role: 'user', content: 'help' }, { role: 'assistant', content: 'sure' }],
      events: [{ type: 'paste', category: 'provenance', meta: { chars: 5 }, client_ts: '2026-06-24T00:00:00Z' }],
    }));

    expect(res.status).toBe(200);
    expect(res.body.ai_direction).toMatchObject({ direction_score: 74 });
    expect(mockScoreAiDirection).toHaveBeenCalledWith(expect.any(String), { accountId: ACCOUNT_A });
    // Events appended via the RPC with source 'client_attested' (never server_observed).
    const appendCalls = supabaseAdmin.rpc.mock.calls.filter((c) => c[0] === 'append_integrity_event');
    expect(appendCalls.length).toBe(1);
    expect(appendCalls[0][1].p_source).toBe('client_attested');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
describe('POST /v1/verifications — validation + degraded engine returns', () => {
  it('400 with the error envelope when the body is invalid', async () => {
    const app = appForAccount(ACCOUNT_A);
    const res = await request(app).post('/v1/verifications').send({ candidate_ref: 'x' }); // missing rubric/work
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ type: 'validation_error', message: expect.any(String) });
  });

  it('400 when work has neither response_text nor response_code', async () => {
    const app = appForAccount(ACCOUNT_A);
    const res = await request(app).post('/v1/verifications').send(validBody({ work: {} }));
    expect(res.status).toBe(400);
    expect(res.body.error.type).toBe('validation_error');
  });

  it('429 with Retry-After when scoring hits the spend ceiling', async () => {
    const e = new Error('daily ceiling'); e.name = 'SpendCeilingError';
    mockScoreSubmission.mockRejectedValue(e);
    const app = appForAccount(ACCOUNT_A);
    const res = await request(app).post('/v1/verifications').send(validBody());
    expect(res.status).toBe(429);
    expect(res.body.error.type).toBe('rate_limit');
    expect(res.headers['retry-after']).toBe('60');
  });

  it('202 queued when scoring returns pending_scoring (LLM down)', async () => {
    mockScoreSubmission.mockResolvedValue({ status: 'pending_scoring', submissionId: 's', retryable: true });
    const app = appForAccount(ACCOUNT_A);
    const res = await request(app).post('/v1/verifications').send(validBody());
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'queued' });
  });

  it('status needs_review when scoring returns needs_review', async () => {
    mockScoreSubmission.mockResolvedValue({ status: 'needs_review', submissionId: 's', injection_flag: false });
    const app = appForAccount(ACCOUNT_A);
    const res = await request(app).post('/v1/verifications').send(validBody());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('needs_review');
    expect(res.body.score).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
describe('deriveProofOfHumanState — every branch', () => {
  const { deriveProofOfHumanState } = verifyService;
  it('null digest → needs_review', () => {
    expect(deriveProofOfHumanState(null)).toBe('needs_review');
  });
  it('bot_verdict true → flagged', () => {
    expect(deriveProofOfHumanState({ verified_chain: true, summary: { bot_verdict: true } })).toBe('flagged');
  });
  it('verified_chain false → flagged', () => {
    expect(deriveProofOfHumanState({ verified_chain: false, summary: {} })).toBe('flagged');
  });
  it('heavy paste (typed_fraction < 0.5) → needs_review', () => {
    expect(deriveProofOfHumanState({ verified_chain: true, summary: { typed_fraction: 0.3 } })).toBe('needs_review');
  });
  it('wandered (tab_hidden_count > 5) → needs_review', () => {
    expect(deriveProofOfHumanState({ verified_chain: true, summary: { tab_hidden_count: 6 } })).toBe('needs_review');
  });
  it('wandered (window_blur_count > 8) → needs_review', () => {
    expect(deriveProofOfHumanState({ verified_chain: true, summary: { window_blur_count: 9 } })).toBe('needs_review');
  });
  it('zero integrity events → needs_review (evidentiary floor, never an automated fail)', () => {
    expect(deriveProofOfHumanState({ verified_chain: true, event_count: 0, summary: {} })).toBe('needs_review');
  });
  it('clean → verified', () => {
    expect(deriveProofOfHumanState({
      verified_chain: true,
      event_count: 3,
      summary: { typed_fraction: 1, tab_hidden_count: 0, window_blur_count: 0, bot_verdict: null },
    })).toBe('verified');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
describe('GET /v1/verifications/:id — tenant isolation', () => {
  it("account B's verification is NOT readable with account A's key (filtered by account_id)", async () => {
    // Seed a completed verification owned by account B directly in the store.
    const id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    __store.verifications.push({
      id, account_id: ACCOUNT_B, status: 'completed',
      report: { id, candidate_ref: 'b-secret', mode: 'live', status: 'completed' },
      created_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    });

    // Account A asks for B's verification → 404 (the .eq('account_id', A) filter excludes it).
    const resA = await request(appForAccount(ACCOUNT_A)).get(`/v1/verifications/${id}`);
    expect(resA.status).toBe(404);
    expect(resA.body.error.type).toBe('not_found');

    // Account B reads its own → 200 with the report.
    const resB = await request(appForAccount(ACCOUNT_B)).get(`/v1/verifications/${id}`);
    expect(resB.status).toBe(200);
    expect(resB.body.candidate_ref).toBe('b-secret');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
describe('POST /v1/verifications — idempotency', () => {
  it('same Idempotency-Key returns the prior report and does NOT re-score', async () => {
    const app = appForAccount(ACCOUNT_A);
    const idem = 'idem-key-xyz';

    const first = await request(app).post('/v1/verifications')
      .set('Idempotency-Key', idem).send(validBody());
    expect(first.status).toBe(200);
    expect(mockScoreSubmission).toHaveBeenCalledTimes(1);
    const firstId = first.body.id;

    // Replay with the SAME key → the processed_events claim conflicts → prior report returned.
    const second = await request(app).post('/v1/verifications')
      .set('Idempotency-Key', idem).send(validBody());
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(firstId);            // same Verification
    expect(mockScoreSubmission).toHaveBeenCalledTimes(1); // NOT re-scored
  });
});
