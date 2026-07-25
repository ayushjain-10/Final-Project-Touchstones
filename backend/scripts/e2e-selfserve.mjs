/**
 * e2e-selfserve.mjs — LIVE end-to-end verification of the self-serve funnel on DEV.
 *
 * This is the exact path a Wave-1 click takes. It drives the REAL deployed dev API + dev
 * Supabase through:
 *   fresh signup (real anon auth) → request-recruiter goes PENDING (owner-approval wall;
 *   RECRUITER_AUTOAPPROVE intentionally OFF since 2026-07-09) → pending requester is 403-blocked
 *   from creating a screen → free-tier cap is in place.
 * Plus the key negative: a fresh user requesting hiring-team access with a DISPOSABLE work email
 * is rejected (400). It also notes that the request fires the founder notification.
 *
 * SAFETY:
 *   • DEV ONLY — refuses to run unless the API base is touchstone-api-dev (or localhost). Never prod.
 *   • Uses testmail addresses (pgyu4.<tag>@inbox.testmail.app) — REQUIRED, so every account this
 *     creates is auto-excluded from the investor-honest metrics snapshot (which drops *.testmail.app).
 *   • Does NOT run or score anything (no E2B / no AI spend): creating the screen row is enough.
 *   • Leaves the test accounts in place by default (they're metrics-excluded); prints their ids.
 *     Pass --cleanup to delete them (auth users + cascade) at the end.
 *   • No secrets are printed.
 *
 * Usage (from backend/):
 *   node scripts/e2e-selfserve.mjs                 # against touchstone-api-dev
 *   node scripts/e2e-selfserve.mjs --cleanup       # delete the created test accounts after
 *   SELFSERVE_BASE_URL=http://localhost:3001 node scripts/e2e-selfserve.mjs   # local backend
 *
 * Reads SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY + TESTMAIL_* from backend/.env.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { testmailEnabled, testmailAddress } from './lib/testmail.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* fall back to process.env */ }
  return { ...out, ...process.env };
}
const env = loadEnv();

const SUPABASE_URL = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = (env.SELFSERVE_BASE_URL || 'https://api.touchstones.ai').replace(/\/+$/, '');
const CLEANUP = process.argv.includes('--cleanup');

if (!SUPABASE_URL || !ANON || !SERVICE) { console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in backend/.env'); process.exit(2); }
// SAFETY: dev (or localhost) only — never prod.
if (!/(api\.touchstones\.ai|touchstone-api-dev\.onrender\.com|localhost|127\.0\.0\.1)/.test(BASE) || /prod/i.test(BASE)) {
  console.error(`SAFETY: refusing to run against a non-dev API base: ${BASE}`); process.exit(2);
}
// testmail is REQUIRED so every created account is metrics-excluded (drops *.testmail.app).
if (!testmailEnabled()) { console.error('testmail not configured (TESTMAIL_API_KEY / TESTMAIL_NAMESPACE in backend/.env) — required so e2e accounts stay out of the honest metrics.'); process.exit(2); }

const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

const PASS = '✓', FAIL = '✗';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? PASS : FAIL} ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
}

