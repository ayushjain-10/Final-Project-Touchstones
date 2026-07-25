#!/usr/bin/env node
/**
 * Offline scoring eval runner.
 * ----------------------------
 * Re-grades each gold item K times through the SAME Azure grader path the app uses,
 * then measures — per item — how far the re-grades land from the score the app already
 * stored, and how much they move run-to-run.
 *
 * It reuses the app's own primitives so this is the real path, not a lookalike:
 *   • proofScoringService.buildSystemPrompt(rubric)  — the exact grader system prompt
 *   • proofScoringService.computeScore(rubric, per)  — the exact 0..100 score math
 *   • aiService.getLLM()                             — the exact Azure-backed client
 * The one thing re-declared here is the strict JSON-schema (proofScoringService keeps
 * it module-private); it is a byte-faithful copy of that file's GRADER_JSON_SCHEMA.
 *
 * HONEST FRAMING: this MEASURES scoring consistency and error against a stored baseline.
 * It does not — and cannot — prove scoring is "deterministic"; an LLM grader is not.
 * The point is to produce the baseline numbers (mean abs error, mean stdev, parse-fail %)
 * that scoring never had, so drift can be watched over time.
 *
 * No new keys: reads backend/.env and runs on the existing Azure deployment.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env node backend/eval/scoring-eval/run-eval.js            # all gold items, K=3
 *   node backend/eval/scoring-eval/run-eval.js --items=2 --runs=2                 # tiny smoke
 *   GOLD_ITEMS=2 GOLD_RUNS=2 node backend/eval/scoring-eval/run-eval.js           # same via env
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const proofScoring = require('../../src/services/proofScoringService'); // for buildSystemPrompt + computeScore
const { buildSystemPrompt, computeScore } = proofScoring;
const llm = require('../../src/services/aiService');

const GOLD_PATH = path.resolve(__dirname, 'gold-set.json');

// Match the app's grader knobs (proofScoringService).
const MAX_OUTPUT_TOKENS = parseInt(process.env.AI_SCORE_MAX_TOKENS || '800', 10);
const MODEL_TIMEOUT_MS = parseInt(process.env.AI_SCORE_TIMEOUT_MS || '30000', 10);

// Byte-faithful copy of proofScoringService.GRADER_JSON_SCHEMA (module-private there).
// Drives Azure strict structured outputs when AZURE_STRUCTURED_OUTPUTS=true; ignored otherwise.
const GRADER_JSON_SCHEMA = {
  name: 'grader_output',
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      per_criterion: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
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

function parseArg(name, envName, def) {
  const flag = process.argv.find(a => a.startsWith(`--${name}=`));
  if (flag) return parseInt(flag.split('=')[1], 10);
  if (process.env[envName]) return parseInt(process.env[envName], 10);
  return def;
}

// Same JSON extraction the grader uses (first '{' … last '}').
function extractJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) throw new Error('no JSON');
  return JSON.parse(text.slice(a, b + 1));
}

// One re-grade. Returns { ok:true, normalized } or { ok:false } on a parse/transport failure.
async function gradeOnce(anthropic, model, rubric, response) {
  const system = [{ type: 'text', text: buildSystemPrompt(rubric), cache_control: { type: 'ephemeral' } }];
  const messages = [{ role: 'user', content: `<submission>\n${response.slice(0, 12000)}\n</submission>` }];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const resp = await anthropic.messages.create(
      { model, max_tokens: MAX_OUTPUT_TOKENS, system, messages, response_schema: GRADER_JSON_SCHEMA },
      { signal: controller.signal }
    );
    clearTimeout(timer);
    const text = (resp.content || []).map(b => (b.type === 'text' ? b.text : '')).join('');
    let raw;
    try { raw = extractJson(text); } catch (_) { return { ok: false, reason: 'parse' }; }
    if (!raw || !Array.isArray(raw.per_criterion) || raw.per_criterion.length === 0) {
      return { ok: false, reason: 'schema' };
    }
    const { normalized } = computeScore(rubric, raw.per_criterion);
    return { ok: true, normalized };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, reason: 'transport', message: err.message };
  }
}

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); // population stdev, matches app
}
function round(n, d = 2) { const p = 10 ** d; return Math.round(n * p) / p; }

async function main() {
  if (!fs.existsSync(GOLD_PATH)) {
    console.error(`No gold set at ${GOLD_PATH}. Run build-gold-set.js first.`);
    process.exit(1);
  }
  const all = JSON.parse(fs.readFileSync(GOLD_PATH, 'utf8'));
  const K = Math.max(1, parseArg('runs', 'GOLD_RUNS', 3));
  const N = parseArg('items', 'GOLD_ITEMS', all.length);
  const gold = all.slice(0, Math.max(0, N));

  const { anthropic, model, provider } = llm.getLLM();
  if (!anthropic) { console.error('No LLM configured (set AZURE_OPENAI_* in backend/.env).'); process.exit(1); }

  console.log(`Scoring eval — ${gold.length} item(s) × K=${K} re-grade(s) via ${provider} '${model}'`);
  console.log(`strict structured outputs: ${process.env.AZURE_STRUCTURED_OUTPUTS === 'true' ? 'ON' : 'off'}\n`);

  const perItem = [];
  let totalRuns = 0, totalFails = 0;

  for (const item of gold) {
    const results = [];
    for (let k = 0; k < K; k++) {
      totalRuns++;
      const r = await gradeOnce(anthropic, model, item.rubric, item.response);
      if (r.ok) results.push(r.normalized); else totalFails++;
    }
    const scores = results;
    const m = scores.length ? mean(scores) : null;
    const sd = scores.length ? stdev(scores) : null;
    const absErr = (m !== null && item.stored_score != null) ? Math.abs(m - item.stored_score) : null;
    const parseFailRate = (K - scores.length) / K;
    // A stored score produced by a DIFFERENT model than the current grader makes |err|
    // partly a cross-model disagreement, not pure grader noise — flag it so it isn't misread.
    const crossModel = !!(item.stored_model && model && item.stored_model !== model);
    perItem.push({ id: item.id, stored: item.stored_score, rescores: scores, mean: m, stdev: sd, absErr, parseFailRate, crossModel });

    const fmt = v => (v == null ? 'n/a' : round(v));
    console.log(
      `  ${String(item.id).slice(0, 8)}…  stored=${item.stored_score}` +
      `  re-scores=[${scores.join(', ') || '—'}]` +
      `  mean=${fmt(m)}  stdev=${fmt(sd)}  |err|=${fmt(absErr)}  parseFail=${round(parseFailRate * 100)}%` +
      (crossModel ? `  [baseline model: ${item.stored_model}]` : '')
    );
  }

  const scoredItems = perItem.filter(p => p.absErr != null);
  const withStdev = perItem.filter(p => p.stdev != null);
  const sameModel = scoredItems.filter(p => !p.crossModel);
  const crossModelCount = scoredItems.filter(p => p.crossModel).length;
  const meanAbsErr = scoredItems.length ? mean(scoredItems.map(p => p.absErr)) : null;
  const meanAbsErrSame = sameModel.length ? mean(sameModel.map(p => p.absErr)) : null;
  const meanStdev = withStdev.length ? mean(withStdev.map(p => p.stdev)) : null;
  const parseFailPct = totalRuns ? (totalFails / totalRuns) * 100 : 0;

  console.log('\n─── AGGREGATE (baseline consistency snapshot, not a determinism claim) ───');
  console.log(`  items graded:        ${perItem.length}  (with a usable re-score: ${scoredItems.length})`);
  console.log(`  runs:                ${totalRuns}   parse/transport failures: ${totalFails}`);
  console.log(`  mean abs error:      ${meanAbsErr == null ? 'n/a' : round(meanAbsErr)}  (mean re-score vs stored, 0..100)`);
  if (crossModelCount > 0) {
    console.log(`    ├ same-model only: ${meanAbsErrSame == null ? 'n/a' : round(meanAbsErrSame)}  (baselines from the current grader — pure grader noise)`);
    console.log(`    └ note: ${crossModelCount}/${scoredItems.length} baselines came from a DIFFERENT model; their |err| is cross-model drift, not grader noise`);
  }
  console.log(`  mean stdev:          ${meanStdev == null ? 'n/a' : round(meanStdev)}  (run-to-run spread within an item)`);
  console.log(`  parse-fail rate:     ${round(parseFailPct)}%`);
  console.log('─────────────────────────────────────────────────────────────────────────');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
