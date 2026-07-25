/**
 * Verify POST /api/proof/scores/:id/override — the human score-correction label
 * ("adjust this score" → human_override training data).
 *
 * Drives the REAL HTTP API with REAL user tokens (same conventions as smoke-e2e.mjs):
 *   • the screen OWNER can adjust: human_override/human_reviewer_id/override_reason are
 *     written on the LIVE score row and normalized_score is UNTOUCHED;
 *   • a different (verified) recruiter gets 404 (RLS: cannot see the score);
 *   • the candidate gets 403 (requireRecruiter);
 *   • validation rejects out-of-range / non-integer scores and short/missing reasons;
 *   • a SUPERSEDED score row is rejected 409;
 *   • re-editing an existing adjustment recomposes the reason;
 *   • the export (eval/scoring-eval/export-training-set.js) picks the label up: we run its
 *     exact live-score SELECT and, opt-in (VERIFY_RUN_EXPORT=1), the real export script.
 *
 * All test rows + auth users are created via service role and removed in a finally{}.
 *
 * Usage (from backend/):
 *   # terminal 1 — local backend:
 *   RESEND_API_KEY= ANTHROPIC_API_KEY= USE_SCORING_QUEUE=false PORT=3001 node src/app.js
 *   # terminal 2:
 *   node scripts/verify-score-override.mjs
 *   # or point at any deployment: SMOKE_BASE_URL=... node scripts/verify-score-override.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

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
const PW = `Verify!${stamp}aB`;
const ownerEmail = `ayushshreeshreemal+ovr-own-${stamp}@gmail.com`;
const otherEmail = `ayushshreeshreemal+ovr-oth-${stamp}@gmail.com`;
const candEmail = `ayushshreeshreemal+ovr-cnd-${stamp}@gmail.com`;

let ownerId, otherId, candId, wsId, subId, liveScoreId, oldScoreId;

async function main() {
  console.log(`\nScore-override verify against ${BASE}\n`);

  const h = await http('GET', '/health');
  if (!check('backend health', h.status === 200 && h.body?.ready, JSON.stringify(h.body))) {
    throw new Error('backend not reachable/ready — start it first');
  }

  // --- 1. users: owner + other recruiter (both verified) + candidate ---
  for (const [email, promote] of [[ownerEmail, true], [otherEmail, true], [candEmail, false]]) {
    const u = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
    const id = u.data?.user?.id;
    if (!id) throw new Error(`createUser failed for ${email}: ${u.error?.message}`);
    if (email === ownerEmail) ownerId = id;
    if (email === otherEmail) otherId = id;
    if (email === candEmail) candId = id;
    if (promote) {
      const { error } = await admin.from('profiles')
        .update({ account_type: 'recruiter', recruiter_status: 'verified' }).eq('id', id);
      if (error) throw new Error(`promote failed for ${email}: ${error.message}`);
    }
  }
  check('users created (owner + other recruiter verified, candidate)', !!(ownerId && otherId && candId));

  // --- 2. screen + scored submission + a LIVE and a SUPERSEDED score (service role) ---
  const { data: ws, error: eWs } = await admin.from('work_samples').insert({
    owner_id: ownerId, title: `Override verify ${stamp}`, prompt_md: 'Return 1.',
    rubric: { criteria: [{ id: 'c1', requirement: 'Returns 1', points_possible: 10, weight: 1 }] },
    status: 'published',
  }).select().single();
  if (eWs) throw new Error(`work_samples insert: ${eWs.message}`);
  wsId = ws.id;
  const now = new Date().toISOString();
  const { data: sub, error: eSub } = await admin.from('work_sample_submissions').insert({
    work_sample_id: wsId, candidate_id: candId, status: 'scored',
    started_at: now, submitted_at: now, response_code: 'def solve():\n    return 1\n',
  }).select().single();
  if (eSub) throw new Error(`submission insert: ${eSub.message}`);
  subId = sub.id;
  const scoreRow = {
    submission_id: subId, rubric_version: 1, prompt_version: 1, model_id: 'verify', model_version: 'verify',
    normalized_score: 62, raw_points_awarded: 6.2, raw_points_possible: 10,
    per_criterion: [{ id: 'c1', points_awarded: 6.2, points_possible: 10 }], outcome: 'review',
  };
  const { data: live, error: eLive } = await admin.from('proof_scores').insert(scoreRow).select().single();
  if (eLive) throw new Error(`live score insert: ${eLive.message}`);
  liveScoreId = live.id;
  const { data: old, error: eOld } = await admin.from('proof_scores')
    .insert({ ...scoreRow, normalized_score: 55, superseded_by: liveScoreId }).select().single();
  if (eOld) throw new Error(`superseded score insert: ${eOld.message}`);
  oldScoreId = old.id;
  check('screen + submission + live/superseded scores seeded', !!(liveScoreId && oldScoreId));

  const ownerTok = await mintToken(ownerEmail, PW);
  const otherTok = await mintToken(otherEmail, PW);
  const candTok = await mintToken(candEmail, PW);

  // --- 3. validation is rejected BEFORE any write ---
  const v1 = await http('POST', `/api/proof/scores/${liveScoreId}/override`, {
    token: ownerTok, body: { human_score: 101, override_reason: 'a perfectly valid reason here' } });
  check('out-of-range score (101) → 400', v1.status === 400, `got ${v1.status}`);
  const v2 = await http('POST', `/api/proof/scores/${liveScoreId}/override`, {
    token: ownerTok, body: { human_score: 7.5, override_reason: 'a perfectly valid reason here' } });
  check('non-integer score (7.5) → 400', v2.status === 400, `got ${v2.status}`);
  const v3 = await http('POST', `/api/proof/scores/${liveScoreId}/override`, {
    token: ownerTok, body: { human_score: 70, override_reason: 'too short' } });
  check('short reason (<10 chars) → 400', v3.status === 400, `got ${v3.status}`);
  const v4 = await http('POST', `/api/proof/scores/${liveScoreId}/override`, {
    token: ownerTok, body: { human_score: 70 } });
  check('missing reason → 400', v4.status === 400, `got ${v4.status}`);

  // --- 4. tenancy + role boundaries ---
  const other = await http('POST', `/api/proof/scores/${liveScoreId}/override`, {
    token: otherTok, body: { human_score: 70, override_reason: 'not my screen, should not work' } });
  check('non-owner recruiter → 404 (RLS: cannot see the score)', other.status === 404, `got ${other.status}`);
  const cand = await http('POST', `/api/proof/scores/${liveScoreId}/override`, {
    token: candTok, body: { human_score: 100, override_reason: 'candidate should never do this' } });
  check('candidate → 403 (requireRecruiter)', cand.status === 403, `got ${cand.status}`);

  // --- 5. superseded row is not a label target ---
  const sup = await http('POST', `/api/proof/scores/${oldScoreId}/override`, {
    token: ownerTok, body: { human_score: 70, override_reason: 'this row was already re-scored' } });
  check('superseded score → 409', sup.status === 409, `got ${sup.status}`);

  // --- 6. owner adjusts the live score ---
  const reason = 'Model under-credited the error handling; the retry path is actually correct.';
  const ok1 = await http('POST', `/api/proof/scores/${liveScoreId}/override`, {
    token: ownerTok, body: { human_score: 78, override_reason: reason } });
  check('owner override → 200', ok1.status === 200, `got ${ok1.status} ${JSON.stringify(ok1.body)}`);
  check('response: human_override=true + reviewer stamped',
    ok1.body?.human_override === true && ok1.body?.human_reviewer_id === ownerId);
  check('response: reason composed with adjusted + model values',
    ok1.body?.override_reason === `Adjusted to 78/100 (model scored 62): ${reason}`);
  check('response: normalized_score UNTOUCHED (still the model\'s 62)', ok1.body?.normalized_score === 62);

  const { data: persisted } = await admin.from('proof_scores')
    .select('human_override, human_reviewer_id, override_reason, normalized_score, superseded_by')
    .eq('id', liveScoreId).single();
  check('persisted: label on the live row, model score intact',
    persisted?.human_override === true && persisted?.human_reviewer_id === ownerId &&
    persisted?.normalized_score === 62 && persisted?.superseded_by === null,
    JSON.stringify(persisted));

  // --- 7. re-editing recomposes the reason ---
  const ok2 = await http('POST', `/api/proof/scores/${liveScoreId}/override`, {
    token: ownerTok, body: { human_score: 81, override_reason: 'On reflection the tests cover the edge case too.' } });
  check('re-edit → 200 with recomposed reason', ok2.status === 200 &&
    ok2.body?.override_reason === 'Adjusted to 81/100 (model scored 62): On reflection the tests cover the edge case too.',
    ok2.body?.override_reason);

  // --- 8. the training-set export picks the label up ---
  // (a) the exact live-score SELECT export-training-set.js runs:
  const { data: exportRows } = await admin.from('proof_scores')
    .select('id, submission_id, normalized_score, human_override, override_reason')
    .is('superseded_by', null).not('normalized_score', 'is', null)
    .eq('submission_id', subId);
  check('export SELECT sees exactly ONE live row for the submission, labeled',
    exportRows?.length === 1 && exportRows[0].human_override === true &&
    /^Adjusted to 81\/100 \(model scored 62\): /.test(exportRows[0].override_reason || ''));
  // (b) opt-in: run the REAL export and grep our row (writes eval/scoring-eval/training-set.jsonl).
  if (/^(1|true|yes)$/i.test(String(env.VERIFY_RUN_EXPORT || ''))) {
    const r = spawnSync('node', [join(__dirname, '..', 'eval', 'scoring-eval', 'export-training-set.js')], {
      encoding: 'utf8', env: { ...process.env, EXPORT_POOL_LIMIT: '50' }, timeout: 120000,
    });
    const jsonl = (() => {
      try { return readFileSync(join(__dirname, '..', 'eval', 'scoring-eval', 'training-set.jsonl'), 'utf8'); }
      catch { return ''; }
    })();
    const row = jsonl.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((x) => x.submission_id === subId);
    check('REAL export run contains the labeled row',
      r.status === 0 && !!row && row.human_override === true && /^Adjusted to 81\/100/.test(row.override_reason || ''),
      row ? `human_override=${row.human_override}` : `exit ${r.status}`);
  } else {
    console.log('  (set VERIFY_RUN_EXPORT=1 to also run the real export-training-set.js)');
  }
}

async function cleanup() {
  console.log('\nCleanup:');
  try {
    if (subId) {
      if (oldScoreId) await admin.from('proof_scores').update({ superseded_by: null }).eq('id', oldScoreId); // release the FK
      await admin.from('proof_scores').delete().eq('submission_id', subId);
      await admin.from('work_sample_submissions').delete().eq('id', subId);
    }
    if (wsId) await admin.from('work_samples').delete().eq('id', wsId);
    for (const id of [ownerId, otherId, candId]) if (id) await admin.auth.admin.deleteUser(id);
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
