/**
 * Unit tests for the Stripe plan catalog (src/config/stripePlans.js). This module is
 * PURE — no Stripe SDK, no DB — so plan->Price-id env resolution and plan validity are
 * tested directly. The lookup_key fallback (which DOES hit Stripe) lives in the route
 * and is intentionally NOT exercised here (no DB/network in unit tests).
 */
const {
  PLANS,
  PLAN_KEYS,
  isCheckoutablePlan,
  getPlan,
  resolvePlanPriceFromEnv,
} = require('../../src/config/stripePlans');

describe('plan catalog', () => {
  test('exposes exactly the two self-serve tiers with the agreed amounts + lookup_keys', () => {
    expect(PLAN_KEYS.sort()).toEqual(['growth', 'startup']);
    expect(PLANS.startup.amount).toBe(9900); // $99.00
    expect(PLANS.growth.amount).toBe(39900); // $399.00
    expect(PLANS.startup.lookupKey).toBe('touchstones_startup_monthly');
    expect(PLANS.growth.lookupKey).toBe('touchstones_growth_monthly');
    expect(PLANS.startup.interval).toBe('month');
    expect(PLANS.growth.interval).toBe('month');
  });
});

describe('isCheckoutablePlan / getPlan', () => {
  test('accepts known plan names', () => {
    expect(isCheckoutablePlan('startup')).toBe(true);
    expect(isCheckoutablePlan('growth')).toBe(true);
    expect(getPlan('startup')).toBe(PLANS.startup);
  });

  test('rejects unknown / non-checkoutable / malformed plan names', () => {
    expect(isCheckoutablePlan('enterprise')).toBe(false); // talk-to-us, no Price
    expect(isCheckoutablePlan('free')).toBe(false);
    expect(isCheckoutablePlan('')).toBe(false);
    expect(isCheckoutablePlan(undefined)).toBe(false);
    expect(isCheckoutablePlan(123)).toBe(false);
    // Guard against prototype keys leaking through the hasOwnProperty check.
    expect(isCheckoutablePlan('toString')).toBe(false);
    expect(getPlan('nope')).toBeNull();
  });
});

describe('resolvePlanPriceFromEnv', () => {
  test('returns null when no Price env var is set for the plan', () => {
    expect(resolvePlanPriceFromEnv('startup', {})).toBeNull();
    expect(resolvePlanPriceFromEnv('growth', {})).toBeNull();
  });

  test('resolves the plan-specific env var', () => {
    const env = { STRIPE_PRICE_STARTUP: 'price_startup_123', STRIPE_PRICE_GROWTH: 'price_growth_456' };
    expect(resolvePlanPriceFromEnv('startup', env)).toBe('price_startup_123');
    expect(resolvePlanPriceFromEnv('growth', env)).toBe('price_growth_456');
  });

  test('honors the legacy STRIPE_GROWTH_PRICE_ID for growth, lower priority than STRIPE_PRICE_GROWTH', () => {
    expect(resolvePlanPriceFromEnv('growth', { STRIPE_GROWTH_PRICE_ID: 'price_legacy' })).toBe('price_legacy');
    // When both are present, the canonical STRIPE_PRICE_GROWTH wins.
    expect(
      resolvePlanPriceFromEnv('growth', { STRIPE_PRICE_GROWTH: 'price_new', STRIPE_GROWTH_PRICE_ID: 'price_legacy' }),
    ).toBe('price_new');
  });

  test('ignores blank / whitespace-only values and trims the result', () => {
    expect(resolvePlanPriceFromEnv('startup', { STRIPE_PRICE_STARTUP: '   ' })).toBeNull();
    expect(resolvePlanPriceFromEnv('startup', { STRIPE_PRICE_STARTUP: '  price_padded  ' })).toBe('price_padded');
  });

  test('returns null for a non-checkoutable plan regardless of env', () => {
    expect(resolvePlanPriceFromEnv('enterprise', { STRIPE_PRICE_GROWTH: 'price_x' })).toBeNull();
  });
});
