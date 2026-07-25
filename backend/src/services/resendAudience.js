'use strict';

/**
 * Resend Audience sync — keeps every user + waitlist signup on the Resend contact list so
 * notifications / broadcasts can reach them.
 *
 * Idempotent and ALWAYS safe: every function is a graceful no-op (returns {skipped:true}) when
 * RESEND_AUDIENCE_ID or an audience-capable key is missing — so wiring it into a signup flow can
 * never break the signup. (The app's default RESEND_API_KEY may be send-only; set
 * RESEND_AUDIENCE_API_KEY to a key with audience permissions, or upgrade RESEND_API_KEY.)
 *
 * Env:
 *   RESEND_AUDIENCE_ID        — the target audience (e.g. "Touchstones — Contacts")
 *   RESEND_AUDIENCE_API_KEY   — Resend key with audience perms (falls back to RESEND_API_KEY)
 */

// Read env lazily so dotenv (loaded in app.js) and tests that set env later both work.
const audienceId = () => process.env.RESEND_AUDIENCE_ID || '';
const apiKey = () => process.env.RESEND_AUDIENCE_API_KEY || process.env.RESEND_API_KEY || '';

function isConfigured() {
  return !!(audienceId() && apiKey());
}

// Derive first/last from whatever the caller has (explicit names win; else split a full name).
function splitName(fullName, firstName, lastName) {
  if (firstName || lastName) return { first: (firstName || '').trim(), last: (lastName || '').trim() };
  const n = String(fullName || '').trim();
  if (!n) return { first: '', last: '' };
  const parts = n.split(/\s+/);
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/**
 * Add (or update) a contact in the audience. Idempotent — a contact that already exists is treated
 * as success. Returns { ok } / { skipped } / { ok:false, error }.
 */
async function upsertContact({ email, fullName, firstName, lastName, unsubscribed = false } = {}) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return { skipped: true, reason: 'invalid email' };
  if (!isConfigured()) return { skipped: true, reason: 'resend audience not configured' };

  const { first, last } = splitName(fullName, firstName, lastName);
  const body = { email: addr, unsubscribed: !!unsubscribed };
  if (first) body.first_name = first;
  if (last) body.last_name = last;

  try {
    const r = await fetch(`https://api.resend.com/audiences/${audienceId()}/contacts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) return { ok: true };
    const d = await r.json().catch(() => ({}));
    // Resend returns a conflict / "already exists" for a duplicate email — that's success for us.
    if (r.status === 409 || /already|exist/i.test(d.message || d.name || '')) return { ok: true, existed: true };
    console.warn('resendAudience: upsert failed', r.status, d.message || d.name || '');
    return { ok: false, error: d.message || `HTTP ${r.status}` };
  } catch (e) {
    console.warn('resendAudience: upsert error', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Mark an existing contact unsubscribed (PATCH by email). Used by the opt-out endpoint so Resend
 * Broadcasts skip the contact too. Graceful no-op when unconfigured or the contact doesn't exist.
 */
async function setUnsubscribed(email) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr) return { skipped: true, reason: 'invalid email' };
  if (!isConfigured()) return { skipped: true, reason: 'resend audience not configured' };
  try {
    const r = await fetch(`https://api.resend.com/audiences/${audienceId()}/contacts/${encodeURIComponent(addr)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ unsubscribed: true }),
    });
    if (r.ok) return { ok: true };
    if (r.status === 404) return { skipped: true, reason: 'contact not found' };
    const d = await r.json().catch(() => ({}));
    console.warn('resendAudience: setUnsubscribed failed', r.status, d.message || d.name || '');
    return { ok: false, error: d.message || `HTTP ${r.status}` };
  } catch (e) {
    console.warn('resendAudience: setUnsubscribed error', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { upsertContact, setUnsubscribed, splitName, isConfigured };
