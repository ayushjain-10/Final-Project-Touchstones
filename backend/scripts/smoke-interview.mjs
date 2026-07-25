#!/usr/bin/env node
/**
 * smoke-interview — full dress rehearsal of the real candidate interview journey against a
 * deployed backend, exercising exactly what a linked candidate hits, in order:
 *
 *   fresh signup -> ?ws self-assign -> dashboard -> no-leak checks (rubric/tests) -> start gate
 *   -> /run on starter (visible cases fail) -> /run on a working solution (visible cases pass)
 *   -> ai-assist chat -> integrity events -> submit -> background full hidden suite (E2B)
 *   -> AI score (exec-grounded) -> candidate-visible result on /portal/results.
 *
 * Runs TWO candidates per screen: one submitting a correct solution (expects all hidden tests
 * green + a high grounded score) and one submitting a plausibly-buggy solution (expects the
 * hidden discriminator cases to fail + partial credit). Screens are addressed by id.
 *
 * Usage (from backend/):
 *   node scripts/smoke-interview.mjs --screen <ws_id>:<good_file>:<bad_file> [--screen ...]
 *   SMOKE_BASE_URL=https://api.touchstones.ai node scripts/smoke-interview.mjs ...
 *   --keep  leaves the mock candidates/submissions in place (default cleans them up)
 *
 * Env (backend/.env or process.env): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * TESTMAIL_NAMESPACE (candidate addresses are metrics-excluded testmail ones).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i > 0 && !line.startsWith('#')) out[line.slice(0, i)] = line.slice(i + 1);
    }
  } catch { /* env-only */ }
  return { ...out, ...process.env };
}
const env = loadEnv();
const BASE = env.SMOKE_BASE_URL || 'https://api.touchstones.ai';
if (/prod/i.test(BASE) || /touchstones\.ai\/?$/.test(BASE.replace('api.', 'X.')) === false && false) { /* placeholder */ }
if (!/^https?:\/\/(api\.touchstones\.ai|touchstone-api-dev\.onrender\.com|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)/.test(BASE)) {
  console.error(`refusing unfamiliar base URL: ${BASE}`);
  process.exit(2);
}
const NS = env.TESTMAIL_NAMESPACE;
if (!NS) { console.error('TESTMAIL_NAMESPACE required (metrics-excluded candidates)'); process.exit(2); }

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
let failures = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

async function http(method, p, token, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body: json };
}

async function freshCandidate(tag) {
  const email = `${NS}.${tag}@inbox.testmail.app`;
  const password = `Interview!${Math.random().toString(36).slice(2, 10)}A1`;
  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signUp({ email, password });
  if (error) throw new Error(`signup ${email}: ${error.message}`);
  let token = data?.session?.access_token;
  if (!token) {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    token = (await r.json()).access_token;
  }
  if (!token) throw new Error(`no session for ${email} (email confirmation on?)`);
  return { email, id: data.user.id, token };
}

async function waitFor(label, fn, { timeoutMs = 180000, everyMs = 5000 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, everyMs));
    process.stdout.write(`     … waiting on ${label} (${Math.round((Date.now() - start) / 1000)}s)\r`);
  }
}

