/**
 * Re-invite un-decline (migration 108): resetDeclinedSubmission (proof.js) resets a DECLINED
 * claimed submission back to a clean unstarted 'assigned' row when the recruiter re-invites the
 * same (screen, email): declined_at + metadata.decline_reason cleared, started_at/deadline_at
 * back to null, other metadata keys preserved. Any other status is never touched.
 * Supabase is mocked (same pattern as scoringIdempotency.spec.js) so the test is offline.
 */
let mockState;
jest.mock('../../src/config/supabase', () => {
  const makeQuery = () => {
    const q = { _update: null };
    q.select = () => q; q.eq = () => q; q.is = () => q; q.order = () => q; q.limit = () => q;
    q.insert = () => q;
    q.update = (vals) => { q._update = vals; mockState.updates.push(vals); return q; };
    q.single = async () => ({ data: mockState.row || null, error: null });
    // Awaiting the update chain: the .eq('status','declined') guard matches only a declined row.
    q.then = (resolve) => {
      if (q._update && mockState.row && mockState.row.status === 'declined') {
        return resolve({ data: [{ ...mockState.row, ...q._update }], error: null });
      }
      return resolve({ data: [], error: null });
    };
    return q;
  };
  return {
    supabase: { auth: { getUser: async () => ({ data: { user: null }, error: null }) } },
    supabaseAdmin: { from: makeQuery },
    createAuthenticatedClient: () => ({}),
  };
});

const { resetDeclinedSubmission } = require('../../src/routes/supabase/proof');

describe('resetDeclinedSubmission (re-invite un-decline)', () => {
  beforeEach(() => {
    mockState = { row: null, updates: [] };
  });

  test('resets a declined row to a clean assigned row and strips only decline_reason', async () => {
    mockState.row = {
      id: 'sub-1', status: 'declined', declined_at: 't1', started_at: null, deadline_at: null,
      metadata: { decline_reason: 'not interested', late_submission: true },
    };
    const updated = await resetDeclinedSubmission('sub-1');
    expect(updated).toMatchObject({ id: 'sub-1', status: 'assigned', declined_at: null, started_at: null, deadline_at: null });
    expect(mockState.updates).toHaveLength(1);
    expect(mockState.updates[0]).toEqual({
      status: 'assigned', declined_at: null, started_at: null, deadline_at: null,
      metadata: { late_submission: true },
    });
  });

  test('leaves a non-declined submission untouched (no update issued)', async () => {
    mockState.row = { id: 'sub-2', status: 'in_progress', metadata: null };
    const updated = await resetDeclinedSubmission('sub-2');
    expect(updated).toBeNull();
    expect(mockState.updates).toHaveLength(0);
  });

  test('returns null for a missing submission', async () => {
    mockState.row = null;
    const updated = await resetDeclinedSubmission('missing');
    expect(updated).toBeNull();
    expect(mockState.updates).toHaveLength(0);
  });
});
