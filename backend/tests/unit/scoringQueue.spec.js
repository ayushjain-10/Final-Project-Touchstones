/**
 * Unit tests for the async scoring queue + idempotency rails
 * (REVIEW-2026-06 §E + §F). Env-independent → run in CI.
 *
 *   §E  A 'pending_scoring' (LLM-down) result must requeue the job to 'queued' so the
 *       worker re-drains on recovery — NOT park it terminal — bounded by MAX_ATTEMPTS.
 *   §F  Scoring must be idempotent on retry: a second processJob for an already-scored
 *       (submission, rubric_version) must NOT insert a duplicate proof_scores row, and
 *       must NOT re-run the LLM / re-charge spend.
 *
 * Both supabaseAdmin and proofScoringService are mocked so these are deterministic and
 * never touch a real Supabase server (the test harness uses placeholder URLs).
 */

// ---- in-memory supabaseAdmin fake (chainable, just enough for these paths) ----
function makeDb(tables) {
  const store = tables; // { tableName: [rows] }
  function from(table) {
    store[table] = store[table] || [];
    const rows = store[table];
    const q = { _filters: [], _limit: null, _table: table };
    q.select = () => q;
    q.eq = (col, val) => { q._filters.push((r) => r[col] === val); return q; };
    q.is = (col, val) => { q._filters.push((r) => (r[col] ?? null) === val); return q; };
    q.order = () => q;
    q.limit = (n) => { q._limit = n; return q; };
    const match = () => {
      const m = rows.filter((r) => q._filters.every((f) => f(r)));
      return q._limit != null ? m.slice(0, q._limit) : m;
    };
    // Awaiting the query directly (no .single()/.maybeSingle()) resolves to an array result.
    q.then = (resolve) => resolve({ data: match(), error: null });
    q.maybeSingle = async () => ({ data: match()[0] || null, error: null });
    q.single = async () => {
      const m = match();
      return m.length ? { data: m[0], error: null } : { data: null, error: { code: 'PGRST116' } };
    };
    q.update = (patch) => {
      const upd = { _filters: [] };
      upd.eq = (col, val) => { upd._filters.push((r) => r[col] === val); return upd; };
      // emulate the .update(...).eq(...).select().single() claim shape + fire-and-forget
      const apply = () => {
        const affected = rows.filter((r) => upd._filters.every((f) => f(r)));
        affected.forEach((r) => Object.assign(r, patch));
        return affected;
      };
      upd.select = () => ({ single: async () => { const a = apply(); return { data: a[0] || null, error: a.length ? null : { code: 'PGRST116' } }; } });
      // when not chained with .select(), the update is awaited directly
      upd.then = (resolve) => resolve({ data: apply(), error: null });
      return upd;
    };
    q.insert = (row) => {
      const r = Array.isArray(row) ? row : [row];
      r.forEach((x) => rows.push({ ...x }));
      return { select: () => ({ single: async () => ({ data: rows[rows.length - 1], error: null }) }), then: (res) => res({ data: r, error: null }) };
    };
    q.upsert = (row, opts) => {
      const conflict = opts && opts.onConflict ? opts.onConflict.split(',') : ['event_key'];
      const existing = rows.find((r) => conflict.every((c) => r[c] === row[c]));
      if (existing) Object.assign(existing, row); else rows.push({ ...row });
      return { then: (res) => res({ data: [row], error: null }) };
    };
    return q;
  }
  return { from };
}

