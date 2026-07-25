/**
 * End-to-end integration smoke for the candidate↔recruiter loop.
 *
 * Drives the REAL HTTP API with REAL user tokens through the whole product path:
 *   recruiter creates a screen → assigns a candidate → candidate sees it in their portal →
 *   opens it (RLS: no rubric leak) → submits → recruiter is notified → score → credential
 *   issued → candidate sees the credential/result → the public verify link resolves.
 * Plus the key negative: a candidate CANNOT author a screen (the role boundary).
 *
 * Scoring + email are intentionally NOT exercised here (run against a local backend with
 * ANTHROPIC_API_KEY and RESEND_API_KEY unset): the score is synthesized via service role so
 * the smoke stays fast, free, deterministic, and side-effect-free. All test rows + auth users
 * are tunnelled through cleanup in a finally{} block.
 *
 * Usage (from backend/):
 *   # terminal 1 — local backend, no email, no AI scoring:
 *   RESEND_API_KEY= ANTHROPIC_API_KEY= USE_SCORING_QUEUE=false PORT=3001 node src/app.js
 *   # terminal 2:
 *   node scripts/smoke-e2e.mjs
 *   # or point at any deployment:  SMOKE_BASE_URL=https://touchstone-api-dev.onrender.com node scripts/smoke-e2e.mjs
 *
 * Reads SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from backend/.env.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { testmailEnabled, testmailAddress, fetchTestmail } from './lib/testmail.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- tiny .env loader (no dependency on dotenv's ESM quirks) ---
function loadEnv() {
  const out = {};
  try {
    const raw = readFileSync(join(__dirname, '..', '.env'), 'utf8');
    for (const line of raw.split('\n')) {
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
const BASE = (env.SMOKE_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');

if (!SUPABASE_URL || !ANON || !SERVICE) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const PASS = '✓', FAIL = '✗';
let failures = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? PASS : FAIL} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
  return ok;
}

// HTTP helper: returns { status, body }.
async function http(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  const text = await res.text();
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

// Mint a real Supabase access token via the GoTrue password grant.
async function mintToken(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`token mint failed for ${email}: ${JSON.stringify(j)}`);
  return j.access_token;
}

const stamp = Date.now();
// Prefer testmail.app (a real, queryable test inbox) so lifecycle emails go somewhere safe + assertable;
// fall back to gmail plus-addressing if testmail isn't configured.
const recTag = `smoke-rec-${stamp}`;
const candTag = `smoke-cand-${stamp}`;
const useTestmail = testmailEnabled();
const recEmail = useTestmail ? testmailAddress(recTag) : `ayushshreeshreemal+${recTag}@gmail.com`;
const candEmail = useTestmail ? testmailAddress(candTag) : `ayushshreeshreemal+${candTag}@gmail.com`;
const PW = `Smoke!${stamp}aB`;
// Opt-in: assert the transactional emails actually arrived (needs the target backend to have email
// enabled, i.e. RESEND_API_KEY set, delivering to testmail). Off by default so the core smoke stays fast.
const ASSERT_EMAIL = useTestmail && /^(1|true|yes)$/i.test(String(process.env.SMOKE_ASSERT_EMAIL || ''));

let recId, candId, wsId, subId, credToken;

async function main() {
  console.log(`\nE2E smoke against ${BASE}\n`);

  // --- 0. health ---
  const h = await http('GET', '/health');
  if (!check('backend health', h.status === 200 && h.body?.ready, JSON.stringify(h.body))) {
    throw new Error('backend not reachable/ready — start it first');
  }

  // --- 1. create + verify a recruiter, create a candidate (service role) ---
  const rec = await admin.auth.admin.createUser({ email: recEmail, password: PW, email_confirm: true });
  recId = rec.data?.user?.id;
  check('recruiter auth user created', !!recId);
  // Promote to a verified recruiter (service role bypasses the self-promotion guard trigger).
  const { error: promoteErr } = await admin.from('profiles')
    .update({ account_type: 'recruiter', recruiter_status: 'verified' }).eq('id', recId);
  check('recruiter promoted to verified', !promoteErr, promoteErr?.message);

  const cand = await admin.auth.admin.createUser({ email: candEmail, password: PW, email_confirm: true });
  candId = cand.data?.user?.id;
  check('candidate auth user created', !!candId);

  const recTok = await mintToken(recEmail, PW);
  const candTok = await mintToken(candEmail, PW);
  check('both tokens minted', !!recTok && !!candTok);

  // --- 2. recruiter creates a screen ---
  const create = await http('POST', '/api/proof/work-samples', {
    token: recTok,
    body: {
      title: `Smoke screen ${stamp}`,
      prompt_md: 'Write a function that returns 1.',
      rubric: { criteria: [{ id: 'c1', requirement: 'Returns 1', points_possible: 10, weight: 1 }] },
      response_type: 'code', languages: ['python'], duration_minutes: 60,
      starter_files: [{ path: 'solution.py', content: 'def solve():\n    pass\n' }],
    },
  });
  wsId = create.body?.id;
  check('recruiter created screen (201)', create.status === 201 && !!wsId, `status ${create.status}`);

  // --- 3. NEGATIVE: a candidate must NOT be able to author a screen (role boundary) ---
  const candAuthor = await http('POST', '/api/proof/work-samples', {
    token: candTok,
    body: { title: 'nope', prompt_md: 'x', rubric: { criteria: [{ id: 'c1', requirement: 'x', points_possible: 1 }] } },
  });
  check('candidate CANNOT author a screen (403)', candAuthor.status === 403, `got ${candAuthor.status}`);

  // --- 4. recruiter assigns the candidate ---
  const assign = await http('POST', `/api/proof/work-samples/${wsId}/assign`, {
    token: recTok, body: { candidate_id: candId },
  });
  subId = assign.body?.id;
  check('recruiter assigned candidate (submission created)', assign.status === 201 && !!subId, `status ${assign.status}`);

  // --- 5. candidate sees it in their portal ---
  const assignments = await http('GET', '/api/portal/assignments', { token: candTok });
  const allItems = Object.values(assignments.body?.groups || {}).flat();
  check('candidate sees the assignment in their portal', allItems.some((i) => i.id === subId), `total ${assignments.body?.total}`);

  // --- 6. candidate opens the screen — RLS must NOT leak the rubric ---
  const open = await http('GET', `/api/proof/submissions/${subId}`, { token: candTok });
  const leakedRubric = open.body?.work_sample && 'rubric' in (open.body.work_sample || {});
  check('candidate can open the screen', open.status === 200 && !!open.body?.work_sample);
  check('rubric is NOT leaked to the candidate', open.status === 200 && !leakedRubric);
  // Start gate (migration 107): opening must NOT start the timer; an explicit start does.
  check('opening does NOT start the timer (start gate)', open.body?.submission?.status === 'assigned' && !open.body?.submission?.deadline_at, open.body?.submission?.status);
  const started = await http('POST', `/api/proof/submissions/${subId}/start`, { token: candTok, body: {} });
  check('explicit start flips to in_progress + stamps deadline', started.status === 200 && started.body?.submission?.status === 'in_progress' && !!started.body?.submission?.deadline_at, `status ${started.status} -> ${started.body?.submission?.status}`);

  // --- 7. candidate submits ---
  const submit = await http('POST', `/api/proof/submissions/${subId}/submit`, {
    token: candTok, body: { response_code: 'def solve():\n    return 1\n' },
  });
  check('candidate submitted (status submitted)', submit.status === 200 && submit.body?.status === 'submitted', `status ${submit.status}`);

  // --- 8. both sides get an in-app notification on submit (best-effort async → wait a beat) ---
  await new Promise((r) => setTimeout(r, 1500));
  const { data: recNotifs } = await admin.from('notifications').select('id').eq('user_id', recId);
  const { data: candNotifs } = await admin.from('notifications').select('id').eq('user_id', candId);
  check('recruiter got a submission notification (bell)', (recNotifs || []).length >= 1, `${(recNotifs || []).length} rows`);
  check('candidate got a "received" notification (bell)', (candNotifs || []).length >= 1, `${(candNotifs || []).length} rows`);

  // --- 9. score: the real scoring pipeline races this script (submit kicks off a background
  // scorer that often lands within a second). Ensure a score exists without assuming who won:
  // try to synthesize, treat a unique-violation as "the live scorer beat us" (not a failure),
  // then READ the score that actually exists and assert against that. Checking-then-inserting
  // would still race in the gap between the two statements.
  const { error: scoreErr } = await admin.from('proof_scores').insert({
    submission_id: subId, rubric_version: 1, prompt_version: 1, model_id: 'smoke', model_version: 'smoke',
    normalized_score: 88, raw_points_awarded: 9, raw_points_possible: 10,
    per_criterion: [{ id: 'c1', points_awarded: 9, points_possible: 10 }], outcome: 'pass',
  });
  const liveWon = !!scoreErr && /duplicate key|unique constraint/i.test(scoreErr.message || '');
  if (scoreErr && !liveWon) check('score synthesized', false, scoreErr.message);
  const { data: finalScores } = await admin.from('proof_scores')
    .select('normalized_score').eq('submission_id', subId).limit(1);
  const expectedScore = (finalScores || [])[0]?.normalized_score;
  check(`score present (${liveWon ? 'live pipeline' : 'synthesized'})`,
    Number.isFinite(Number(expectedScore)), `score ${expectedScore}`);
  await admin.from('work_sample_submissions').update({ status: 'scored' }).eq('id', subId);

  const issue = await http('POST', `/api/credentials/submissions/${subId}/issue`, { token: recTok });
  credToken = issue.body?.public_token;
  check('credential issued (201) via real endpoint', issue.status === 201 && !!credToken, `status ${issue.status}`);

  // --- 10. candidate sees the result + credential in their portal ---
  const results = await http('GET', '/api/portal/results', { token: candTok });
  check('candidate sees the completed result', (results.body?.results || []).some((r) => r.id === subId));
  const creds = await http('GET', '/api/portal/credentials', { token: candTok });
  check('candidate sees their credential w/ verify link',
    (creds.body?.credentials || []).some((c) => c.verify_url && /\/verify\//.test(c.verify_url)));

  // --- 11. the PUBLIC verify link resolves (no auth) ---
  const verify = await http('GET', `/api/credentials/verify/${credToken}`);
  check('public verify resolves valid + score', verify.status === 200 && verify.body?.valid === true && verify.body?.score === expectedScore,
    JSON.stringify(verify.body));

  // --- 12. (opt-in) transactional emails actually arrived — retrieved from testmail ---
  if (ASSERT_EMAIL) {
    console.log('\n  Email assertions (testmail):');
    // Candidate gets up to 4 lifecycle emails (welcome, invite, received, credential); the credential
    // is sent last, so wait for all of them rather than returning on the first match (avoids a race).
    const [recMail, candMail] = await Promise.all([
      fetchTestmail(recTag, { wantCount: 2, timeoutMs: 45000 }),
      fetchTestmail(candTag, { wantCount: 4, timeoutMs: 45000 }),
    ]);
    const subj = (list) => (list || []).map((e) => String(e.subject || ''));
    const recSubjects = subj(recMail);
    const candSubjects = subj(candMail);
    check('recruiter received the "new submission" email', recSubjects.some((s) => /new submission/i.test(s)), recSubjects.join(' | ') || 'none');
    check('candidate received the "submission received" email', candSubjects.some((s) => /received/i.test(s)), candSubjects.join(' | ') || 'none');
    check('candidate received the "credential ready" email', candSubjects.some((s) => /credential/i.test(s)), candSubjects.join(' | ') || 'none');
  } else if (useTestmail) {
    console.log('\n  (email assertions skipped — set SMOKE_ASSERT_EMAIL=1 with an email-enabled backend)');
  }
}

async function cleanup() {
  console.log('\nCleanup:');
  try {
    if (credToken) await admin.from('verified_credentials').delete().eq('public_token', credToken);
    if (subId) {
      await admin.from('proof_scores').delete().eq('submission_id', subId);
      await admin.from('work_sample_submissions').delete().eq('id', subId);
    }
    if (wsId) await admin.from('work_samples').delete().eq('id', wsId);
    if (recId) await admin.auth.admin.deleteUser(recId);
    if (candId) await admin.auth.admin.deleteUser(candId);
    console.log('  test rows + users removed');
  } catch (e) {
    console.log(`  cleanup warning: ${e.message}`);
  }
}

main()
  .catch((e) => { console.error(`\nFATAL: ${e.message}`); failures++; })
  .finally(async () => {
    await cleanup();
    console.log(`\n${failures === 0 ? PASS + ' ALL CHECKS PASSED' : FAIL + ` ${failures} CHECK(S) FAILED`}\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
