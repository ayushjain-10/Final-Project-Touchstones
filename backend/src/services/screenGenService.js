/**
 * screenGenService — "Author with AI" (CC2 / S2).
 *
 * Kills the authoring cold-start: given a job description (free text) and/or a
 * code snippet / repo signal, generate a complete DRAFT work-sample the recruiter
 * can tweak and then save through the normal create flow (POST /api/proof/work-samples).
 *
 * Output draft shape (NOT persisted here):
 *   {
 *     title, role, role_family, language, languages, response_type,
 *     task,                 // messy, role-specific, AI-allowed prompt_md
 *     duration_minutes, ai_allowed,
 *     rubric: [{ label, points, requirement }],   // editable rows (sum == 100)
 *     starter_files: [{ path, language, content }],
 *     hidden_tests: { kind:'cases', language, entry_file, entry_fn, timeout_ms, cases:[{name,visible,input,expected}] } | null,
 *     test_summary: { kind, case_count, case_names: [...] },
 *     input_kind
 *   }
 *
 * Design + safety:
 *  - Uses the shared Claude wrapper (aiService.getLLM) + spendGuard ceilings, exactly
 *    like proofScoringService / aiDirectionService.
 *  - GUARDRAILS: the rubric is normalized to sum to 100 in code; the task is steered
 *    toward real-work (not leetcode); hidden tests are emitted in the engine's MODERN
 *    `{ kind:'cases', ... }` shape — the model only supplies STRUCTURED cases
 *    ({name,args,expected}), never a command. codeExecutionService.runCases builds the
 *    runnable, nonce-tagged harness at run time (so we never execute generated shell and
 *    candidate stdout cannot spoof a PASS), and it is the shape that populates
 *    work_sample_submissions.test_results on submit — enabling execution grounding.
 *  - from-repo does NOT fetch the URL (SSRF + scope); repo_url is a signal only and the
 *    snippet is the real input.
 */
const crypto = require('crypto');
const { z } = require('zod');
const aiService = require('./aiService');
const spendGuard = require('./spendGuard');

const MAX_OUTPUT_TOKENS = Number(process.env.AI_SCREENGEN_MAX_TOKENS || 2600);
const ATTEMPTS = Math.max(1, Number(process.env.AI_SCREENGEN_ATTEMPTS || 2));
const TEMPERATURE = Number.isFinite(Number(process.env.AI_SCREENGEN_TEMPERATURE))
  ? Number(process.env.AI_SCREENGEN_TEMPERATURE)
  : 0.6;
const TEST_TIMEOUT_MS = 30000;
const JS_LANGS = new Set(['javascript', 'js', 'node', 'nodejs', 'typescript', 'ts']);

// --- typed errors the route maps to HTTP codes ----------------------------------
function aiUnavailable() {
  const e = new Error('AI generation is not configured');
  e.code = 'AI_UNAVAILABLE';
  return e;
}
function generationFailed(detail) {
  const e = new Error(detail || 'Could not generate a usable screen');
  e.code = 'GENERATION_FAILED';
  return e;
}
// A TRANSIENT provider failure (rate-limit / overload / 5xx) — retryable, NOT a bad-input
// problem. Kept distinct from generationFailed so the route can say "try again shortly"
// instead of the misleading "tweak your input".
function aiTransient(detail) {
  const e = new Error(detail || 'The AI provider is temporarily unavailable');
  e.code = 'AI_TRANSIENT';
  return e;
}
// Anthropic/OpenAI SDK errors carry an HTTP `.status`. Auth failures (401/403) mean the key is
// missing/invalid → not configured. 429/529/5xx mean the provider is busy/down → retryable.
function classifyApiError(e) {
  const status = e && (e.status || e.statusCode);
  if (status === 401 || status === 403) return 'auth';
  if (status === 429 || status === 529 || (status >= 500 && status <= 599)) return 'transient';
  return null;
}

// --- robust JSON extraction (same approach as proofScoringService) --------------
function extractJson(text) {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) throw new Error('model returned no JSON');
  return JSON.parse(text.slice(a, b + 1));
}

