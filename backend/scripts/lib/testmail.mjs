/**
 * Tiny testmail.app client for the test scripts. testmail gives us a real inbox we can send the
 * product's transactional emails to (Resend delivers to pgyu4.<tag>@inbox.testmail.app) and then
 * RETRIEVE + assert via its JSON API — so the smoke can verify the email workflow end-to-end
 * without sending to a real inbox.
 *
 * Config comes from backend/.env (gitignored): TESTMAIL_API_KEY, TESTMAIL_NAMESPACE.
 * The API key is a secret — never hardcode it; this reads it from the environment only.
 *
 *   import { testmailEnabled, testmailAddress, fetchTestmail } from './lib/testmail.mjs'
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(join(__dirname, '..', '..', '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* fall through to process.env */ }
  return { ...out, ...process.env };
}
const env = loadEnv();
const API_KEY = env.TESTMAIL_API_KEY || '';
const NAMESPACE = env.TESTMAIL_NAMESPACE || '';

export function testmailEnabled() {
  return Boolean(API_KEY && NAMESPACE);
}

// The inbox address for a tag → pgyu4.<tag>@inbox.testmail.app. Tags are arbitrary; everything sent
// to a tag is retrievable by querying that tag.
export function testmailAddress(tag) {
  return `${NAMESPACE}.${tag}@inbox.testmail.app`;
}

// Fetch emails for a tag. Uses livequery to long-poll until at least `wantCount` emails (matching the
// optional timestamp_from) arrive, or the timeout elapses. Returns the emails array (possibly empty).
export async function fetchTestmail(tag, { since = 0, wantCount = 1, timeoutMs = 30000 } = {}) {
  if (!testmailEnabled()) throw new Error('testmail not configured (TESTMAIL_API_KEY / TESTMAIL_NAMESPACE)');
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    const url = new URL('https://api.testmail.app/api/json');
    url.searchParams.set('apikey', API_KEY);
    url.searchParams.set('namespace', NAMESPACE);
    url.searchParams.set('tag', tag);
    if (since) url.searchParams.set('timestamp_from', String(since));
    url.searchParams.set('livequery', 'true'); // long-polls up to ~10s server-side for new mail
    url.searchParams.set('limit', '20');
    const res = await fetch(url, { signal: AbortSignal.timeout(Math.min(15000, Math.max(1000, deadline - Date.now()))) }).catch(() => null);
    if (res && res.ok) {
      const json = await res.json().catch(() => null);
      last = (json && Array.isArray(json.emails)) ? json.emails : [];
      if (last.length >= wantCount) return last;
    }
    // brief gap before the next long-poll cycle
    await new Promise((r) => setTimeout(r, 1000));
  }
  return last;
}

// Convenience: did an email whose subject matches `re` arrive for this tag?
export async function waitForSubject(tag, re, opts = {}) {
  const emails = await fetchTestmail(tag, { wantCount: opts.wantCount || 1, ...opts });
  return emails.find((e) => re.test(String(e.subject || '')));
}
