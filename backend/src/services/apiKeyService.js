/**
 * apiKeyService — key generation/hashing + per-account tenancy helpers for the Verify API.
 * --------------------------------------------------------------------------------------
 * PURE + unit-testable: nothing here performs I/O. The route layer (apiKeys.js) and the
 * middleware (apiKeyAuth.js) call into this for the security-critical primitives.
 *
 * Key format:  tsk_(live|test)_<base62 of >= 32 CSPRNG bytes>
 *   - 32 bytes of crypto.randomBytes() is ~256 bits of entropy — unguessable.
 *   - base62 (no +/= padding, no - _) keeps the key copy-paste / URL friendly.
 *   - We store ONLY sha256(plaintext) (hex). The plaintext is shown to the user exactly
 *     once at creation and is unrecoverable thereafter.
 *
 * Tenancy (mintAccountJwt + apiTenantDb): see the per-key tenancy note in the spec.
 * Minting a real Supabase JWT requires the project's SUPABASE_JWT_SECRET (dashboard →
 * Settings → API → JWT Secret), which is DISTINCT from this app's own JWT_SECRET. Until
 * it is provided, minting is OFF and `apiTenantDb` falls back to supabaseAdmin — handlers
 * MUST then filter every query by account explicitly (the tenant-isolation test is the
 * safety net).
 *
 * IMPORTANT: the JWT is signed with Node's built-in `crypto` ONLY. The `jsonwebtoken`
 * package crashes on Node 25 (SlowBuffer removal), so it is deliberately NOT used here.
 */
const crypto = require('crypto');
const { supabaseAdmin, createAuthenticatedClient } = require('../config/supabase');

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const MIN_ENTROPY_BYTES = 32;
const VALID_MODES = new Set(['live', 'test']);

/**
 * Encode a Buffer as base62. Big-integer base conversion over the raw bytes, so the
 * full entropy of the input is preserved (no truncation, no modulo bias on the bytes).
 */
function base62Encode(buf) {
  if (!buf || buf.length === 0) return '0';
  // Interpret the bytes as one big base-256 integer and re-express in base 62.
  let digits = [0];
  for (const byte of buf) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const val = digits[i] * 256 + carry;
      digits[i] = val % 62;
      carry = Math.floor(val / 62);
    }
    while (carry > 0) {
      digits.push(carry % 62);
      carry = Math.floor(carry / 62);
    }
  }
  // Preserve leading zero-bytes as leading '0' chars (keeps lengths uniform).
  let out = '';
  for (let i = 0; i < buf.length && buf[i] === 0; i++) out += BASE62[0];
  for (let i = digits.length - 1; i >= 0; i--) out += BASE62[digits[i]];
  return out;
}

/**
 * generateKey(mode) → { plaintext, prefix, last4, mode }
 * plaintext = 'tsk_' + mode + '_' + base62(>=32 CSPRNG bytes).
 * prefix    = the first 12 chars of the plaintext (e.g. 'tsk_live_AbC') — display-only.
 * last4     = last 4 chars of the plaintext — display-only.
 */
function generateKey(mode) {
  if (!VALID_MODES.has(mode)) {
    throw new Error(`invalid key mode: ${mode} (expected 'live' or 'test')`);
  }
  const secret = base62Encode(crypto.randomBytes(MIN_ENTROPY_BYTES));
  const plaintext = `tsk_${mode}_${secret}`;
  const prefix = plaintext.slice(0, 12);
  const last4 = plaintext.slice(-4);
  return { plaintext, prefix, last4, mode };
}

/** hashKey(plaintext) = sha256 hex. The ONLY representation we persist. */
function hashKey(plaintext) {
  return crypto.createHash('sha256').update(String(plaintext)).digest('hex');
}

/**
 * verifyKey(plaintext, hashedKey) → boolean.
 * Constant-time comparison of the freshly-hashed candidate against the stored hash.
 */
function verifyKey(plaintext, hashedKey) {
  if (!plaintext || !hashedKey) return false;
  const a = Buffer.from(hashKey(plaintext), 'hex');
  let b;
  try {
    b = Buffer.from(String(hashedKey), 'hex');
  } catch (_) {
    return false;
  }
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Parse the mode out of a plaintext key prefix. Returns 'live' | 'test' | null. */
function modeFromKey(plaintext) {
  const m = /^tsk_(live|test)_/.exec(String(plaintext || ''));
  return m ? m[1] : null;
}

/** base64url (no padding) — used for the JWT segments. */
function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * mintAccountJwt(accountId) → a short-lived HS256 Supabase JWT, or null if minting is OFF.
 *
 * Built with Node `crypto` ONLY (NOT the jsonwebtoken package — it crashes on Node 25).
 * Claims: { sub: accountId, role:'authenticated', aud:'authenticated', iat, exp:iat+300 }.
 * Signed with process.env.SUPABASE_JWT_SECRET. Returns null when that secret is unset, so
 * callers know to fall back to supabaseAdmin (and filter by account explicitly).
 */
function mintAccountJwt(accountId) {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  const iat = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const claims = {
    sub: accountId,
    role: 'authenticated',
    aud: 'authenticated',
    iat,
    exp: iat + 300,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}

/**
 * apiTenantDb(accountId) → a Supabase client scoped to the account for `/v1` handlers.
 *
 *   - SUPABASE_JWT_SECRET set  → createAuthenticatedClient(mintAccountJwt(accountId)),
 *     a genuinely RLS-scoped client (the minted JWT carries sub=accountId).
 *   - otherwise               → supabaseAdmin (service-role). Handlers MUST then filter
 *     every query by account explicitly; the tenant-isolation test guards this.
 */
function apiTenantDb(accountId) {
  if (process.env.SUPABASE_JWT_SECRET) {
    const token = mintAccountJwt(accountId);
    if (token) return createAuthenticatedClient(token);
  }
  return supabaseAdmin;
}

module.exports = {
  generateKey,
  hashKey,
  verifyKey,
  modeFromKey,
  mintAccountJwt,
  apiTenantDb,
  // exported for tests / reuse
  base62Encode,
  base64url,
};