// --- model output schema --------------------------------------------------------
const ModelDraft = z.object({
  title: z.string().max(160).optional().default(''),
  role: z.string().max(160).optional().default(''),
  role_family: z.string().max(60).optional().default('generic'),
  language: z.string().max(40).optional().default(''),
  task_kind: z.enum(['unit_function', 'freeform']).optional().default('freeform'),
  task_markdown: z.string().min(1),
  duration_minutes: z.coerce.number().optional().default(45),
  entry: z
    .object({ export: z.string().max(80).optional().default('default') })
    .optional(),
  starter_files: z
    .array(
      z.object({
        path: z.string().min(1).max(200),
        language: z.string().max(40).optional().default(''),
        content: z.string().max(20000).optional().default(''),
      })
    )
    .optional()
    .default([]),
  cases: z
    .array(
      z.object({
        name: z.string().max(120).optional().default(''),
        args: z.array(z.any()).optional().default([]),
        expected: z.any(),
      })
    )
    .optional()
    .default([]),
  rubric: z
    .array(
      z.object({
        label: z.string().min(1).max(160),
        points: z.coerce.number(),
        requirement: z.string().max(600).optional().default(''),
      })
    )
    .optional()
    .default([]),
});

const DEFAULT_RUBRIC = [
  { label: 'Correct root-cause fix', points: 30, requirement: 'Identifies and fixes the real root cause, not just the symptom.' },
  { label: 'Handles edge cases', points: 25, requirement: 'Covers the messy edge cases (errors, retries, boundaries) the task implies.' },
  { label: 'Directs & verifies the AI', points: 25, requirement: 'Uses AI well — directs it, checks its output, and does not ship unverified slop.' },
  { label: 'Code quality & tests', points: 20, requirement: 'Readable, well-structured solution with tests that actually exercise the fix.' },
];

// Largest-remainder normalization so positive points sum to EXACTLY 100 (each >= 1).
function normalizeRubric(rows) {
  let cleaned = (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      label: String(r.label || '').trim(),
      points: Math.max(0, Math.round(Number(r.points) || 0)),
      requirement: String(r.requirement || r.label || '').trim(),
    }))
    .filter((r) => r.label);
  if (cleaned.length < 2) cleaned = DEFAULT_RUBRIC.map((r) => ({ ...r }));

  // Weight by the model's points; if they're all zero/blank, weight everything equally.
  // Then apportion to EXACTLY 100 (largest-remainder), each criterion >= 1 — for ANY
  // criteria count, including the all-zero case (the old code left 3/6/7 criteria at 99/96/98).
  const sum = cleaned.reduce((s, r) => s + r.points, 0);
  const weights = sum > 0 ? cleaned.map((r) => r.points) : cleaned.map(() => 1);
  const wsum = weights.reduce((s, v) => s + v, 0) || cleaned.length;

  const exact = weights.map((w) => (w / wsum) * 100);
  const floored = exact.map((v) => Math.max(1, Math.floor(v)));
  let remainder = 100 - floored.reduce((s, v) => s + v, 0);
  // Hand out any leftover points to the largest fractional parts.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (remainder > 0 && order.length) {
    floored[order[k % order.length].i] += 1;
    remainder -= 1;
    k += 1;
  }
  // If the >=1 floor overshot 100 (many tiny weights), trim from the largest.
  while (remainder < 0) {
    const idx = floored.indexOf(Math.max(...floored));
    if (floored[idx] > 1) {
      floored[idx] -= 1;
      remainder += 1;
    } else break;
  }
  cleaned.forEach((r, i) => (r.points = floored[i]));
  return cleaned;
}

