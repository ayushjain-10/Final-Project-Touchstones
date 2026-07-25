/**
 * Unit tests for Phase 2 plan limits + verified-screen metering
 * (src/services/planLimits.js). Env-independent → runs in CI.
 *
 *   - monthlyScreenLimit(plan) is PURE (free:5, startup:50, growth:Infinity,
 *     unknown→free) and tested directly.
 *   - getScreenUsage()/getPlanForOwner()/countScreensThisMonth() read through
 *     supabaseAdmin, which is mocked with a tiny chainable fake so the count and
 *     plan resolution are deterministic and never touch a real Supabase server.
 */

// ---- chainable supabaseAdmin fake ---------------------------------------
// Tables: profiles[{id, subscription_plan}], work_samples[{id, owner_id}],
//         work_sample_submissions[{id, work_sample_id, created_at}]
// The fake + its in-memory store live INSIDE the mock factory (jest hoists
// jest.mock above imports; only `mock`-prefixed externals may be referenced).
// Tests seed/reset the store via the exported __setStore().
let store;
jest.mock('../../src/config/supabase', () => {
  let data = {};
  const makeQuery = (table) => {
    const rows = data[table] || [];
    const q = { _filters: [], _count: false };
    q.select = (_cols, opts) => { if (opts && opts.count) q._count = true; return q; };
    q.eq = (col, val) => { q._filters.push((r) => r[col] === val); return q; };
    q.in = (col, vals) => { q._filters.push((r) => vals.includes(r[col])); return q; };
    q.gte = (col, val) => { q._filters.push((r) => String(r[col]) >= String(val)); return q; };
    const match = () => rows.filter((r) => q._filters.every((f) => f(r)));
    // Awaiting a count head query resolves to { count }; a normal select to { data }.
    q.then = (resolve) =>
      resolve(q._count ? { count: match().length, error: null } : { data: match(), error: null });
    q.single = async () => {
      const m = match();
      return m.length ? { data: m[0], error: null } : { data: null, error: { code: 'PGRST116' } };
    };
    return q;
  };
  return {
    supabaseAdmin: { from: (table) => makeQuery(table) },
    __setStore: (s) => { data = s; },
  };
});

// eslint-disable-next-line import/order
const { __setStore } = require('../../src/config/supabase');

const {
  monthlyScreenLimit,
  getPlanForOwner,
  countScreensThisMonth,
  getScreenUsage,
  startOfCurrentMonthISO,
} = require('../../src/services/planLimits');

beforeEach(() => {
  store = { profiles: [], work_samples: [], work_sample_submissions: [] };
  __setStore(store); // same object reference, so per-test pushes are visible to the fake
});

describe('monthlyScreenLimit (pure)', () => {
  test('free → 5, startup → 50, growth → Infinity', () => {
    expect(monthlyScreenLimit('free')).toBe(5);
    expect(monthlyScreenLimit('startup')).toBe(50);
    expect(monthlyScreenLimit('growth')).toBe(Infinity);
  });

  test('unknown / unset / malformed plans fail closed to the free limit', () => {
    expect(monthlyScreenLimit('enterprise')).toBe(5);
    expect(monthlyScreenLimit('')).toBe(5);
    expect(monthlyScreenLimit(undefined)).toBe(5);
    expect(monthlyScreenLimit(null)).toBe(5);
    expect(monthlyScreenLimit(123)).toBe(5);
    // prototype keys must not leak through the hasOwnProperty check
    expect(monthlyScreenLimit('toString')).toBe(5);
  });
});

describe('getPlanForOwner', () => {
  test('reads subscription_plan from the profile (flat column)', async () => {
    store.profiles.push({ id: 'owner-1', subscription_plan: 'startup', subscription_status: 'active' });
    await expect(getPlanForOwner('owner-1')).resolves.toBe('startup');
  });

  test('defaults to free when the profile / subscription_plan is missing', async () => {
    store.profiles.push({ id: 'no-sub', subscription_plan: null });
    store.profiles.push({ id: 'empty-sub' });
    await expect(getPlanForOwner('no-sub')).resolves.toBe('free');
    await expect(getPlanForOwner('empty-sub')).resolves.toBe('free');
    await expect(getPlanForOwner('missing-row')).resolves.toBe('free');
  });
});

describe('countScreensThisMonth', () => {
  const NOW = new Date('2026-06-25T12:00:00.000Z');

  test('counts only THIS owner\'s submissions created in the current month', async () => {
    store.work_samples.push({ id: 'ws-mine', owner_id: 'owner-1' });
    store.work_samples.push({ id: 'ws-other', owner_id: 'owner-2' });
    store.work_sample_submissions.push(
      { id: 's1', work_sample_id: 'ws-mine', created_at: '2026-06-02T00:00:00.000Z' }, // this month, mine
      { id: 's2', work_sample_id: 'ws-mine', created_at: '2026-06-20T00:00:00.000Z' }, // this month, mine
      { id: 's3', work_sample_id: 'ws-mine', created_at: '2026-05-31T00:00:00.000Z' }, // LAST month, excluded
      { id: 's4', work_sample_id: 'ws-other', created_at: '2026-06-10T00:00:00.000Z' }, // not mine, excluded
    );
    await expect(countScreensThisMonth('owner-1', NOW)).resolves.toBe(2);
  });

  test('returns 0 when the owner has no work samples', async () => {
    await expect(countScreensThisMonth('owner-1', NOW)).resolves.toBe(0);
  });

  test('startOfCurrentMonthISO is the UTC first instant of the month', () => {
    expect(startOfCurrentMonthISO(NOW)).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('getScreenUsage', () => {
  const NOW = new Date('2026-06-25T12:00:00.000Z');

  test('free recruiter at the cap → used == limit, remaining 0', async () => {
    store.profiles.push({ id: 'owner-free', subscription_plan: 'free' });
    store.work_samples.push({ id: 'ws', owner_id: 'owner-free' });
    for (let i = 0; i < 5; i++) {
      store.work_sample_submissions.push({ id: `s${i}`, work_sample_id: 'ws', created_at: '2026-06-10T00:00:00.000Z' });
    }
    await expect(getScreenUsage({ ownerId: 'owner-free', now: NOW })).resolves.toEqual({
      plan: 'free', limit: 5, used: 5, remaining: 0,
    });
  });

  test('free recruiter under the cap → remaining reflects headroom', async () => {
    store.profiles.push({ id: 'owner-free', subscription_plan: 'free' });
    store.work_samples.push({ id: 'ws', owner_id: 'owner-free' });
    store.work_sample_submissions.push({ id: 's0', work_sample_id: 'ws', created_at: '2026-06-10T00:00:00.000Z' });
    await expect(getScreenUsage({ ownerId: 'owner-free', now: NOW })).resolves.toEqual({
      plan: 'free', limit: 5, used: 1, remaining: 4,
    });
  });

  test('growth recruiter is unlimited (Infinity limit + remaining)', async () => {
    store.profiles.push({ id: 'owner-g', subscription_plan: 'growth' });
    store.work_samples.push({ id: 'ws', owner_id: 'owner-g' });
    for (let i = 0; i < 200; i++) {
      store.work_sample_submissions.push({ id: `s${i}`, work_sample_id: 'ws', created_at: '2026-06-10T00:00:00.000Z' });
    }
    const usage = await getScreenUsage({ ownerId: 'owner-g', now: NOW });
    expect(usage.plan).toBe('growth');
    expect(usage.limit).toBe(Infinity);
    expect(usage.used).toBe(200);
    expect(usage.remaining).toBe(Infinity);
  });
});