describe('scoringQueue.processJob — §E requeue on pending_scoring', () => {
  let scoringQueue, proofScoringService, jobsTable;

  beforeEach(() => {
    jest.resetModules();
    jobsTable = [];
    const db = makeDb({ scoring_jobs: jobsTable, processed_events: [] });
    jest.doMock('../../src/config/supabase', () => ({ supabaseAdmin: db }));
    jest.doMock('../../src/services/proofScoringService', () => ({
      scoreSubmission: jest.fn(),
    }));
    jest.doMock('../../src/config/observability', () => ({
      logger: { error: () => {}, info: () => {} }, captureException: () => {},
    }));
    scoringQueue = require('../../src/services/scoringQueue');
    proofScoringService = require('../../src/services/proofScoringService');
  });

  afterEach(() => {
    jest.dontMock('../../src/config/supabase');
    // Also un-mock proofScoringService so its mock doesn't leak into the next
    // describe block, which requires the REAL service (test isolation).
    jest.dontMock('../../src/services/proofScoringService');
  });

  test("a 'pending_scoring' result requeues the job to 'queued' (re-claimable), not terminal", async () => {
    const job = { id: 'job-1', submission_id: 'sub-1', rubric_version: 1, attempts: 1 };
    jobsTable.push({ ...job, status: 'processing' });
    proofScoringService.scoreSubmission.mockResolvedValue({ status: 'pending_scoring', retryable: true });

    const r = await scoringQueue.processJob(job);

    expect(r.status).toBe('requeued');
    const persisted = jobsTable.find((j) => j.id === 'job-1');
    expect(persisted.status).toBe('queued'); // NOT a terminal 'pending_scoring' row
    expect(persisted.last_error).toBe('llm_unavailable');
  });

  test("re-queued status is the one claimNext selects ('queued'), so the worker re-drains", async () => {
    // After §E requeue the row is 'queued'; claimNext selects status='queued' and claims it.
    jobsTable.push({ id: 'job-2', submission_id: 'sub-2', rubric_version: 1, status: 'queued', attempts: 1, created_at: '2026-01-01' });
    const claimed = await scoringQueue.claimNext();
    expect(claimed).not.toBeNull();
    expect(claimed.id).toBe('job-2');
    expect(claimed.status).toBe('processing');
    expect(claimed.attempts).toBe(2); // claim increments attempts
  });

  test("a 'pending_scoring' result at MAX_ATTEMPTS goes terminal 'failed' (capped)", async () => {
    const MAX = parseInt(process.env.SCORING_JOB_MAX_ATTEMPTS || '3', 10);
    const job = { id: 'job-3', submission_id: 'sub-3', rubric_version: 1, attempts: MAX };
    jobsTable.push({ ...job, status: 'processing' });
    proofScoringService.scoreSubmission.mockResolvedValue({ status: 'pending_scoring', retryable: true });

    const r = await scoringQueue.processJob(job);

    expect(r.status).toBe('failed');
    expect(jobsTable.find((j) => j.id === 'job-3').status).toBe('failed'); // not re-queued forever
  });
});

describe('scoringQueue.processJob — §F idempotency (no duplicate score / no re-spend)', () => {
  let scoringQueue, proofScoringService, jobsTable, eventsTable;

  beforeEach(() => {
    jest.resetModules();
    jobsTable = [];
    eventsTable = [];
    const db = makeDb({ scoring_jobs: jobsTable, processed_events: eventsTable });
    jest.doMock('../../src/config/supabase', () => ({ supabaseAdmin: db }));
    jest.doMock('../../src/services/proofScoringService', () => ({ scoreSubmission: jest.fn() }));
    jest.doMock('../../src/config/observability', () => ({
      logger: { error: () => {}, info: () => {} }, captureException: () => {},
    }));
    scoringQueue = require('../../src/services/scoringQueue');
    proofScoringService = require('../../src/services/proofScoringService');
  });

  afterEach(() => {
    jest.dontMock('../../src/config/supabase');
    // Also un-mock proofScoringService so its mock doesn't leak into the next
    // describe block, which requires the REAL service (test isolation).
    jest.dontMock('../../src/services/proofScoringService');
  });

  test('a second processJob for an already-handled pair short-circuits and does NOT re-run the LLM', async () => {
    // First pass scores successfully and records the dedup key.
    const job = { id: 'job-a', submission_id: 'sub-a', rubric_version: 1, attempts: 1 };
    jobsTable.push({ ...job, status: 'processing' });
    proofScoringService.scoreSubmission.mockResolvedValue({ scoreId: 's1', normalized_score: 80, outcome: 'advance' });

    const first = await scoringQueue.processJob(job);
    expect(first.status).toBe('scored');
    expect(proofScoringService.scoreSubmission).toHaveBeenCalledTimes(1);
    expect(eventsTable.find((e) => e.event_key === 'sub-a:1')).toBeTruthy();

    // Second pass (retry / re-claim) for the SAME pair: cache hit → no second LLM run.
    proofScoringService.scoreSubmission.mockClear();
    const second = await scoringQueue.processJob({ ...job, attempts: 2 });
    expect(second.cached).toBe(true);
    expect(second.status).toBe('scored');
    expect(proofScoringService.scoreSubmission).not.toHaveBeenCalled();
  });
});