async function runCandidate({ screenId, screen, cand, solution, entry, label, expect }) {
  console.log(`\n== ${screen.title} :: ${label} (${cand.email})`);

  // ?ws link path: self-assign, exactly what Candidate.jsx does on arrival.
  const assign = await http('POST', `/api/proof/work-samples/${screenId}/assign`, cand.token, { candidate_id: cand.id });
  check(`${label}: self-assign via link`, assign.status === 201 || assign.status === 200, JSON.stringify(assign.body)?.slice(0, 200));
  const subId = assign.body?.id;
  if (!subId) return null;

  const dash = await http('GET', '/api/portal/assignments', cand.token);
  const inPending = JSON.stringify(dash.body || {}).includes(subId);
  check(`${label}: appears on dashboard`, dash.status === 200 && inPending);

  // No-leak: candidate task payload must never contain the rubric or the test definitions.
  const load = await http('GET', `/api/proof/submissions/${subId}`, cand.token);
  const ws = load.body?.work_sample || {};
  check(`${label}: task loads`, load.status === 200 && typeof ws.prompt_md === 'string' && ws.prompt_md.length > 100);
  check(`${label}: rubric not leaked`, !('rubric' in ws) && !JSON.stringify(load.body).includes('candidate_results_visible'));
  check(`${label}: tests not leaked`, !('tests' in ws) && !('reference_solution' in ws) && !('baseline' in ws));
  check(`${label}: starter files present`, Array.isArray(ws.starter_files) && ws.starter_files.length >= 1);
  check(`${label}: languages declared`, Array.isArray(ws.languages) && ws.languages.length >= 1);
  check(`${label}: timer not started at assign`, !load.body?.submission?.deadline_at);

  // Start gate: stamps started_at + deadline_at = now + duration.
  const start = await http('POST', `/api/proof/submissions/${subId}/start`, cand.token, {});
  const started = start.body?.submission || {};
  const dl = started.deadline_at && started.started_at
    ? (new Date(started.deadline_at) - new Date(started.started_at)) / 60000 : null;
  check(`${label}: start stamps ${screen.duration_minutes}-min deadline`, start.status === 200 && Math.abs(dl - screen.duration_minutes) < 1, `delta=${dl}`);

  // Run on the untouched starter: sample mode, only visible cases, and they FAIL.
  const runStarter = await http('POST', `/api/proof/submissions/${subId}/run`, cand.token, {
    files: [{ path: ws.starter_files[0].path, content: ws.starter_files[0].content }],
  });
  const rs = runStarter.body || {};
  const starterVisibleOnly = Array.isArray(rs.cases) && rs.cases.every((c) => c.visible === true);
  check(`${label}: starter run executes sample cases`, runStarter.status === 200 && rs.ran === true && rs.kind === 'cases', JSON.stringify(rs).slice(0, 300));
  check(`${label}: run exposes only visible cases`, starterVisibleOnly, JSON.stringify(rs.cases || []).slice(0, 200));
  check(`${label}: starter fails the samples`, rs.passedCount === 0);

  // Run on this candidate's actual solution: visible cases should reflect its quality.
  const runSol = await http('POST', `/api/proof/submissions/${subId}/run`, cand.token, {
    files: [{ path: entry, content: solution }],
  });
  const rr = runSol.body || {};
  check(`${label}: solution run visible ${expect.visiblePassed}/${expect.visibleTotal}`,
    runSol.status === 200 && rr.passedCount === expect.visiblePassed && rr.total === expect.visibleTotal,
    `got ${rr.passedCount}/${rr.total}`);

  // In-IDE AI assistant: one real exchange, transcript logged server-side.
  const ai = await http('POST', `/api/proof/submissions/${subId}/ai-assist`, cand.token, {
    message: 'In one sentence: what is the trickiest edge case in this task?',
    code: solution, language: ws.languages[0],
  });
  check(`${label}: ai-assist replies`, ai.status === 200 && typeof ai.body?.reply === 'string' && ai.body.reply.length > 10, JSON.stringify(ai.body).slice(0, 200));

  // Integrity events so the proof-of-human digest has substance.
  const ev = await http('POST', '/api/integrity/events', cand.token, {
    submission_id: subId,
    events: [
      { type: 'session_submit', category: 'behavior', meta: { typed_chars: solution.length, paste_chars: 0, final_chars: solution.length }, client_ts: new Date().toISOString() },
    ],
  });
  check(`${label}: integrity events accepted`, ev.status === 201);

  // Submit with the path header the multi-language frontend now always sends for single files,
  // so the backend names (and harnesses) the file by the candidate's actual language.
  const submit = await http('POST', `/api/proof/submissions/${subId}/submit`, cand.token, {
    response_code: `/* ===== ${entry} ===== */\n${solution}`,
  });
  check(`${label}: submit accepted`, submit.status === 200 && submit.body?.status === 'submitted');

  // Background pipeline: full hidden suite lands in test_results, then the grounded AI score.
  const tests = await waitFor('hidden test run', async () => {
    const { data } = await admin.from('work_sample_submissions').select('test_results').eq('id', subId).single();
    return data?.test_results?.ran ? data.test_results : null;
  });
  check(`${label}: hidden suite ran (${expect.hiddenPassed}/${expect.hiddenTotal})`,
    tests && tests.passedCount === expect.hiddenPassed && tests.total === expect.hiddenTotal,
    tests ? `got ${tests.passedCount}/${tests.total} spoof=${tests.spoof_suspected}` : 'timed out');

  const score = await waitFor('AI score', async () => {
    const { data } = await admin.from('proof_scores')
      .select('normalized_score, outcome, overall_explanation, per_criterion, correctness_ratio')
      .eq('submission_id', subId).is('superseded_by', null).limit(1);
    return data && data[0] ? data[0] : null;
  });
  check(`${label}: score produced`, Boolean(score), 'scoring timed out (check spend guard / grader)');
  if (score) {
    const corr = (score.per_criterion || []).find((c) => c.id === 'correctness');
    const expectedRatio = expect.hiddenPassed / expect.hiddenTotal;
    check(`${label}: correctness grounded to hidden tests`,
      corr && Math.abs(corr.points_awarded - Math.round(expectedRatio * corr.points_possible)) <= 1,
      `awarded ${corr?.points_awarded}/${corr?.points_possible}, ratio ${score.correctness_ratio}`);
    check(`${label}: explanation present`, typeof score.overall_explanation === 'string' && score.overall_explanation.length > 40);
    check(`${label}: score in expected band [${expect.scoreMin}, ${expect.scoreMax}]`,
      score.normalized_score >= expect.scoreMin && score.normalized_score <= expect.scoreMax,
      `got ${score.normalized_score}`);
  }

  // Candidate-visible result: the new /portal/results contract.
  const portal = await http('GET', '/api/portal/results', cand.token);
  const mine = (portal.body?.results || []).find((r) => r.id === subId);
  check(`${label}: portal result visible`, Boolean(mine) && mine.results_visibility === 'full', JSON.stringify(mine || {}).slice(0, 200));
  if (mine) {
    check(`${label}: portal shows score + explanation`,
      mine.result && typeof mine.result.score === 'number' && typeof mine.result.explanation === 'string'
        && Array.isArray(mine.result.per_criterion) && mine.result.per_criterion.length >= 3,
      JSON.stringify(mine.result || {}).slice(0, 200));
    check(`${label}: portal shows hidden-test counts only`,
      mine.result && mine.result.tests && mine.result.tests.total === expect.hiddenTotal
        && !JSON.stringify(mine.result.tests).includes('expected'));
  }

  // Redaction after submit: hidden cases collapse to name + pass/fail for the candidate.
  const after = await http('GET', `/api/proof/submissions/${subId}`, cand.token);
  const cases = after.body?.submission?.test_results?.cases || [];
  const hidden = cases.filter((c) => !c.visible);
  check(`${label}: hidden cases redacted for candidate`,
    hidden.length > 0 && hidden.every((c) => !('input' in c) && !('expected' in c) && !('got' in c)));

  // Cross-candidate isolation probe happens at the journey level (see below).
  return { subId };
}

