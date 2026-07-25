/**
 * verify-grounding.mjs — unit check for computeScore execution grounding (pure, no LLM/DB).
 * Proves that a MEASURED correctness ratio overrules the model on the tagged criterion, that the
 * final 0-100 stays code-computed, and that with no grounding the result is byte-identical.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { computeScore, pickGroundedCriterionId } = require('../src/services/proofScoringService');

const rubric = {
  criteria: [
    { id: 'correctness', requirement: 'Correct', points_possible: 60, weight: 1, measured: 'tests' },
    { id: 'quality', requirement: 'Quality', points_possible: 40, weight: 1 },
  ],
};
// The model over-claims correctness (60/60 — the exact injection failure mode); quality partial.
const per = [
  { id: 'correctness', points_awarded: 60, points_possible: 60, verdict: 'MET', evidence_quote: 'looks right', explanation: 'x' },
  { id: 'quality', points_awarded: 30, points_possible: 40, verdict: 'PARTIAL', evidence_quote: 'ok', explanation: 'y' },
];

const off = computeScore(rubric, per);
const on = computeScore(rubric, per, { ratio: 0.5, criterionId: 'correctness' }); // 50% hidden tests pass
const corr = on.per.find((p) => p.id === 'correctness');

console.log('flag OFF  normalized:', off.normalized, '(expect 90)  grounded:', off.grounded);
console.log('flag ON   normalized:', on.normalized, '(expect 60)  grounded:', on.grounded);
console.log('correctness overruled to', corr.points_awarded, '(expect 30)  verdict:', corr.verdict, ' measured:', corr.measured, ' ratio:', corr.test_pass_ratio);

// pickGroundedCriterionId: explicit tag wins; else a correctness-like label; else null (no overrule).
const pickLabel = pickGroundedCriterionId({ criteria: [{ id: 'quality', requirement: 'clean, readable code' }, { id: 'correctness', requirement: 'passes all the tests' }, { id: 'style' }] });
const pickNone = pickGroundedCriterionId({ criteria: [{ id: 'a', requirement: 'writeup quality' }, { id: 'b', requirement: 'communication' }] });
const pickTag = pickGroundedCriterionId({ criteria: [{ id: 'x', measured: 'tests', requirement: 'anything' }, { id: 'y', requirement: 'a correct solution' }] });
console.log('picker: label-match=', pickLabel, '(expect correctness)  no-match=', pickNone, '(expect null)  explicit-tag=', pickTag, '(expect x)');

const ok =
  off.normalized === 90 &&
  off.grounded === false &&
  on.normalized === 60 &&
  on.grounded === true &&
  corr.points_awarded === 30 &&
  corr.verdict === 'MEASURED' &&
  corr.measured === true &&
  pickLabel === 'correctness' &&
  pickNone === null &&
  pickTag === 'x';
console.log('\n' + (ok ? 'PASS: measured correctness overrules the model; final score stays code-computed' : 'FAIL'));
process.exit(ok ? 0 : 1);