describe('proofScoringService.scoreSubmission — §F idempotency (existing proof_scores short-circuit)', () => {
  let proofScoringService, spendGuard, createSpy, db;

  beforeEach(() => {
    jest.resetModules();
    // proof_scores already has a LIVE (non-superseded) score for (sub-x, rubric 2).
    db = makeDb({
      work_sample_submissions: [{ id: 'sub-x', work_sample_id: 'ws-x', response_text: 'hello', candidate_id: 'cand-x' }],
      work_samples: [{ id: 'ws-x', rubric: { criteria: [] }, rubric_version: 2, owner_id: 'owner-x' }],
      proof_scores: [{
        id: 'existing-score', submission_id: 'sub-x', rubric_version: 2, superseded_by: null,
        normalized_score: 73, outcome: 'advance', score_variance: 1.2, injection_flag: false,
        per_criterion: [{ id: 'c1', points_awarded: 7 }], created_at: '2026-01-01',
      }],
    });
    createSpy = jest.fn();
    jest.doMock('../../src/config/supabase', () => ({ supabaseAdmin: db }));
    jest.doMock('../../src/services/aiService', () => ({
      getLLM: () => ({ anthropic: { messages: { create: createSpy } }, model: 'claude-haiku-4-5' }),
    }));
    jest.doMock('../../src/services/scoreDelivery', () => ({ deliver: jest.fn() }));
    proofScoringService = require('../../src/services/proofScoringService');
    spendGuard = require('../../src/services/spendGuard');
  });

  afterEach(() => { jest.dontMock('../../src/config/supabase'); jest.dontMock('../../src/services/aiService'); });

  test('returns the cached live score WITHOUT reserving spend or calling the LLM', async () => {
    const reserveSpy = jest.spyOn(spendGuard, 'reserve');

    const r = await proofScoringService.scoreSubmission('sub-x', {});

    expect(r.cached).toBe(true);
    expect(r.scoreId).toBe('existing-score');
    expect(r.normalized_score).toBe(73);
    expect(createSpy).not.toHaveBeenCalled();   // LLM never invoked
    expect(reserveSpy).not.toHaveBeenCalled();  // spend never re-charged
    reserveSpy.mockRestore();
  });

  test('a NEW pair (no live score) does NOT short-circuit — proceeds to reserve spend', async () => {
    const reserveSpy = jest.spyOn(spendGuard, 'reserve').mockReturnValue({ ok: false, reason: 'account_daily_quota' });
    // sub-y has no existing proof_scores row → must fall through to the spend reservation.
    db.from('work_sample_submissions').insert({ id: 'sub-y', work_sample_id: 'ws-x', response_text: 'hi', candidate_id: 'cand-y' });

    await expect(proofScoringService.scoreSubmission('sub-y', {})).rejects.toThrow();
    expect(reserveSpy).toHaveBeenCalledTimes(1); // proved the short-circuit did NOT fire
    reserveSpy.mockRestore();
  });
});
