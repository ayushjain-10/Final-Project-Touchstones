#!/usr/bin/env node
/**
 * grader-matrix — grader-vs-execution across MULTIPLE providers/models in one run.
 * ---------------------------------------------------------------------------------
 * Same non-circular method as grader-vs-execution.mjs (execution-labeled HumanEval corpus,
 * production prompt via buildSystemPrompt, 0-100 computed in code), but parameterized over a
 * model matrix so Azure / Fireworks / Anthropic graders can be compared on the SAME programs.
 * Reports per model: recall on correct code (the measured weakness: baseline 68%), precision,
 * accuracy, hedge rate (scores in the 40-60 "unsure" band), API failures, token usage.
 *
 * Usage:
 *   MODELS="azure,fireworks:accounts/fireworks/models/deepseek-v4-pro" \
 *   [CORPUS=corpus-wave2.jsonl] [EVAL_N=44] [EVAL_THRESHOLD=60] [CONCURRENCY=6] \
 *   node backend/eval/external/grader-matrix.mjs
 *
 * Provider syntax: "azure" (aiService shim, pinned deployment) | "fireworks:<model>" |
 * "anthropic:<model>". Raw per-program scores land in grader-matrix-results.jsonl (gitignored
 * dir) so prompt experiments can diff against this run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { buildSystemPrompt, computeScore, validateGraderOutput } = require('../../src/services/proofScoringService');
const { gradeWithFireworks } = require('../../src/services/fireworksGrader');
const llm = require('../../src/services/aiService');

const CORPUS = path.resolve(__dirname, process.env.CORPUS || 'corpus.jsonl');
const OUT = path.resolve(__dirname, 'grader-matrix-results.jsonl');
const THRESHOLD = parseInt(process.env.EVAL_THRESHOLD || '60', 10);
const N = parseInt(process.env.EVAL_N || '0', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '6', 10);
const MAX_TOKENS = parseInt(process.env.AI_SCORE_MAX_TOKENS || '800', 10);
const TIMEOUT_MS = parseInt(process.env.AI_SCORE_TIMEOUT_MS || '60000', 10);

// One-criterion correctness rubric. Two variants, selected by RUBRIC_VARIANT:
//   baseline   — byte-identical to grader-vs-execution.mjs (measured: recall 68%, the grader
//                parks correct code at the "50 = plausible but unverified" anchor).
//   calibrated — anti-hedging: deduct ONLY with a nameable bug + failing input; no 50-parking.
//                Hypothesis: recall up without losing mutant detection (mutants have nameable bugs).
const RUBRICS = {
  baseline: {
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
  },
  calibrated: {
    criteria: [
      {
        id: 'correctness',
        requirement:
          'The solution is fully correct: it implements the specified behavior for ALL inputs including edge cases. Review it line by line. Deduct points ONLY if you can name the specific bug AND give a concrete input on which the code produces the wrong output. If after careful review you cannot identify such a bug, the code is correct: award full points. Never give a middling score to express uncertainty; decide.',
        points_possible: 100,
        weight: 1,
        anchors: [
          '0 = has a specific, nameable bug with a concrete failing input',
          '100 = no identifiable bug after careful line-by-line review',
        ],
      },
    ],
  },
};
const RUBRIC = RUBRICS[process.env.RUBRIC_VARIANT || 'baseline'];
if (!RUBRIC) throw new Error(`unknown RUBRIC_VARIANT: ${process.env.RUBRIC_VARIANT}`);

function extractJson(t) {
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) throw new Error('no json');
  return JSON.parse(t.slice(a, b + 1));
}

// ---- provider adapters: each returns normalized 0-100 or null on failure ----

// Same JSON schema the product grader pins (copied from grader-vs-execution.mjs).
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

async function gradeAzure(program) {
  const { anthropic, model } = llm.getLLM();
  const system = [{ type: 'text', text: buildSystemPrompt(RUBRIC) }];
  const messages = [{ role: 'user', content: `<submission>\n${String(program).slice(0, 12000)}\n</submission>` }];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await anthropic.messages.create(
      { model, max_tokens: MAX_TOKENS, system, messages, response_schema: GRADER_JSON_SCHEMA },
      { signal: controller.signal },
    );
    const text = (resp.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('');
    const raw = extractJson(text);
    if (!raw || !Array.isArray(raw.per_criterion) || !raw.per_criterion.length) return null;
    return computeScore(RUBRIC, raw.per_criterion).normalized;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function gradeFireworks(program, model) {
  try {
    const { grade } = await gradeWithFireworks(RUBRIC, program, { model, timeoutMs: TIMEOUT_MS, maxTokens: 8000 });
    if (!grade || !Array.isArray(grade.per_criterion) || !grade.per_criterion.length) return null;
    return computeScore(RUBRIC, grade.per_criterion).normalized;
  } catch {
    return null;
  }
}

async function gradeAnthropic(program, model) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(RUBRIC),
        messages: [{ role: 'user', content: `<submission>\n${String(program).slice(0, 12000)}\n</submission>` }],
      }),
      signal: controller.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return null;
    const text = (data.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('');
    const grade = validateGraderOutput(text);
    if (!grade || !Array.isArray(grade.per_criterion) || !grade.per_criterion.length) return null;
    return computeScore(RUBRIC, grade.per_criterion).normalized;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function graderFor(spec) {
  if (spec === 'azure') return { label: `azure:${llm.getLLM().model}`, fn: (p) => gradeAzure(p) };
  if (spec.startsWith('fireworks:')) {
    const m = spec.slice('fireworks:'.length);
    return { label: `fireworks:${m.split('/').pop()}`, fn: (p) => gradeFireworks(p, m) };
  }
  if (spec.startsWith('anthropic:')) {
    const m = spec.slice('anthropic:'.length);
    return { label: `anthropic:${m}`, fn: (p) => gradeAnthropic(p, m) };
  }
  // "ensemble:median" — median of the three top graders (azure, glm-5p2, haiku). Robust to any
  // single grader's hedge/miss; null members are dropped (median of the rest), all-null → null.
  if (spec === 'ensemble:median') {
    const members = [
      (p) => gradeAzure(p),
      (p) => gradeFireworks(p, 'accounts/fireworks/models/glm-5p2'),
      (p) => gradeAnthropic(p, 'claude-haiku-4-5'),
    ];
    return {
      label: 'ensemble:median(azure,glm,haiku)',
      fn: async (p) => {
        const scores = (await Promise.all(members.map((m) => m(p)))).filter((s) => s !== null && s !== undefined);
        if (!scores.length) return null;
        scores.sort((a, b) => a - b);
        const mid = Math.floor(scores.length / 2);
        return scores.length % 2 ? scores[mid] : Math.round((scores[mid - 1] + scores[mid]) / 2);
      },
    };
  }
  throw new Error(`unknown model spec: ${spec}`);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

// ---- run ----
let rows = fs.readFileSync(CORPUS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (N > 0) rows = rows.slice(0, N);

const VARIANT = process.env.RUBRIC_VARIANT || 'baseline';
const specs = String(process.env.MODELS || 'azure').split(',').map((s) => s.trim()).filter(Boolean);
console.log(`grader-matrix — ${rows.length} programs, threshold=${THRESHOLD}, rubric=${VARIANT}, models: ${specs.join(' | ')}\n`);

const resultsOut = fs.createWriteStream(OUT, { flags: 'a' });
const table = [];
for (const spec of specs) {
  const { label, fn } = graderFor(spec);
  const t0 = Date.now();
  const scores = await mapLimit(rows, CONCURRENCY, (r) => fn(r.program));
  let TP = 0, FP = 0, TN = 0, FN = 0, fail = 0, hedge = 0;
  const corr = [], incorr = [];
  scores.forEach((norm, i) => {
    const r = rows[i];
    const isCorrect = r.execution_truth === true || r.execution_truth === 'True';
    resultsOut.write(JSON.stringify({ run: `${label}@${VARIANT}`, task: r.task_id ?? i, correct: isCorrect, score: norm, ts: new Date().toISOString() }) + '\n');
    if (norm === null || norm === undefined) { fail += 1; return; }
    if (norm >= 40 && norm <= 60) hedge += 1;
    const pass = norm >= THRESHOLD;
    if (isCorrect) { corr.push(norm); pass ? TP++ : FN++; }
    else { incorr.push(norm); pass ? FP++ : TN++; }
  });
  const pct = (x) => (x * 100).toFixed(1) + '%';
  const mean = (a) => (a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : 'n/a');
  const recall = TP + FN ? TP / (TP + FN) : 0;
  const precision = TP + FP ? TP / (TP + FP) : 0;
  const acc = TP + FP + TN + FN ? (TP + TN) / (TP + FP + TN + FN) : 0;
  const line = {
    model: `${label}@${VARIANT}`,
    recall: pct(recall),
    precision: pct(precision),
    accuracy: pct(acc),
    FP,
    FN,
    hedge_rate: pct(hedge / Math.max(1, rows.length - fail)),
    mean_correct: mean(corr),
    mean_incorrect: mean(incorr),
    api_fail: fail,
    secs: Math.round((Date.now() - t0) / 1000),
  };
  table.push(line);
  console.log(JSON.stringify(line));
}
resultsOut.end();

console.log('\n=== MATRIX ===');
console.table(table);
