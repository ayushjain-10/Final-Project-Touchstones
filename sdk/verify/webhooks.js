/**
 * @touchstones/verify/webhooks — verify the signature on inbound Touchstones webhooks.
 * -----------------------------------------------------------------------------------
 * Node-only (uses node:crypto). Kept in a separate entry so the main client bundles for the
 * browser without pulling crypto in.
 *
 * Touchstones signs every delivery with the header
 *   Touchstones-Signature: t=<unixSeconds>,v1=<hmacSha256Hex>
 * where the HMAC is computed over `${t}.${rawBody}` keyed by the endpoint's signing secret.
 * ALWAYS verify against the RAW request body bytes (before any JSON parsing/re-stringify).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Parse a `t=…,v1=…` header into { t, v1 }. Returns null if malformed. */
function parseSignatureHeader(header) {
  if (typeof header !== 'string') return null;
  const out = {};
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  if (!out.t || !out.v1) return null;
  return out;
}

/**
 * verifyWebhookSignature(rawBody, signatureHeader, secret, opts) → boolean
 *
 * @param {string|Buffer} rawBody          the EXACT raw request body bytes.
 * @param {string}        signatureHeader  the `Touchstones-Signature` header value.
 * @param {string}        secret           the endpoint's signing secret (whsec_…).
 * @param {{ toleranceSeconds?: number }} [opts]  reject timestamps older than this (default 300s; 0 disables).
 * @returns {boolean} true iff the signature is valid (and within tolerance).
 */
export function verifyWebhookSignature(rawBody, signatureHeader, secret, opts = {}) {
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed || !secret) return false;

  const tolerance = opts.toleranceSeconds == null ? 300 : opts.toleranceSeconds;
  if (tolerance > 0) {
    const ts = Number(parsed.t);
    if (!Number.isFinite(ts)) return false;
    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - ts);
    if (ageSeconds > tolerance) return false;
  }

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = createHmac('sha256', String(secret))
    .update(`${parsed.t}.${payload}`)
    .digest('hex');

  // Constant-time compare. Buffers must be equal length for timingSafeEqual.
  const a = Buffer.from(expected, 'hex');
  let b;
  try { b = Buffer.from(parsed.v1, 'hex'); } catch { return false; }
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * constructEvent(rawBody, signatureHeader, secret, opts) → parsed event
 * Verifies the signature, then returns the parsed JSON event. Throws on an invalid signature.
 */
export function constructEvent(rawBody, signatureHeader, secret, opts = {}) {
  if (!verifyWebhookSignature(rawBody, signatureHeader, secret, opts)) {
    const err = new Error('Invalid webhook signature.');
    err.name = 'TouchstonesSignatureError';
    throw err;
  }
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  return JSON.parse(payload);
}

export default { verifyWebhookSignature, constructEvent };
