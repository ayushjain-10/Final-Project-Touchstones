/**
 * cryptoVault — symmetric encryption for secrets we must store at rest (e.g. a customer's
 * outbound Ashby API key). AES-256-GCM (authenticated) with a random 12-byte IV per value.
 *
 * Stored format:  "v1:" + base64( iv[12] || authTag[16] || ciphertext )
 *
 * KEY MATERIAL (32 bytes), in priority order:
 *   1. ASHBY_ENC_KEY  — 64-hex or base64 (32 bytes). The rotatable production key. SET THIS in prod.
 *   2. derived        — sha256("touchstones:ashby-enc:v1:" + SUPABASE_SERVICE_ROLE_KEY). Lets dev
 *                       work with no extra env, without ever using the raw service key as the cipher
 *                       key. NOTE: rotating the service key would orphan values encrypted this way —
 *                       prod should set ASHBY_ENC_KEY explicitly.
 *
 * INVARIANTS: plaintext is NEVER logged. decrypt() throws on tamper (GCM auth) — callers treat a
 * throw as "unusable secret", never as success.
 */
const crypto = require('crypto');

function resolveKey() {
  const raw = (process.env.ASHBY_ENC_KEY || '').trim();
  if (raw) {
    let buf = null;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
    else {
      try { buf = Buffer.from(raw, 'base64'); } catch { buf = null; }
    }
    if (buf && buf.length === 32) return buf;
    // Wrong shape — fall through to derivation rather than silently using a weak key.
  }
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_JWT_SECRET || '';
  if (!secret) {
    throw new Error('cryptoVault: no key material — set ASHBY_ENC_KEY (32-byte hex/base64).');
  }
  return crypto.createHash('sha256').update('touchstones:ashby-enc:v1:' + secret).digest();
}

/** Encrypt a UTF-8 string. Returns the versioned token, or null for empty/nullish input. */
function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', resolveKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v1:' + Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Decrypt a token produced by encrypt(). Returns null for null/blank or unknown-version input;
 *  THROWS if the ciphertext fails authentication (tampered / wrong key). */
function decrypt(stored) {
  if (!stored || typeof stored !== 'string') return null;
  if (!stored.startsWith('v1:')) return null;
  const raw = Buffer.from(stored.slice(3), 'base64');
  if (raw.length < 28) throw new Error('cryptoVault: malformed ciphertext');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', resolveKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Safe display hint for a stored secret — last 4 chars only, never the whole value. */
function maskTail(plaintext, visible = 4) {
  const s = String(plaintext || '');
  if (s.length <= visible) return '•'.repeat(s.length);
  return '••••' + s.slice(-visible);
}

module.exports = { encrypt, decrypt, maskTail };
