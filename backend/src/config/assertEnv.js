/**
 * Boot-time secret assertion (SYSTEM_DESIGN.md roadmap #2).
 *
 * The catastrophic auth hole was the combination of a custom-JWT verification
 * branch that handed out the service-role client AND a static `'dev-secret-key'`
 * fallback for JWT_SECRET. The custom-JWT branch is now gone (see supabaseAuth.js);
 * this module kills the weak-secret half: in production we REFUSE TO START unless
 * the trust-critical secrets are present and strong.
 *
 * In non-production (NODE_ENV !== 'production') we only warn, so local dev and the
 * mock-mode test suite (which sets a short JWT_SECRET) keep working. There is no
 * static fallback anywhere in the codebase any more.
 */

// Secrets that, if weak/unset in production, allow tenant-crossing or forgery.
const REQUIRED_STRONG = ['JWT_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'];
// Secrets that must merely be present in production (no length floor).
const REQUIRED_PRESENT = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const MIN_BYTES = 32;

function evaluate(env = process.env) {
  const problems = [];
  for (const key of REQUIRED_STRONG) {
    const v = env[key];
    if (!v) problems.push(`${key} is unset`);
    else if (Buffer.byteLength(v, 'utf8') < MIN_BYTES) {
      problems.push(`${key} is too short (<${MIN_BYTES} bytes) — weak secret`);
    }
  }
  for (const key of REQUIRED_PRESENT) {
    if (!env[key]) problems.push(`${key} is unset`);
  }
  return problems;
}

function assertEnv(env = process.env, { exit = true } = {}) {
  const isProd = env.NODE_ENV === 'production';
  const problems = evaluate(env);
  if (!problems.length) return { ok: true, problems: [] };

  const banner = '[assertEnv] Insecure secret configuration detected:\n  - ' + problems.join('\n  - ');
  if (isProd) {
    // eslint-disable-next-line no-console
    console.error(`${banner}\n[assertEnv] Refusing to start in production. Set strong secrets (>= ${MIN_BYTES} bytes) and restart.`);
    if (exit) process.exit(1);
    return { ok: false, problems };
  }
  // eslint-disable-next-line no-console
  console.warn(`${banner}\n[assertEnv] Allowed in non-production (NODE_ENV=${env.NODE_ENV || 'undefined'}). MUST be fixed before deploying.`);
  return { ok: false, problems };
}

module.exports = assertEnv;
module.exports.evaluate = evaluate;
module.exports.REQUIRED_STRONG = REQUIRED_STRONG;
