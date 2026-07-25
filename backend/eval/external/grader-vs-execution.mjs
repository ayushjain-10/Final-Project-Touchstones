#!/usr/bin/env node
/**
 * grader-vs-execution — NON-CIRCULAR eval of our LLM grader against real execution truth.
 * ---------------------------------------------------------------------------------------
 * Reads corpus.jsonl (built by build_corpus.py from HumanEval, MIT) where every program is
 * labeled correct/incorrect by ACTUALLY RUNNING it. Grades each program with OUR production
 * grader primitives — proofScoringService.buildSystemPrompt + computeScore and aiService.getLLM
 * (the exact code the app uses) — against a generic correctness rubric, WITHOUT showing the
 * grader any tests. Then compares the grader's pass/fail to the execution truth.
 *
 * HEADLINE METRIC: the false-positive rate on plausible-but-wrong code — broken programs the
 * LLM grader passed by reading alone. That number is the case for execution grounding; once
 * grounding is on (AI_SCORE_EXEC_GROUNDING), re-running should drive it toward ~0.
 *
 * No DB, no spendGuard: pure grader behavior. Spends Azure/Anthropic tokens (approved). This is
 * a `.mjs` so top-level await + import() of the CJS services just work.
 *
 * Usage:
 *   node backend/eval/external/grader-vs-execution.mjs                 # all of corpus.jsonl
 *   EVAL_N=40 EVAL_THRESHOLD=60 node .../grader-vs-execution.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { buildSystemPrompt, computeScore } = require('../../src/services/proofScoringService');
const llm = require('../../src/services/aiService');

const CORPUS = path.resolve(__dirname, 'corpus.jsonl');
const THRESHOLD = parseInt(process.env.EVAL_THRESHOLD || '60', 10); // grader "pass" iff normalized >= this
const N = parseInt(process.env.EVAL_N || '0', 10); // 0 = all rows
const MAX_TOKENS = parseInt(process.env.AI_SCORE_MAX_TOKENS || '800', 10);
const TIMEOUT_MS = parseInt(process.env.AI_SCORE_TIMEOUT_MS || '30000', 10);

// Generic correctness rubric — ONE criterion, 100 points, no tests shown. The grader must judge
// correctness by reading the code, which is exactly the ability execution grounding replaces.
const RUBRIC = {
  criteria: [
    {
      id: 'correctness',
      requirement:
        'The solution is fully correct: it implements the specified behavior for ALL inputs including edge cases, and would pass a comprehensive hidden test suite. Award full points only if you are confident it is correct; deduct heavily for any bug, off-by-one, wrong operator, or unhandled case.',
      points_possible: 100,
      weight: 1,
      anchors: [
        '0 = clearly incorrect / has a bug',
        '50 = plausible but unverified; a subtle bug may be present',
        '100 = provably correct for all inputs',
      ],
    },
  ],
};

// Byte-faithful copy of proofScoringService.GRADER_JSON_SCHEMA (module-private there).
const GRADER_JSON_SCHEMA = {
  name: 'grader_output',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      per_criterion: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            evidence_quote: { type: 'string' },
            explanation: { type: 'string' },
            verdict: { type: 'string', enum: ['MET', 'PARTIAL', 'UNMET'] },
            points_awarded: { type: 'integer' },
            points_possible: { type: 'integer' },
          },
          required: ['id', 'evidence_quote', 'explanation', 'verdict', 'points_awarded', 'points_possible'],
        },
      },
      overall_explanation: { type: 'string' },
      injection_detected: { type: 'boolean' },
    },
    required: ['per_criterion', 'overall_explanation', 'injection_detected'],
  },
};

function extractJson(t) {
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) throw new Error('no json');
  return JSON.parse(t.slice(a, b + 1));
}

async function gradeProgram(anthropic, model, program) {
  const system = [{ type: 'text', text: buildSystemPrompt(RUBRIC), cache_control: { type: 'ephemeral' } }];
  const messages = [{ role: 'user', content: `<submission>\n${String(program).slice(0, 12000)}\n</submission>` }];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await anthropic.messages.create(
      { model, max_tokens: MAX_TOKENS, system, messages, response_schema: GRADER_JSON_SCHEMA },
      { signal: controller.signal },
    );
    clearTimeout(timer);
    const text = (resp.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('');
    const raw = extractJson(text);
    if (!raw || !Array.isArray(raw.per_criterion) || raw.per_criterion.length === 0) return null;
    const { normalized } = computeScore(RUBRIC, raw.per_criterion);
    return normalized;
  } catch (_) {
    clearTimeout(timer);
    return null;
  }
}

async function main() {
  if (!fs.existsSync(CORPUS)) {
    console.error('No corpus.jsonl — run build_corpus.py first.');
    process.exit(1);
  }
  let rows = fs.readFileSync(CORPUS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (N > 0) rows = rows.slice(0, N);

  const { anthropic, model, provider } = llm.getLLM();
  if (!anthropic) {
    console.error('No LLM configured (set AZURE_OPENAI_* in backend/.env).');
    process.exit(1);
  }
  console.log(`grader-vs-execution — ${rows.length} programs via ${provider} '${model}', pass threshold=${THRESHOLD}`);
  console.log(`strict structured outputs: ${process.env.AZURE_STRUCTURED_OUTPUTS === 'true' ? 'ON' : 'off'}\n`);

  let TP = 0, FP = 0, TN = 0, FN = 0, fail = 0;
  const fpExamples = [];
  for (const r of rows) {
    const norm = await gradeProgram(anthropic, model, r.program);
    if (norm === null) {
      fail += 1;
      continue;
    }
    const graderPass = norm >= THRESHOLD;
    const truth = !!r.execution_truth;
    if (truth && graderPass) TP += 1;
    else if (!truth && graderPass) {
      FP += 1;
      if (fpExamples.length < 8) fpExamples.push(`${r.task_id} [${r.mutation}] grader=${norm}`);
    } else if (!truth && !graderPass) TN += 1;
    else FN += 1;
    process.stdout.write(
      `  ${String(r.task_id).padEnd(15)} ${String(r.source).padEnd(9)} truth=${truth ? 'PASS' : 'FAIL'} grader=${String(norm).padStart(3)} ${truth === graderPass ? 'ok' : 'MISS'}\n`,
    );
  }

  const graded = TP + FP + TN + FN;
  const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : 'n/a');
  const negatives = FP + TN;
  console.log('\n─── grader vs EXECUTION TRUTH (non-circular; no tests shown to the grader) ───');
  console.log(`  graded: ${graded}   (parse/transport fails: ${fail})`);
  console.log(`  confusion:  TP=${TP}  FP=${FP}  TN=${TN}  FN=${FN}`);
  console.log(`  accuracy=${pct(TP + TN, graded)}%  precision=${pct(TP, TP + FP)}%  recall=${pct(TP, TP + FN)}%`);
  console.log(`  HEADLINE — false positives on plausible-but-wrong code: ${pct(FP, negatives)}%  (${FP}/${negatives})`);
  console.log('             = broken programs the LLM grader PASSED by reading alone.');
  if (fpExamples.length) console.log('  examples:\n' + fpExamples.map((e) => '    - ' + e).join('\n'));
  console.log('──────────────────────────────────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
