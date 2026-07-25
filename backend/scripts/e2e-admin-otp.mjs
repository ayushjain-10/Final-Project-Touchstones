#!/usr/bin/env node
/**
 * e2e-admin-otp.mjs — live end-to-end test of the founder admin dashboard OTP flow.
 *
 * Requires ADMIN_EMAIL on the target backend to be a testmail address (pgyu4.<tag>@inbox.testmail.app)
 * so the code can be retrieved via the testmail API. Flow:
 *   1. POST /api/admin/otp/request         → { ok: true }
 *   2. fetch the code from testmail        → 6 digits from the email body
 *   3. POST /api/admin/otp/verify (wrong)  → 401 (negative test)
 *   4. POST /api/admin/otp/verify (right)  → { token }
 *   5. GET  /api/admin/overview (no token) → 401 (negative test)
 *   6. GET  /api/admin/overview (token)    → sections present
 *
 * Dev-only: refuses to run against anything but the dev backend / localhost.
 * Usage: node scripts/e2e-admin-otp.mjs [tag]   (tag defaults to admin-e2e)
 */
import { testmailEnabled, fetchTestmail } from './lib/testmail.mjs';

const BASE = process.env.E2E_BASE_URL || 'https://api.touchstones.ai';
if (!/api\.touchstones\.ai|touchstone-api-dev\.onrender\.com|localhost|127\.0\.0\.1/.test(BASE)) {
  console.error(`Refusing to run against non-dev base: ${BASE}`);
  process.exit(1);
}
if (!testmailEnabled()) {
  console.error('testmail not configured (TESTMAIL_API_KEY / TESTMAIL_NAMESPACE in backend/.env)');
  process.exit(1);
}

const TAG = process.argv[2] || 'admin-e2e';
const results = [];
const check = (name, ok, extra = '') => {
  results.push([name, ok]);
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) finish();
};
function finish() {
  const passed = results.filter(([, ok]) => ok).length;
  console.log(`\n${passed === results.length ? 'ADMIN OTP E2E PASSED ✅' : 'FAILED ❌'} — ${passed}/${results.length}`);
  process.exit(passed === results.length ? 0 : 1);
}

const api = (path, opts = {}) =>
  fetch(`${BASE}/api/admin${path}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

console.log(`ADMIN OTP E2E @ ${BASE}  (inbox tag: ${TAG})\n`);
const since = Date.now();

// 1. request a code
let res = await api('/otp/request', { method: 'POST' });
check('otp/request returns ok', res.status === 200, `http=${res.status}`);

// 2. retrieve the code from testmail
const emails = await fetchTestmail(TAG, { since, wantCount: 1, timeoutMs: 60000 });
const mail = emails[0];
const codeMatch = mail && `${mail.subject}\n${mail.text || ''}\n${mail.html || ''}`.match(/\b(\d{6})\b/);
check('code email received via testmail', Boolean(codeMatch), mail ? `subject="${mail.subject}"` : 'no email');
const code = codeMatch[1];

// 3. wrong code → 401 and does not mint a session
const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
res = await api('/otp/verify', { method: 'POST', body: { code: wrong } });
check('wrong code rejected (401)', res.status === 401, `http=${res.status}`);

// 4. right code → token
res = await api('/otp/verify', { method: 'POST', body: { code } });
const { token } = res.status === 200 ? await res.json() : {};
check('right code mints an admin session', res.status === 200 && Boolean(token), `http=${res.status}`);

// 4b. the code is single-use
res = await api('/otp/verify', { method: 'POST', body: { code } });
check('code is single-use (replay rejected)', res.status === 401, `http=${res.status}`);

// 5. overview without a token → 401
res = await api('/overview');
check('overview without token rejected (401)', res.status === 401, `http=${res.status}`);

// 6. overview with the token → sections
res = await api('/overview', { token });
const data = res.status === 200 ? await res.json() : {};
const sections = ['waitlist', 'users', 'clients', 'apiUsage', 'product', 'reachouts'];
const present = sections.filter((s) => data[s] && !data[s].error);
check(
  'overview returns data sections',
  res.status === 200 && present.length === sections.length,
  `http=${res.status} sections=${present.length}/${sections.length}` +
    (res.status === 200 ? ` users=${data.users?.total ?? '?'} waitlist=${data.waitlist?.total ?? '?'} apiCalls30d=${data.apiUsage?.calls30d ?? '?'}` : ''),
);

finish();
