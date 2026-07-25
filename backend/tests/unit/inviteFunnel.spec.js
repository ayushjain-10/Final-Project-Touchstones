/**
 * Invite funnel shaping (GET /api/proof/work-samples/invites/overview, migration 106).
 * Pure-function tests for buildInviteFunnel: per-invite status is the furthest stage reached,
 * counts are cumulative funnel stages (sent >= started >= submitted >= scored), and submissions
 * without an invite row (direct ?ws self-assigns) fold in labeled by the candidate's email.
 * Start gate (migration 107): started means ACTUALLY started (started_at stamped, or a status
 * past 'assigned'); an assigned-but-never-started claim still counts as invited.
 * Decline (migration 108): a declined submission reports status 'declined', a terminal side exit
 * counted in its own `declined` bucket (never in the started chain; a decline is pre-start by
 * construction).
 */
const { buildInviteFunnel } = require('../../src/routes/supabase/proof');

const WS = 'ws-1';
const sample = { id: WS, title: 'Backend screen' };

const funnel = ({ samples = [sample], invites = [], subs = [], emails = {} } = {}) =>
  buildInviteFunnel(samples, invites, subs, emails);

describe('buildInviteFunnel', () => {
  test('invite with no submission stays invited', () => {
    const { screens, totals } = funnel({
      invites: [{ work_sample_id: WS, email: 'a@x.com', created_at: 't1', submission_id: null }],
    });
    expect(screens[0].invites).toEqual([
      { email: 'a@x.com', status: 'invited', invited_at: 't1', submitted_at: null },
    ]);
    expect(screens[0]).toMatchObject({ sent: 1, started: 0, submitted: 0, scored: 0, declined: 0 });
    expect(totals).toEqual({ sent: 1, started: 0, submitted: 0, scored: 0, declined: 0 });
  });

  test('claimed invites follow their submissions through the stages (cumulative counts)', () => {
    const subs = [
      { id: 's1', work_sample_id: WS, candidate_id: 'c1', status: 'in_progress', submitted_at: null },
      { id: 's2', work_sample_id: WS, candidate_id: 'c2', status: 'scored', submitted_at: 't9' },
    ];
    const invites = [
      { work_sample_id: WS, email: 'a@x.com', created_at: 't1', submission_id: 's1' },
      { work_sample_id: WS, email: 'b@x.com', created_at: 't2', submission_id: 's2' },
      { work_sample_id: WS, email: 'c@x.com', created_at: 't3', submission_id: null },
    ];
    const { screens, totals } = funnel({ invites, subs, emails: { c1: 'a@x.com', c2: 'b@x.com' } });
    const byEmail = Object.fromEntries(screens[0].invites.map((i) => [i.email, i]));
    expect(byEmail['a@x.com'].status).toBe('started');
    expect(byEmail['b@x.com'].status).toBe('scored');
    expect(byEmail['b@x.com'].submitted_at).toBe('t9');
    expect(byEmail['c@x.com'].status).toBe('invited');
    expect(screens[0]).toMatchObject({ sent: 3, started: 2, submitted: 1, scored: 1, declined: 0 });
    expect(totals).toEqual({ sent: 3, started: 2, submitted: 1, scored: 1, declined: 0 });
  });

  test('unclaimed invite matches a submission by candidate email (no duplicate direct row)', () => {
    const subs = [{ id: 's1', work_sample_id: WS, candidate_id: 'c1', status: 'submitted', submitted_at: 't5' }];
    const invites = [{ work_sample_id: WS, email: 'a@x.com', created_at: 't1', submission_id: null }];
    const { screens } = funnel({ invites, subs, emails: { c1: 'a@x.com' } });
    expect(screens[0].invites).toHaveLength(1);
    expect(screens[0].invites[0]).toMatchObject({ email: 'a@x.com', status: 'submitted', submitted_at: 't5' });
  });

  test('direct ?ws self-assign without an invite row folds in with the profile email', () => {
    const subs = [{ id: 's1', work_sample_id: WS, candidate_id: 'c1', status: 'expired', submitted_at: null }];
    const { screens, totals } = funnel({ subs, emails: { c1: 'd@x.com' } });
    expect(screens[0].invites).toEqual([
      { email: 'd@x.com', status: 'started', invited_at: null, submitted_at: null },
    ]);
    expect(totals).toEqual({ sent: 1, started: 1, submitted: 0, scored: 0, declined: 0 });
  });

  test('screens with no activity report zeros', () => {
    const { screens, totals } = funnel();
    expect(screens[0]).toMatchObject({ sent: 0, started: 0, submitted: 0, scored: 0, declined: 0, invites: [] });
    expect(totals).toEqual({ sent: 0, started: 0, submitted: 0, scored: 0, declined: 0 });
  });

  test('assigned but never started (start gate) stays invited', () => {
    const subs = [{ id: 's1', work_sample_id: WS, candidate_id: 'c1', status: 'assigned', started_at: null, submitted_at: null }];
    const invites = [{ work_sample_id: WS, email: 'a@x.com', created_at: 't1', submission_id: 's1' }];
    const { screens, totals } = funnel({ invites, subs, emails: { c1: 'a@x.com' } });
    expect(screens[0].invites).toEqual([
      { email: 'a@x.com', status: 'invited', invited_at: 't1', submitted_at: null },
    ]);
    expect(totals).toEqual({ sent: 1, started: 0, submitted: 0, scored: 0, declined: 0 });
  });

  test('assigned with a stamped started_at (legacy pre-107 row) counts as started', () => {
    const subs = [{ id: 's1', work_sample_id: WS, candidate_id: 'c1', status: 'assigned', started_at: 't2', submitted_at: null }];
    const invites = [{ work_sample_id: WS, email: 'a@x.com', created_at: 't1', submission_id: 's1' }];
    const { screens, totals } = funnel({ invites, subs, emails: { c1: 'a@x.com' } });
    expect(screens[0].invites[0].status).toBe('started');
    expect(totals).toEqual({ sent: 1, started: 1, submitted: 0, scored: 0, declined: 0 });
  });

  test('direct self-assign that never started folds in as a sent-but-invited row', () => {
    const subs = [{ id: 's1', work_sample_id: WS, candidate_id: 'c1', status: 'assigned', started_at: null, submitted_at: null }];
    const { screens, totals } = funnel({ subs, emails: { c1: 'd@x.com' } });
    expect(screens[0].invites).toEqual([
      { email: 'd@x.com', status: 'invited', invited_at: null, submitted_at: null },
    ]);
    expect(totals).toEqual({ sent: 1, started: 0, submitted: 0, scored: 0, declined: 0 });
  });

  test('a declined claimed invite reports declined and counts in the declined bucket, not started', () => {
    const subs = [{ id: 's1', work_sample_id: WS, candidate_id: 'c1', status: 'declined', started_at: null, submitted_at: null }];
    const invites = [{ work_sample_id: WS, email: 'a@x.com', created_at: 't1', submission_id: 's1' }];
    const { screens, totals } = funnel({ invites, subs, emails: { c1: 'a@x.com' } });
    expect(screens[0].invites).toEqual([
      { email: 'a@x.com', status: 'declined', invited_at: 't1', submitted_at: null },
    ]);
    expect(screens[0]).toMatchObject({ sent: 1, started: 0, submitted: 0, scored: 0, declined: 1 });
    expect(totals).toEqual({ sent: 1, started: 0, submitted: 0, scored: 0, declined: 1 });
  });

  test('a declined direct self-assign folds in as a declined row', () => {
    const subs = [{ id: 's1', work_sample_id: WS, candidate_id: 'c1', status: 'declined', started_at: null, submitted_at: null }];
    const { screens, totals } = funnel({ subs, emails: { c1: 'd@x.com' } });
    expect(screens[0].invites).toEqual([
      { email: 'd@x.com', status: 'declined', invited_at: null, submitted_at: null },
    ]);
    expect(totals).toEqual({ sent: 1, started: 0, submitted: 0, scored: 0, declined: 1 });
  });

  test('declined and progressed invites count independently on the same screen', () => {
    const subs = [
      { id: 's1', work_sample_id: WS, candidate_id: 'c1', status: 'declined', started_at: null, submitted_at: null },
      { id: 's2', work_sample_id: WS, candidate_id: 'c2', status: 'scored', submitted_at: 't9' },
    ];
    const invites = [
      { work_sample_id: WS, email: 'a@x.com', created_at: 't1', submission_id: 's1' },
      { work_sample_id: WS, email: 'b@x.com', created_at: 't2', submission_id: 's2' },
    ];
    const { screens, totals } = funnel({ invites, subs, emails: { c1: 'a@x.com', c2: 'b@x.com' } });
    expect(screens[0]).toMatchObject({ sent: 2, started: 1, submitted: 1, scored: 1, declined: 1 });
    expect(totals).toEqual({ sent: 2, started: 1, submitted: 1, scored: 1, declined: 1 });
  });
});
