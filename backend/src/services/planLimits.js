/**
 * Plan limits + verified-screen metering (Phase 2 billing enforcement).
 *
 * Two concerns live here:
 *
 *   1. monthlyScreenLimit(plan) — PURE. Maps a plan name to how many "verified
 *      screens" it may SEND per calendar month. Free is the gated tier; Startup
 *      raises the cap; Growth is unlimited. Unknown / unset plans fall back to
 *      'free' (fail-closed — a misconfigured profile must never get more than the
 *      free allowance). No DB, no network → unit-tested directly.
 *
 *   2. getScreenUsage({ ownerId }) — IMPERATIVE. Reads the recruiter's plan from
 *      profiles.subscription_plan (flat column the Stripe webhook maintains) and counts
 *      the work_sample_submissions they created in the CURRENT calendar month,
 *      gated by owner_id over THEIR work_samples. Returns the numbers the route
 *      needs to decide whether to allow another send.
 *
 * A "verified screen" is metered at SEND time: creating a submission (assign /
 * invite). That's the unit of value the recruiter pays for.
 */

const { supabaseAdmin } = require('../config/supabase');

// Per-month verified-screen allowance by plan. Growth is unlimited (Infinity).
const PLAN_SCREEN_LIMITS = {
  free: 5,
  startup: 50, // the advertised/sold Startup cap
  growth: Infinity,
};

const DEFAULT_PLAN = 'free';

/**
 * The verified-screens-per-month limit for a plan.
 *
 * PURE. Any plan we don't recognize (null, undefined, '', 'enterprise', a typo,
 * a non-string) resolves to the FREE limit — we fail closed so a missing or
 * malformed subscription can never unlock a higher cap.
 *
 * @param {string} plan  e.g. 'free' | 'startup' | 'growth'
 * @returns {number}     monthly limit (Infinity for unlimited)
 */
function monthlyScreenLimit(plan) {
  if (typeof plan === 'string' && Object.prototype.hasOwnProperty.call(PLAN_SCREEN_LIMITS, plan)) {
    return PLAN_SCREEN_LIMITS[plan];
  }
  return PLAN_SCREEN_LIMITS[DEFAULT_PLAN];
}

/**
 * Read a recruiter's effective plan name from profiles.subscription_plan.
 * Defaults to 'free' when the column or value is unset.
 *
 * NOTE (Phase-2 billing fix): the schema stores the plan in the FLAT column
 * `profiles.subscription_plan` (alongside subscription_status / stripe_customer_id /
 * stripe_subscription_id / current_period_end). Earlier code read a nested `subscription`
 * JSONB column that does NOT exist, so every recruiter resolved to 'free' and a paid upgrade
 * never took effect. The Stripe webhook now writes these same flat columns.
 *
 * @param {string} ownerId  the recruiter's profile id (uuid)
 * @returns {Promise<string>}
 */
async function getPlanForOwner(ownerId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('subscription_plan')
    .eq('id', ownerId)
    .single();
  // No row / read error / no plan → treat as the free tier (fail-closed).
  if (error || !data || !data.subscription_plan) return DEFAULT_PLAN;
  return data.subscription_plan;
}

/** First instant (UTC) of the current calendar month, as an ISO string. */
function startOfCurrentMonthISO(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

/**
 * Count verified screens this recruiter has SENT in the current calendar month.
 *
 * Ownership gate: we first resolve the recruiter's work_sample ids, then count
 * submissions created since the start of the month against ONLY those ids. Read
 * via the service-role client because the count spans rows the recruiter can't
 * see directly under RLS (submissions are candidate-owned), but it is keyed by
 * the recruiter's own work_samples so it stays tenant-scoped.
 *
 * @param {string} ownerId  the recruiter's profile id (uuid)
 * @param {Date}   [now]    injectable clock (tests)
 * @returns {Promise<number>}
 */
async function countScreensThisMonth(ownerId, now = new Date()) {
  const { data: samples, error: e0 } = await supabaseAdmin
    .from('work_samples')
    .select('id')
    .eq('owner_id', ownerId);
  if (e0) throw new Error(`usage count failed (work_samples): ${e0.message}`);
  const ids = (samples || []).map((s) => s.id);
  if (!ids.length) return 0;

  const { count, error: e1 } = await supabaseAdmin
    .from('work_sample_submissions')
    .select('id', { count: 'exact', head: true })
    .in('work_sample_id', ids)
    .gte('created_at', startOfCurrentMonthISO(now));
  if (e1) throw new Error(`usage count failed (submissions): ${e1.message}`);
  return count || 0;
}

/**
 * Resolve everything the enforcement path / usage endpoint needs for a recruiter:
 * their plan, the plan's monthly limit, how many they've used this month, and how
 * many remain.
 *
 * @param {object} args
 * @param {string} args.ownerId  the recruiter's profile id (uuid)
 * @param {Date}   [args.now]    injectable clock (tests)
 * @returns {Promise<{plan:string, limit:number, used:number, remaining:number}>}
 */
async function getScreenUsage({ ownerId, now = new Date() }) {
  const [plan, used] = await Promise.all([
    getPlanForOwner(ownerId),
    countScreensThisMonth(ownerId, now),
  ]);
  const limit = monthlyScreenLimit(plan);
  const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);
  return { plan, limit, used, remaining };
}

module.exports = {
  PLAN_SCREEN_LIMITS,
  DEFAULT_PLAN,
  monthlyScreenLimit,
  getPlanForOwner,
  countScreensThisMonth,
  startOfCurrentMonthISO,
  getScreenUsage,
};