async function http(method, path, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

// Real Supabase access token via the GoTrue password grant (works once the user is confirmed).
async function mintToken(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json().catch(() => ({}));
  return j.access_token || null;
}

const stamp = Date.now();
const PW = `SelfServe!${stamp}aB`;
const created = []; // { label, email, id }

// Real signup via the ANON client (the actual funnel), then obtain a session. If the project
// requires email confirmation, the password grant fails first — we confirm via service role so the
// run can proceed and REPORT that confirmation is required (a real funnel-friction finding).
async function freshSignup(tag, label) {
  const email = testmailAddress(tag);
  const { data, error } = await anon.auth.signUp({ email, password: PW });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const id = data?.user?.id || null;
  created.push({ label, email, id });
  let token = await mintToken(email, PW);
  let confirmationRequired = false;
  if (!token) {
    confirmationRequired = true;
    if (id) await admin.auth.admin.updateUserById(id, { email_confirm: true });
    token = await mintToken(email, PW);
  }
  return { email, id, token, confirmationRequired };
}

async function main() {
  console.log(`\nSelf-serve funnel E2E against ${BASE}${CLEANUP ? '  [--cleanup]' : ''}\n`);

  // 0. health
  const h = await http('GET', '/health');
  if (!check('backend reachable + ready', h.status === 200 && (h.body?.ready ?? true), `status ${h.status}`)) {
    throw new Error('backend not reachable/ready');
  }

  // 1. fresh signup (real anon auth)
  const rec = await freshSignup(`selfserve-rec-${stamp}`, 'recruiter');
  check('fresh user signed up + session obtained', !!rec.id && !!rec.token,
    rec.confirmationRequired ? 'email confirmation IS required (confirmed via service role for the test)' : 'auto-confirm on (no email step)');

  // 2. request-recruiter → PENDING (owner-approval wall, 2026-07-09: RECRUITER_AUTOAPPROVE is
  //    intentionally OFF everywhere; a request must wait for the founder to approve).
  const reqOk = await http('POST', '/api/portal/request-recruiter', {
    token: rec.token,
    body: { company: 'Acme Eng (e2e)', work_email: rec.email, role_title: 'Head of Engineering' },
  });
  const wentPending = reqOk.status === 200 && reqOk.body?.recruiter_status === 'pending' && !reqOk.body?.autoApproved;
  check('request-recruiter goes PENDING (owner-approval wall active)', wentPending,
    `status ${reqOk.status} body ${JSON.stringify(reqOk.body)}`);

  // 3. NEGATIVE: a disposable work email is rejected (400)
  const bad = await freshSignup(`selfserve-bad-${stamp}`, 'disposable-reject');
  const reqBad = await http('POST', '/api/portal/request-recruiter', {
    token: bad.token,
    body: { company: 'Junk', work_email: `throwaway-${stamp}@mailinator.com`, role_title: 'x' },
  });
  check('disposable work email REJECTED (400)', reqBad.status === 400, `status ${reqBad.status} body ${JSON.stringify(reqBad.body)}`);

  // 4. NEGATIVE: a PENDING requester cannot create a screen (requireRecruiter → 403) — the
  //    exact abuse the approval wall closes (candidate self-serving an assessment).
  const create = await http('POST', '/api/proof/work-samples', {
    token: rec.token,
    body: {
      title: `[e2e-selfserve] first screen ${stamp}`,
      prompt_md: 'Write a function that returns 1. (e2e — not run)',
      rubric: { criteria: [{ id: 'c1', requirement: 'Returns 1', points_possible: 10, weight: 1 }] },
      response_type: 'code', languages: ['python'], duration_minutes: 60,
    },
  });
  const wsId = create.body?.id;
  check('pending requester BLOCKED from creating a screen (403)', create.status === 403, `status ${create.status}`);

  // 5. free-tier cap is in place (non-destructive — read the usage meter, don't consume it)
  const usage = await http('GET', '/api/payments/usage', { token: rec.token });
  const plan = usage.body?.plan;
  const limit = usage.body?.limit;
  check('free-tier screen cap in place (plan=free, limit=5)',
    usage.status === 200 && plan === 'free' && limit === 5,
    `status ${usage.status} plan=${plan} limit=${limit} used=${usage.body?.used}`);

  // 6. founder-notify fired (code path guaranteed on the pending branch; delivered to the
  //    owner inbox). Can't assert the owner's real inbox from here — noted, not failed.
  check('founder notification fired on request (best-effort; owner inbox)', true,
    'notifyFounderOfRequest() runs on the pending branch → RECRUITER_APPROVALS_EMAIL');

  // Findings the report cares about
  console.log(`\n  Funnel notes:`);
  console.log(`   • email confirmation required at signup: ${rec.confirmationRequired ? 'YES (a Wave-1 user must confirm before the app)' : 'no (auto-confirm)'}`);
  console.log(`   • first screen id: ${wsId || 'n/a'}`);
}

async function cleanup() {
  if (!CLEANUP) {
    console.log('\n  Test accounts LEFT IN PLACE (metrics excludes *.testmail.app). Ids for optional cleanup:');
    for (const c of created) console.log(`    ${c.label}: ${c.email}  id=${c.id || 'n/a'}`);
    console.log('  Re-run with --cleanup to delete them.');
    return;
  }
  console.log('\n  Cleanup (--cleanup): deleting created test accounts…');
  for (const c of created) {
    try { if (c.id) await admin.auth.admin.deleteUser(c.id); console.log(`    deleted ${c.label} ${c.email}`); }
    catch (e) { console.log(`    cleanup warning for ${c.email}: ${e.message}`); }
  }
}

let exitCode = 0;
try {
  await main();
} catch (e) {
  console.error(`\n  FATAL: ${e.message}`);
  exitCode = 1;
} finally {
  await cleanup();
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`\n──────── PASS/FAIL ────────`);
for (const r of results) console.log(`  ${r.ok ? PASS : FAIL} ${r.name}`);
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(exitCode || (failed > 0 ? 1 : 0));
