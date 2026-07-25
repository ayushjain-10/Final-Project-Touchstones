/**
 * LLM spend guard (SYSTEM_DESIGN.md roadmap #5).
 *
 * Two safety rails checked BEFORE any Anthropic call:
 *   1. a hard per-account daily scoring quota (one tenant can't burn the budget), and
 *   2. a global daily call + estimated-spend ceiling (a runaway loop can't blow the
 *      whole month's budget in an hour).
 *
 * Right-sized for the MVP per the design's "honest framing": at single-digit users on
 * one Render instance an in-process counter is sufficient and adds zero dependencies.
 * When the app scales to multiple instances, swap `buckets` for a shared store
 * (a `processed_events`-style daily row or Redis) — the public surface stays the same.
 */

// Estimated cost per score in USD (Haiku 4.5 with the token diet, per SYSTEM_DESIGN §5).
const EST_COST_PER_SCORE_USD = Number(process.env.AI_EST_COST_PER_SCORE_USD || 0.004);
const PER_ACCOUNT_DAILY_QUOTA = Number(process.env.AI_DAILY_SCORING_QUOTA_PER_ACCOUNT || 200);
const GLOBAL_DAILY_CALL_CEILING = Number(process.env.AI_DAILY_GLOBAL_CALL_CEILING || 5000);
const GLOBAL_DAILY_SPEND_CEILING_USD = Number(process.env.AI_DAILY_GLOBAL_SPEND_CEILING_USD || 5);

// "Master"/test accounts that bypass ALL spend limits (AI_UNLIMITED_ACCOUNT_IDS — comma-separated
// profile ids). They neither count toward the per-account quota nor the global ceilings, so heavy
// testing by a master account can never block real tenants. Parsed once at load.
const UNLIMITED_ACCOUNTS = new Set(
  String(process.env.AI_UNLIMITED_ACCOUNT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

function isUnlimitedAccount(accountId) {
  return Boolean(accountId) && UNLIMITED_ACCOUNTS.has(accountId);
}

let state = { day: null, globalCalls: 0, globalSpend: 0, perAccount: new Map() };

function today() {
  return new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

function rollIfNeeded() {
  const d = today();
  if (state.day !== d) {
    state = { day: d, globalCalls: 0, globalSpend: 0, perAccount: new Map() };
  }
}

/**
 * Reserve budget for one scoring run. Returns { ok, reason, remaining }.
 * If ok is false the caller must NOT call the model.
 * @param {object} opts
 * @param {string} [opts.accountId] tenant/recruiter id for the per-account quota
 * @param {number} [opts.calls] number of model calls this run will make (self-consistency N)
 * @param {number} [opts.estCostUsd] override estimated cost
 */
function reserve({ accountId = 'global', calls = 1, estCostUsd } = {}) {
  rollIfNeeded();
  // Master/test accounts get unlimited AI: never blocked, never counted (so they can't exhaust
  // the shared global budget for everyone else).
  if (isUnlimitedAccount(accountId)) {
    return { ok: true, remaining: Infinity, unlimited: true };
  }
  const cost = typeof estCostUsd === 'number' ? estCostUsd : EST_COST_PER_SCORE_USD;

  if (state.globalCalls + calls > GLOBAL_DAILY_CALL_CEILING) {
    return { ok: false, reason: 'global_daily_call_ceiling', remaining: 0 };
  }
  if (state.globalSpend + cost > GLOBAL_DAILY_SPEND_CEILING_USD) {
    return { ok: false, reason: 'global_daily_spend_ceiling', remaining: 0 };
  }
  const used = state.perAccount.get(accountId) || 0;
  if (used + 1 > PER_ACCOUNT_DAILY_QUOTA) {
    return { ok: false, reason: 'account_daily_quota', remaining: 0 };
  }

  state.globalCalls += calls;
  state.globalSpend += cost;
  state.perAccount.set(accountId, used + 1);
  return {
    ok: true,
    remaining: PER_ACCOUNT_DAILY_QUOTA - (used + 1),
    globalSpendUsd: Math.round(state.globalSpend * 1000) / 1000,
  };
}

function snapshot() {
  rollIfNeeded();
  return {
    day: state.day,
    globalCalls: state.globalCalls,
    globalSpendUsd: Math.round(state.globalSpend * 1000) / 1000,
    limits: {
      perAccountDailyQuota: PER_ACCOUNT_DAILY_QUOTA,
      globalDailyCallCeiling: GLOBAL_DAILY_CALL_CEILING,
      globalDailySpendCeilingUsd: GLOBAL_DAILY_SPEND_CEILING_USD,
      unlimitedAccountCount: UNLIMITED_ACCOUNTS.size,
    },
  };
}

// Test/ops helper.
function _reset() { state = { day: null, globalCalls: 0, globalSpend: 0, perAccount: new Map() }; }

class SpendCeilingError extends Error {
  constructor(reason) {
    super(`LLM spend guard tripped: ${reason}`);
    this.name = 'SpendCeilingError';
    this.reason = reason;
    this.statusCode = 429;
  }
}

module.exports = { reserve, snapshot, SpendCeilingError, _reset, EST_COST_PER_SCORE_USD, isUnlimitedAccount };
