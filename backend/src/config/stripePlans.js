/**
 * Stripe subscription plan catalog (single source of truth).
 *
 * This module is intentionally PURE — no Stripe SDK, no DB, no network. It declares
 * the self-serve subscription tiers (their human label, monthly amount in cents, and
 * the stable Stripe Price `lookup_key`) and resolves a generic plan name to a concrete
 * Stripe Price id. Both the checkout route (routes/supabase/payments.js) and the
 * one-time setup script (scripts/setupStripeProducts.js) import this so the lookup_keys
 * and amounts never drift apart. Because it's pure it is unit-tested directly.
 *
 * Price resolution order for each plan:
 *   1. An explicit env override (STRIPE_PRICE_STARTUP / STRIPE_PRICE_GROWTH, or the
 *      legacy STRIPE_GROWTH_PRICE_ID that production already sets) — lets ops pin a
 *      Price without a code change.
 *   2. Otherwise the caller resolves by `lookup_key` against the Stripe API.
 */

// The self-serve, checkout-able tiers. Enterprise ("talk to us") is intentionally NOT
// here — it has no recurring Price and is handled by a contact mailto on the frontend.
const PLANS = {
  startup: {
    key: 'startup',
    name: 'Touchstones Startup',
    description: '50 verified screens per month, for a team making a handful of engineering hires.',
    amount: 9900, // $99.00 / month, in cents
    currency: 'usd',
    interval: 'month',
    lookupKey: 'touchstones_startup_monthly',
    // Env vars (in priority order) that may pin this plan's Stripe Price id directly.
    priceEnvVars: ['STRIPE_PRICE_STARTUP'],
  },
  growth: {
    key: 'growth',
    name: 'Touchstones Growth',
    description: 'More volume, more seats, and the integrations your process needs.',
    amount: 39900, // $399.00 / month, in cents
    currency: 'usd',
    interval: 'month',
    lookupKey: 'touchstones_growth_monthly',
    // STRIPE_GROWTH_PRICE_ID is the legacy name production already uses; keep honoring it.
    priceEnvVars: ['STRIPE_PRICE_GROWTH', 'STRIPE_GROWTH_PRICE_ID'],
  },
};

const PLAN_KEYS = Object.keys(PLANS);

/** True for a plan name that maps to a real, checkout-able subscription tier. */
function isCheckoutablePlan(plan) {
  return typeof plan === 'string' && Object.prototype.hasOwnProperty.call(PLANS, plan);
}

function getPlan(plan) {
  return isCheckoutablePlan(plan) ? PLANS[plan] : null;
}

/**
 * Resolve a plan name to a Stripe Price id from the environment, if one is pinned.
 *
 * Pure: reads only from the provided `env` map (defaults to process.env) and never
 * calls Stripe. Returns the first non-empty configured Price id across the plan's
 * candidate env vars, or null if none is set (caller then resolves by lookup_key).
 *
 * @param {string} plan         'startup' | 'growth'
 * @param {object} [env]        env source (default process.env)
 * @returns {string|null}       a Stripe Price id (e.g. 'price_...') or null
 */
function resolvePlanPriceFromEnv(plan, env = process.env) {
  const def = getPlan(plan);
  if (!def) return null;
  for (const name of def.priceEnvVars) {
    const v = env[name];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

module.exports = {
  PLANS,
  PLAN_KEYS,
  isCheckoutablePlan,
  getPlan,
  resolvePlanPriceFromEnv,
};
