/**
 * Unit tests for the LLM spend guard (env-independent → run in CI).
 */
const spendGuard = require('../../src/services/spendGuard');

describe('spendGuard', () => {
  beforeEach(() => spendGuard._reset());

  test('allows calls under the per-account quota', () => {
    const r = spendGuard.reserve({ accountId: 'acct-1' });
    expect(r.ok).toBe(true);
  });

  test('enforces the per-account daily quota independently per account', () => {
    process.env.AI_DAILY_SCORING_QUOTA_PER_ACCOUNT; // documented env
    // Drive acct-1 to its quota using the configured default.
    const limit = Number(process.env.AI_DAILY_SCORING_QUOTA_PER_ACCOUNT || 200);
    let last;
    for (let i = 0; i < limit; i++) last = spendGuard.reserve({ accountId: 'acct-1', estCostUsd: 0 });
    expect(last.ok).toBe(true);
    // The next acct-1 reservation is over quota...
    expect(spendGuard.reserve({ accountId: 'acct-1', estCostUsd: 0 }).ok).toBe(false);
    // ...but a different account is unaffected.
    expect(spendGuard.reserve({ accountId: 'acct-2', estCostUsd: 0 }).ok).toBe(true);
  });

  test('trips the global daily spend ceiling', () => {
    // Force a tiny ceiling and a per-call cost that exceeds it on the 2nd call.
    const r1 = spendGuard.reserve({ accountId: 'a', estCostUsd: 4.9 });
    expect(r1.ok).toBe(true);
    const r2 = spendGuard.reserve({ accountId: 'a', estCostUsd: 1.0 });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('global_daily_spend_ceiling');
  });

  test('snapshot exposes limits and running totals', () => {
    spendGuard.reserve({ accountId: 'a', estCostUsd: 0.001 });
    const s = spendGuard.snapshot();
    expect(s.limits).toBeDefined();
    expect(s.globalCalls).toBeGreaterThan(0);
  });

  test('SpendCeilingError carries a 429 status', () => {
    const e = new spendGuard.SpendCeilingError('account_daily_quota');
    expect(e.statusCode).toBe(429);
    expect(e.reason).toBe('account_daily_quota');
  });
});