// Deterministically build a runnable Node test harness from STRUCTURED cases.
// The candidate's solution lives in ./solution.js; the harness requires it, runs
// each case, prints "<pass> passed, <fail> failed" (parsed by codeExecutionService)
// and exits non-zero on any failure. We never run model/caller-supplied commands.
function buildTestHarness({ entryExport = 'default', cases = [] }) {
  const n = cases.length;
  const casesJson = JSON.stringify(
    cases.map((c) => ({ name: String(c.name || ''), args: Array.isArray(c.args) ? c.args : [], expected: c.expected })),
    null,
    2
  );
  const pick =
    entryExport && entryExport !== 'default'
      ? `(mod && mod[${JSON.stringify(entryExport)}])`
      : `(typeof mod === 'function' ? mod : (mod && (mod.default || (typeof mod === 'object' ? mod[Object.keys(mod)[0]] : null))))`;

  return `'use strict';
// Auto-generated by Touchstones "Author with AI". Runs the candidate's ./solution.js
// against ${n} hidden case(s). Edit cases below to refine the screen.
//
// Candidate output is SILENCED while their code runs, so the only "N passed, M failed"
// token in stdout is this harness's own summary line — a candidate cannot print a fake
// count that would poison the grader's result parsing.
const assert = require('assert');
const _out = process.stdout.write.bind(process.stdout);
const _err = process.stderr.write.bind(process.stderr);
const _silence = () => { process.stdout.write = () => true; process.stderr.write = () => true; };
const _restore = () => { process.stdout.write = _out; process.stderr.write = _err; };

let mod;
try { _silence(); mod = require('./solution.js'); _restore(); }
catch (e) { _restore(); _out('0 passed, ${n} failed\\n'); _err('Could not load solution.js: ' + (e && e.message) + '\\n'); process.exit(1); }
const fn = ${pick};
if (typeof fn !== 'function') { _out('0 passed, ${n} failed\\n'); _err('solution.js must export a function\\n'); process.exit(1); }
const cases = ${casesJson};
(async () => {
  let pass = 0, fail = 0;
  const fails = [];
  for (const c of cases) {
    try {
      _silence();
      let got = fn.apply(null, c.args);
      if (got && typeof got.then === 'function') got = await got;
      _restore();
      assert.deepStrictEqual(got, c.expected);
      pass++;
    } catch (e) {
      _restore();
      fail++;
      fails.push((c.name || 'case') + ': ' + (e && e.message ? e.message : String(e)));
    }
  }
  // Summary FIRST on stdout (the sole pass/fail token there); details after on stderr.
  _out(pass + ' passed, ' + fail + ' failed\\n');
  for (const f of fails) _err('FAIL ' + f + '\\n');
  process.exit(fail === 0 ? 0 : 1);
})();
`;
}

function defaultSolutionStub(entryExport) {
  if (entryExport && entryExport !== 'default') {
    return `module.exports = {\n  ${entryExport}(/* args */) {\n    // TODO: implement. AI is allowed — direct it well and verify the output.\n  },\n};\n`;
  }
  return `module.exports = function solve(/* args */) {\n  // TODO: implement. AI is allowed — direct it well and verify the output.\n};\n`;
}

