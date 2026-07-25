/**
 * Disposable / throwaway email-domain check.
 *
 * Used to gate SELF-SERVE hiring-team (recruiter) access — the point where a fresh account unlocks
 * the metered E2B/AI abuse surface. It blocks known TEMPORARY-inbox providers only; it is NOT a
 * free-webmail filter (gmail/outlook/etc. are legitimate for small teams and always pass). The list
 * is intentionally small + static (no network lookup) — the goal is to stop trivial abuse, not to
 * be exhaustive. Add domains here as they show up in abuse.
 */

// Reuse the same lightweight shape check used across the app (auth.js, requestDemo.js, join.js).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Known disposable / temporary-inbox domains. Lowercase, apex domains.
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'guerrillamail.net',
  'sharklasers.com', 'grr.la', '10minutemail.com', '10minutemail.net', 'tempmail.com',
  'temp-mail.org', 'tempmail.dev', 'throwaway.email', 'throwawaymail.com', 'yopmail.com',
  'getnada.com', 'nada.email', 'trashmail.com', 'trashmail.de', 'mailnesia.com',
  'dispostable.com', 'maildrop.cc', 'fakeinbox.com', 'mintemail.com', 'mohmal.com',
  'spam4.me', 'discard.email', 'mailcatch.com', 'emailondeck.com', 'moakt.com',
  'tempmailo.com', 'burnermail.io', 'tempmailaddress.com', 'inboxbear.com', 'fakemail.net',
]);

/** Lowercased domain part of an email, or '' if it isn't a well-formed address. */
function emailDomain(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return '';
  return e.slice(e.lastIndexOf('@') + 1);
}

/**
 * True when `email` is a well-formed address whose domain is a known disposable provider.
 * A malformed / empty email returns false here (shape validation is the caller's job) — this
 * helper answers only "is this a throwaway domain".
 */
function isDisposableEmail(email) {
  const domain = emailDomain(email);
  return domain !== '' && DISPOSABLE_DOMAINS.has(domain);
}

module.exports = { isDisposableEmail, emailDomain, DISPOSABLE_DOMAINS };