async function main() {
  const keep = process.argv.includes('--keep');
  const screenArgs = [];
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--screen') screenArgs.push(process.argv[i + 1]);
  }
  if (!screenArgs.length) {
    console.error('need at least one --screen <ws_id>:<good_solution_file>:<bad_solution_file>');
    process.exit(2);
  }

  const health = await fetch(`${BASE}/health`);
  check('backend healthy', health.status === 200);

  const stamp = Date.now();
  const created = { users: [], subs: [] };
  let firstToken = null;
  let foreignSub = null;

  for (const [idx, arg] of screenArgs.entries()) {
    const [screenId, goodFile, badFile] = arg.split(':');
    const { data: screen } = await admin
      .from('work_samples').select('title, duration_minutes, tests').eq('id', screenId).single();
    if (!screen) { check(`screen ${screenId} exists`, false); continue; }
    const total = screen.tests?.cases?.length || 0;
    const visibleTotal = (screen.tests?.cases || []).filter((c) => c.visible).length;

    // The buggy solution's expected pass-counts are encoded by the caller in the arg suffix
    // "<file>#<hiddenPassed>@<visiblePassed>" (computing them here would duplicate the harness).
    const badMeta = badFile.match(/#(\d+)@(\d+)$/);
    const badPath = badFile.replace(/#\d+@\d+$/, '');
    const good = readFileSync(goodFile, 'utf8');
    const bad = readFileSync(badPath, 'utf8');

    const entryOf = (p) => `solution.${p.split('.').pop()}`;
    const candGood = await freshCandidate(`interview-good${idx}-${stamp}`);
    const candBad = await freshCandidate(`interview-bad${idx}-${stamp}`);
    created.users.push(candGood.id, candBad.id);
    if (!firstToken) firstToken = candGood.token;

    const g = await runCandidate({
      screenId, screen, cand: candGood, solution: good, entry: entryOf(goodFile), label: `good(${entryOf(goodFile)})`,
      expect: { visiblePassed: visibleTotal, visibleTotal, hiddenPassed: total, hiddenTotal: total, scoreMin: 85, scoreMax: 100 },
    });
    if (g) { created.subs.push(g.subId); foreignSub = foreignSub || g.subId; }

    if (badMeta) {
      const b = await runCandidate({
        screenId, screen, cand: candBad, solution: bad, entry: entryOf(badPath), label: `bad(${entryOf(badPath)})`,
        expect: {
          visiblePassed: Number(badMeta[2]), visibleTotal,
          hiddenPassed: Number(badMeta[1]), hiddenTotal: total,
          scoreMin: 25, scoreMax: 84,
        },
      });
      if (b) created.subs.push(b.subId);
    }
  }

  // Isolation: a different candidate must not be able to read someone else's submission.
  if (firstToken && foreignSub) {
    const spy = await freshCandidate(`interview-spy-${stamp}`);
    created.users.push(spy.id);
    const r = await http('GET', `/api/proof/submissions/${foreignSub}`, spy.token);
    check('cross-candidate read blocked', r.status === 403 || r.status === 404, `status ${r.status}`);
  }

  if (!keep) {
    // Best-effort cleanup: append-only children (audit log, integrity events) refuse DELETE, so
    // fall back to archiving the submissions when hard delete is blocked. Mock users are testmail
    // addresses and metrics-excluded either way.
    for (const subId of created.subs) {
      const del = await admin.from('work_sample_submissions').delete().eq('id', subId);
      if (del.error) {
        await admin.from('work_sample_submissions')
          .update({ archived_at: new Date().toISOString() }).eq('id', subId);
      }
    }
    for (const uid of created.users) {
      try { await admin.auth.admin.deleteUser(uid); } catch { /* keep: has FK'd rows */ }
    }
    console.log(`\ncleanup attempted for ${created.subs.length} submissions / ${created.users.length} users`);
  } else {
    console.log(`\n--keep: left ${created.subs.length} submissions in place`);
  }

  console.log(`\n${failures === 0 ? 'SMOKE-INTERVIEW PASSED' : `SMOKE-INTERVIEW FAILED (${failures})`} — ${results.length} checks`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