function pickTitle(parsed, role) {
  const t = String(parsed.title || '').trim();
  if (t) return t.slice(0, 120);
  const firstLine = String(parsed.task_markdown || '').split('\n').find((l) => l.replace(/[#*\s]/g, '').length > 4);
  if (firstLine) return firstLine.replace(/^[#*\s]+/, '').trim().slice(0, 120);
  return (role || 'Real-work screen').slice(0, 120);
}

// Turn the validated model output into a saved-shape draft, applying all guardrails.
function toDraft(parsed, { language, inputKind }) {
  const lang = String(parsed.language || language || 'javascript').trim().toLowerCase() || 'javascript';
  const role = String(parsed.role || '').trim() || 'Engineer';
  const rubric = normalizeRubric(parsed.rubric);
  let duration = Math.round(Number(parsed.duration_minutes) || 45);
  if (!Number.isFinite(duration) || duration < 15) duration = 30;
  if (duration > 120) duration = 120;

  // Reserved infra filenames the test harness owns — never let a generated starter file
  // shadow them (codeExecutionService writes tests.files last, so a starter '_runtests.js'
  // would be silently clobbered). Drop them defensively.
  const RESERVED_FILES = new Set(['_runtests.js']);
  let starterFiles = (parsed.starter_files || [])
    .filter((f) => f && f.path && typeof f.content === 'string' && !RESERVED_FILES.has(f.path))
    .map((f) => ({ path: f.path, language: f.language || lang, content: f.content }));

  // Build runnable hidden tests ONLY for JS/TS unit-function tasks with valid cases.
  let hiddenTests = null;
  let testSummary = { kind: 'none', case_count: 0, case_names: [] };
  let responseType = 'markdown';
  const entryExport = (parsed.entry && parsed.entry.export) || 'default';
  const validCases = (parsed.cases || []).filter((c) => c && Array.isArray(c.args) && 'expected' in c);

  if (parsed.task_kind === 'unit_function' && JS_LANGS.has(lang) && validCases.length >= 1) {
    responseType = 'code';
    // The runCases harness requires ./solution.js — guarantee one exists for the candidate to edit.
    if (!starterFiles.some((f) => f.path === 'solution.js')) {
      starterFiles = [
        { path: 'solution.js', language: 'javascript', content: defaultSolutionStub(entryExport) },
        ...starterFiles,
      ];
    }
    // MODERN {kind:'cases'} shape consumed by codeExecutionService.runCases / isCaseTests. This is
    // the shape proof.js runFullTestsAndStore executes on submit to populate test_results (the
    // legacy {command,files} harness the run/store path ignored), which in turn enables execution
    // grounding. Renames: model `args` -> runCases `input`; entry.export -> entry_fn (default 'solve').
    hiddenTests = {
      kind: 'cases',
      language: 'javascript', // JS/TS screens run under the node harness; solution.js is the entry file
      entry_file: 'solution.js',
      entry_fn: entryExport === 'default' ? 'solve' : entryExport,
      timeout_ms: TEST_TIMEOUT_MS,
      cases: validCases.map((c, i) => ({
        name: String(c.name || `case ${i + 1}`),
        visible: i < 1, // first case is a runnable SAMPLE; the rest are hidden
        input: Array.isArray(c.args) ? c.args : [],
        expected: c.expected,
      })),
    };
    testSummary = {
      kind: 'unit_function',
      case_count: validCases.length,
      case_names: validCases.map((c, i) => String(c.name || `case ${i + 1}`)),
    };
  } else if (starterFiles.length) {
    // Code task but no auto-runnable tests — still a code screen, scored by rubric.
    responseType = 'code';
  }

  return {
    title: pickTitle(parsed, role),
    role,
    role_family: String(parsed.role_family || 'generic').trim() || 'generic',
    language: lang,
    languages: [lang],
    response_type: responseType,
    task: String(parsed.task_markdown || '').trim(),
    duration_minutes: duration,
    ai_allowed: true,
    rubric,
    starter_files: starterFiles,
    hidden_tests: hiddenTests,
    test_summary: testSummary,
    input_kind: inputKind,
  };
}

// --- prompt construction --------------------------------------------------------
function systemPrompt() {
  return `You are Touchstones' senior assessment author. You turn a hiring signal (a job
description, a code snippet, or a repo URL) into ONE tailored, messy, real-work screening task —
the kind of thing the person would actually do in the first week on the job.

Hard rules:
- REAL WORK, not a puzzle. No leetcode, no algorithm trivia, no answer that can be googled. Prefer
  "debug / extend / harden a small but realistic piece of a service" with a believable backstory.
- AI IS EXPLICITLY ALLOWED and that is part of the signal — the task should reward directing and
  verifying an AI assistant, not memorization. Say so in the task.
- Keep it doable in 30–60 minutes by one engineer.

Output ONE JSON object ONLY (no prose, no markdown fences) with EXACTLY these keys:
{
  "title": short screen title (<= 80 chars),
  "role": the role title inferred from the input (e.g. "Senior Backend Engineer"),
  "role_family": one of "backend","frontend","fullstack","data","ml","devops","mobile","generic",
  "language": the primary language (lowercase, e.g. "javascript","python"),
  "task_kind": "unit_function" or "freeform",
  "task_markdown": the candidate-facing task in markdown — messy, specific, with the backstory,
                   the concrete deliverable, and an explicit "AI is allowed — use it well" line,
  "duration_minutes": integer 30..60,
  "entry": { "export": "default" or a named export the candidate must implement },
  "starter_files": [ { "path": "solution.js", "language": "javascript", "content": "buggy/skeleton code with a TODO" } ],
  "cases": [ { "name": "...", "args": [json,...], "expected": json } ],
  "rubric": [ { "label": "...", "points": int, "requirement": "what earns the points" } ]
}

Guidance:
- STRONGLY PREFER "task_kind":"unit_function" with "language":"javascript" when the role is codeable,
  so the screen has runnable hidden tests. Then:
    * "starter_files" MUST contain a file at path "solution.js" that the candidate edits. Make it a
      realistic, slightly-broken or skeletal CommonJS module (module.exports = a function, OR
      module.exports = { namedExport }). Set "entry".export accordingly ("default" for the function
      form, otherwise the named export).
    * "cases" must be 3–6 deterministic cases. "args" is the argument array passed to the function;
      "expected" is the exact return value. Use ONLY JSON-serializable, exact values (ints, strings,
      arrays, plain objects) — NO floats-with-rounding, NO Dates, NO randomness. The function must be
      synchronous or return a resolved value.
- Use "task_kind":"freeform" (with NO cases) only for genuinely non-codeable roles (e.g. pure
  system-design, data analysis writeups). Then "starter_files" may be empty.
- The rubric is 3–5 criteria. Include one criterion about directing/verifying the AI. Points are
  positive integers (they will be re-normalized to total 100).`;
}

function userPromptFromJd({ jd, language, difficulty }) {
  const parts = [`JOB DESCRIPTION:\n${jd}`];
  if (language) parts.push(`PREFERRED LANGUAGE: ${language}`);
  if (difficulty) parts.push(`TARGET DIFFICULTY: ${difficulty}`);
  parts.push('Generate the screen JSON now.');
  return parts.join('\n\n');
}

function userPromptFromRepo({ repo_url, snippet, language, difficulty }) {
  const parts = [];
  if (snippet) parts.push(`CODE SNIPPET / REPO EXCERPT:\n${snippet}`);
  if (repo_url) parts.push(`REPO URL (signal only — infer the stack/role from it; do NOT assume you fetched it): ${repo_url}`);
  if (language) parts.push(`PREFERRED LANGUAGE: ${language}`);
  if (difficulty) parts.push(`TARGET DIFFICULTY: ${difficulty}`);
  parts.push(
    'From this code signal, infer the role and stack, then generate a real-work screen that mirrors this codebase (same language/idioms where possible). Output the screen JSON now.'
  );
  return parts.join('\n\n');
}

// --- core generation ------------------------------------------------------------
async function generate({ userPrompt, language, inputKind, accountId }) {
  const reservation = spendGuard.reserve({ accountId: accountId || 'global', calls: ATTEMPTS });
  if (!reservation.ok) throw new spendGuard.SpendCeilingError(reservation.reason);

  const { anthropic, model } = aiService.getLLM();
  if (!anthropic) throw aiUnavailable();

  const system = [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }];
  let lastErr = null;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const resp = await anthropic.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: TEMPERATURE,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const text = (resp.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('');
      let raw;
      try {
        raw = extractJson(text);
      } catch (e) {
        lastErr = e;
        continue;
      }
      const parsed = ModelDraft.safeParse(raw);
      if (!parsed.success) {
        lastErr = new Error('model output failed validation');
        continue;
      }
      const draft = toDraft(parsed.data, { language, inputKind });
      if (!draft.task || draft.task.length < 20) {
        lastErr = new Error('generated task was too thin');
        continue;
      }
      return draft;
    } catch (e) {
      // A live API/abort error.
      if (e && e.code === 'AI_UNAVAILABLE') throw e;
      // A bad/missing key won't fix itself on retry — fail fast as "not configured".
      if (classifyApiError(e) === 'auth') throw aiUnavailable();
      // Transient (429/529/5xx) and parse/validation errors: let the loop retry.
      lastErr = e;
    }
  }
  // Distinguish a transient PROVIDER failure (retryable) from genuinely unusable model output —
  // the former must not be reported to the user as "tweak your input".
  if (classifyApiError(lastErr) === 'transient') {
    throw aiTransient(lastErr && lastErr.message);
  }
  throw generationFailed(lastErr && lastErr.message);
}

async function generateFromJD({ jd, language, difficulty, accountId } = {}) {
  return generate({
    userPrompt: userPromptFromJd({ jd, language, difficulty }),
    language,
    inputKind: 'jd',
    accountId,
  });
}

async function generateFromRepo({ repo_url, snippet, language, difficulty, accountId } = {}) {
  return generate({
    userPrompt: userPromptFromRepo({ repo_url, snippet, language, difficulty }),
    language,
    inputKind: snippet ? 'snippet' : 'repo',
    accountId,
  });
}

// Stable hash of the input (for the optional generation log / abuse control).
function inputHash(input) {
  return crypto.createHash('sha256').update(String(input || '')).digest('hex');
}

module.exports = {
  generateFromJD,
  generateFromRepo,
  inputHash,
  // exported for unit tests / reuse:
  normalizeRubric,
  buildTestHarness,
  toDraft,
  _ModelDraft: ModelDraft,
};
