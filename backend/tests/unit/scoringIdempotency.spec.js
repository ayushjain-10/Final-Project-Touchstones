/**
 * Idempotency of POST /api/proof/submissions/:id/score (proofScoringService.scoreSubmission).
 * The route must NOT 500 on a re-score: a duplicate (submission, rubric_version) returns the
 * existing live score as { cached: true }, with no second LLM spend and no duplicate proof_scores.
 *
 * Two paths are covered:
 *   1. pre-check hit  — a live score already exists → return it cached WITHOUT calling the LLM.
 *   2. 23505 race     — pre-check finds nothing, but the insert loses the partial-unique-index
 *                       race (a concurrent score committed first) → re-read + return cached, not 500.
 *   3. fresh score    — no existing row, insert succeeds → normal (not cached) return.
 *
 * Supabase / the LLM / spendGuard are mocked so the test is deterministic and offline.
 */
process.env.AI_SELF_CONSISTENCY_N = '1';        // single grading sample → deterministic
process.env.ANTHROPIC_API_KEY = 'test-key';

// Shared, assertable LLM mock (mock-prefixed so the jest.mock factory may reference it).
const mockGraderJson = JSON.stringify({
  per_criterion: [{ id: 'c1', evidence_quote: 'q', explanation: 'e', verdict: 'MET', points_awarded: 10, points_possible: 10 }],
  overall_explanation: 'Solid, correct solution.',
  injection_detected: false,
});
const mockCreate = jest.fn(async () => ({ content: [{ type: 'text', text: mockGraderJson }] }));

let mockState;
jest.mock('../../src/config/supabase', () => {
  const makeQuery = (table) => {
    const q = { _t: table, _insert: null };
    q.select = () => q; q.eq = () => q; q.is = () => q; q.order = () => q; q.limit = () => q; q.update = () => q;
    q.insert = (vals) => { q._insert = vals; return q; };
    q.single = async () => {
      if (q._t === 'work_sample_submissions') return { data: mockState.submission, error: null };
      if (q._t === 'work_samples') return { data: mockState.ws, error: null };
      if (q._t === 'proof_scores' && q._insert) {
        if (mockState.insertMode === '23505') {
          // a concurrent transaction committed the row first → make the re-read find it
          mockState.liveScore = mockState.committedLive;
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        const row = { id: 'score-new', ...q._insert };
        mockState.liveScore = {
          id: 'score-new', normalized_score: row.normalized_score, outcome: row.outcome,
          score_variance: row.score_variance, injection_flag: row.injection_flag,
          per_criterion: row.per_criterion, overall_explanation: row.overall_explanation,
        };
        return { data: row, error: null };
      }
      return { data: null, error: null };
    };
    q.maybeSingle = async () => (q._t === 'proof_scores' ? { data: mockState.liveScore || null, error: null } : { data: null, error: null });
    q.then = (resolve) => resolve({ data: null, error: null }); // bare await (update / audit insert)
    return q;
  };
  return { supabaseAdmin: { from: makeQuery } };
});

jest.mock('../../src/services/aiService', () => ({
  getLLM: () => ({ anthropic: { messages: { create: mockCreate } }, model: 'test-model' }),
}));
jest.mock('../../src/services/spendGuard', () => {
  class SpendCeilingError extends Error {}
  return { reserve: () => ({ ok: true }), SpendCeilingError };
});
jest.mock('../../src/services/scoreDelivery', () => ({ deliver: async () => ({ delivered: {} }) }));

const { scoreSubmission } = require('../../src/services/proofScoringService');

beforeEach(() => {
  mockCreate.mockClear();
  mockState = {
    submission: { id: 'sub-1', work_sample_id: 'ws-1', response_text: 'an answer', input_hash: 'h', candidate_id: 'cand-1', job_id: null },
    ws: { id: 'ws-1', rubric: { criteria: [{ id: 'c1', points_possible: 10, weight: 1, requirement: 'works' }] }, rubric_version: 1, owner_id: 'own-1', job_id: null },
    liveScore: null,
    committedLive: {
      id: 'score-existing', normalized_score: 77, outcome: 'advance', score_variance: 0,
      injection_flag: false, per_criterion: [{ id: 'c1', points_awarded: 7, points_possible: 10 }],
      overall_explanation: 'Prior score reasoning.',
    },
    insertMode: 'ok',
  };
});

describe('scoreSubmission idempotency', () => {
  test('pre-existing live score → returns it cached, WITHOUT calling the LLM', async () => {
    mockState.liveScore = mockState.committedLive;
    const r = await scoreSubmission('sub-1', { accountId: 'own-1' });
    expect(r.cached).toBe(true);
    expect(r.scoreId).toBe('score-existing');
    expect(r.normalized_score).toBe(77);
    expect(r.overall_explanation).toBe('Prior score reasoning.');
    expect(mockCreate).not.toHaveBeenCalled();   // no second LLM spend
  });

  test('insert hits the 23505 unique-constraint race → re-reads + returns cached (no 500)', async () => {
    mockState.liveScore = null;        // pre-check finds nothing
    mockState.insertMode = '23505';    // our insert loses the race; concurrent row already committed
    const r = await scoreSubmission('sub-1', { accountId: 'own-1' });
    expect(r.cached).toBe(true);
    expect(r.scoreId).toBe('score-existing');
    expect(r.normalized_score).toBe(77);
  });

  test('fresh score (no existing row, insert succeeds) → not cached, 0–100 score', async () => {
    const r = await scoreSubmission('sub-1', { accountId: 'own-1' });
    expect(r.cached).toBeFalsy();
    expect(r.scoreId).toBe('score-new');
    expect(r.normalized_score).toBe(100);  // 10/10
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
