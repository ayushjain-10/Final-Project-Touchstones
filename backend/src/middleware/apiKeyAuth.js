/**
 * apiKeyAuth — authentication middleware for the PUBLIC Verify API (`/v1`).
 * -------------------------------------------------------------------------
 * Mirrors the shape of supabaseAuth.js, but the credential is an API key
 * (`tsk_(live|test)_...`), not a Supabase session token, and failures use the Verify
 * API error envelope `{ error: { type, message } }` (never leak internals).
 *
 * SECURITY INVARIANT (mirrors supabaseAuth): the presented key IS the capability. We
 * sha256 it and look up `api_keys` by `hashed_key` via the service-role client (the
 * caller has no Supabase session). A not-found / revoked key is a hard 401. The mode
 * encoded in the key prefix MUST match the stored row's mode. On success we attach
 *   req.apiAccount = { accountId, mode, scopes, keyId, db }
 * where `accountId == profiles.id == auth.users.id` and `db` is an account-scoped client
 * (RLS-scoped when SUPABASE_JWT_SECRET is set, else supabaseAdmin — handlers then filter
 * by account explicitly). Nothing here ever hands a raw service-role client to a route
 * that hasn't been account-scoped via apiTenantDb.
 */
const { supabaseAdmin } = require('../config/supabase');
const { hashKey, modeFromKey, apiTenantDb } = require('../services/apiKeyService');

/** Verify API error envelope. Never includes internal error details. */
const authError = (res, message, status = 401) =>
  res.status(status).json({ error: { type: 'auth_error', message } });

/**
 * Extract the raw API key from the request. Accepts:
 *   Authorization: Bearer tsk_...   (preferred)
 *   X-API-Key: tsk_...              (alternative)
 * Returns the key string, or null if absent/malformed.
 */
function extractKey(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) {
    return headerKey.trim();
  }
  return null;
}

const apiKeyAuth = async (req, res, next) => {
  try {
    const presented = extractKey(req);
    if (!presented) {
      return authError(res, 'Missing API key. Provide it as "Authorization: Bearer tsk_..." or "X-API-Key".');
    }

    // Shape check: must be a tsk_(live|test)_ key. Reject anything else as malformed
    // BEFORE touching the DB so we never run a hash lookup for obvious garbage.
    const keyMode = modeFromKey(presented);
    if (!keyMode) {
      return authError(res, 'Malformed API key.');
    }

    // Look up by sha256(plaintext) — keyed by the hash, via the service-role client (the
    // caller has no session). The partial index (revoked_at IS NULL) covers active keys;
    // we still re-check revoked_at below to be explicit and defensive.
    const hashed = hashKey(presented);
    const { data: keyRow, error } = await supabaseAdmin
      .from('api_keys')
      .select('id, account_id, mode, scopes, revoked_at')
      .eq('hashed_key', hashed)
      .maybeSingle();

    if (error) {
      // Don't leak DB internals to the caller; log server-side.
      console.error('apiKeyAuth lookup error:', error.message);
      return authError(res, 'Could not verify API key.', 500);
    }

    if (!keyRow) {
      return authError(res, 'Invalid API key.');
    }
    if (keyRow.revoked_at) {
      return authError(res, 'API key has been revoked.');
    }
    // The mode in the presented prefix MUST match the stored row's mode. A mismatch means
    // a tampered/forged prefix (or data corruption) — reject rather than trust the prefix.
    if (keyRow.mode !== keyMode) {
      return authError(res, 'Invalid API key.');
    }

    // Best-effort last_used_at bump. Never block the request on this write.
    supabaseAdmin
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRow.id)
      .then(({ error: bumpErr }) => {
        if (bumpErr) console.error('apiKeyAuth last_used_at bump failed:', bumpErr.message);
      })
      .catch(() => { /* best effort */ });

    const accountId = keyRow.account_id;
    req.apiAccount = {
      accountId,
      mode: keyRow.mode,
      scopes: Array.isArray(keyRow.scopes) ? keyRow.scopes : [],
      keyId: keyRow.id,
      db: apiTenantDb(accountId),
    };
    return next();
  } catch (err) {
    console.error('apiKeyAuth error:', err);
    return authError(res, 'Could not verify API key.', 500);
  }
};

/**
 * requireScope(scope) — optional per-route scope gate. Use AFTER apiKeyAuth. Responds
 * 403 with the auth-error envelope when the key lacks the scope. A key with no declared
 * scopes is treated as having none (fail closed).
 */
const requireScope = (scope) => (req, res, next) => {
  const scopes = req.apiAccount && Array.isArray(req.apiAccount.scopes)
    ? req.apiAccount.scopes
    : [];
  if (!scopes.includes(scope)) {
    return res.status(403).json({
      error: { type: 'auth_error', message: `Missing required scope: ${scope}` },
    });
  }
  return next();
};

module.exports = { apiKeyAuth, requireScope };
