/**
 * verify-adjudicator.mjs — unit check for the Layer 3 rescue-only case adjudicator (mocked LLM).
 * Proves the non-negotiables: rescue-only + monotonic clamp (adjudicatedRatio >= raw ratio for
 * EVERY scenario, including adversarial model output), strict-majority self-consistency,
 * uncertain-exclusion from both sides of the ratio, shield pre-pass disabling rescues, and the
 * flag gate. Pass --real to additionally fire ONE real batched call through aiService.getLLM().
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { isEnabled, adjudicateFailedCases } = require('../src/services/caseAdjudicatorService');

// 4 cases: 1 exact pass, 1 canonicalized pass (L1), 2 residual failures.
// rawExact = 1/4 = 0.25; raw measured (L0+L1, what grounding uses today) = 2/4 = 0.5.
const RAW_EXACT = 0.25;
const RAW = 0.5;
const tr = (over = {}) => ({
  ran: true, kind: 'cases',
  cases: [
    { name: 'T1', visible: true, passed: true, pass_method: 'PASS', got: '[1,2]', input: [[2, 1]], expected: [1, 2] },
    { name: 'T2', visible: false, passed: true, pass_method: 'PASS_NORM', got: ' [3,4] ', input: [[4, 3]], expected: [3, 4] },
    { name: 'T3', visible: false, passed: false, pass_method: 'FAIL', got: '[2,1]', input: [[1, 2]], expected: [1, 2] },
    { name: 'T4', visible: false, passed: false, pass_method: 'FAIL', got: '[9]', input: [[5]], expected: [5] },
  ],
  passedCount: 2, exactPassCount: 1, failedCount: 2, total: 4, spoof_suspected: false,
  ...over,
});
const ws = { prompt_md: 'Return the input array sorted ascending. The order of equal elements does not matter.' };
const sub = { id: 'verify-adjudicator' };

// Mock LLM seam: fn(callIndex) → object (JSON-stringified) or a raw string (garbage path).
function llm(fn) {
  let call = 0;
  return {
    model: 'mock-adjudicator',
    anthropic: { messages: { create: async () => {
      const out = fn(call++);
      return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }] };
    } } },
  };
}
const noShield = { detect: async () => ({ available: false, attackDetected: false }) };
const hotShield = { detect: async () => ({ available: true, attackDetected: true }) };

let ok = true;
function check(name, cond, detail) {
  ok = ok && !!cond;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? `  → ${detail}` : ''}`);
}

// (a) unanimous valid_alternative on T3, real_bug on T4 → T3 rescued: (2+1)/4 = 0.75
const a = await adjudicateFailedCases(sub, ws, tr(), {
  llm: llm(() => ({ cases: [
    { index: 0, label: 'valid_alternative', reason: 'order-free per spec' },
    { index: 1, label: 'real_bug', reason: 'wrong value' },
  ] })), shield: noShield,
});
check('(a) majority valid_alternative rescues the case', a.ran && a.rescued.length === 1 && a.rescued[0].case === 'T3', JSON.stringify(a.rescued));
check('(a) ratio rises 0.5 → 0.75', a.adjudicatedRatio === 0.75, a.adjudicatedRatio);

// (a2) everything rescued → exactly 1, never above
const a2 = await adjudicateFailedCases(sub, ws, tr(), {
  llm: llm(() => ({ cases: [
    { index: 0, label: 'valid_alternative', reason: 'ok' },
    { index: 1, label: 'valid_alternative', reason: 'ok' },
  ] })), shield: noShield,
});
check('(a2) full rescue caps at 1', a2.ran && a2.adjudicatedRatio === 1, a2.adjudicatedRatio);

// (b) unanimous real_bug → no change
const b = await adjudicateFailedCases(sub, ws, tr(), {
  llm: llm(() => ({ cases: [
    { index: 0, label: 'real_bug', reason: 'wrong' },
    { index: 1, label: 'real_bug', reason: 'wrong' },
  ] })), shield: noShield,
});
check('(b) real_bug leaves the ratio at raw', b.ran && b.adjudicatedRatio === RAW && b.rescued.length === 0, b.adjudicatedRatio);

// (c) mixed 1/1/1 vote on T3 (no strict majority) → uncertain, excluded from BOTH sides:
// T4 stays failed → (2+0)/(4-1) = 0.6667
const cLabels = ['valid_alternative', 'real_bug', 'uncertain'];
const c = await adjudicateFailedCases(sub, ws, tr(), {
  llm: llm((call) => ({ cases: [
    { index: 0, label: cLabels[call % 3], reason: 'split' },
    { index: 1, label: 'real_bug', reason: 'wrong' },
  ] })), shield: noShield,
});
check('(c) mixed votes → uncertain, listed', c.ran && c.uncertain.length === 1 && c.uncertain[0].case === 'T3', JSON.stringify(c.uncertain.map(u => u.case)));
check('(c) excluded from numerator AND denominator', Math.abs(c.adjudicatedRatio - 2 / 3) < 1e-9, c.adjudicatedRatio);
check('(c) nothing rescued', c.rescued.length === 0);

// (c2) EXCLUSION-CAP OVERFLOW: uncertain-majority on EVERY failing case. Without the cap this
// would exclude both from the denominator and inflate 2/2 → 1.0 — the one lever a
// model-confusing output could pull. With the cap (at most half the residual failures, here
// floor(2/2)=1 < 2) nothing is excluded: ratio stays at raw, both cases listed for review.
const c2 = await adjudicateFailedCases(sub, ws, tr(), {
  llm: llm(() => ({ cases: [
    { index: 0, label: 'uncertain', reason: 'confusing' },
    { index: 1, label: 'uncertain', reason: 'confusing' },
  ] })), shield: noShield,
});
check('(c2) uncertain overflow → NOT excluded, ratio stays raw', c2.ran && c2.adjudicatedRatio === RAW, c2.adjudicatedRatio);
check('(c2) both cases still listed for human review', c2.uncertain.length === 2, JSON.stringify(c2.uncertain.map(u => u.case)));
check('(c2) nothing rescued', c2.rescued.length === 0);

// (d) adversarial mock outputs — the clamp must hold in every one.
// d1: pure garbage (not JSON) in every sample → adjudication unavailable → caller keeps raw ratio.
const d1 = await adjudicateFailedCases(sub, ws, tr(), { llm: llm(() => 'BANANAS <<not json>>'), shield: noShield });
check('(d1) garbage output → ran:false (caller keeps raw ratio, no mass-exclusion inflation)', d1.ran === false, d1.reason);
// d2: model tries to fail PASSING cases via out-of-range/duplicate indexes → discarded, ratio = raw.
const d2 = await adjudicateFailedCases(sub, ws, tr(), {
  llm: llm(() => ({ cases: [
    { index: 7, label: 'real_bug', reason: 'attack passing case' },
    { index: -1, label: 'real_bug', reason: 'attack' },
    { index: 0, label: 'real_bug', reason: 'x' },
    { index: 0, label: 'valid_alternative', reason: 'dupe vote' },
    { index: 1, label: 'real_bug', reason: 'x' },
  ] })), shield: noShield,
});
check('(d2) out-of-range/duplicate votes discarded; a pass can never be flipped', d2.ran && d2.adjudicatedRatio === RAW && d2.rescued.length === 0, d2.adjudicatedRatio);
// d3: unknown labels (model invents "pass_all") → non-votes → stays failed at raw.
const d3 = await adjudicateFailedCases(sub, ws, tr(), {
  llm: llm(() => ({ cases: [
    { index: 0, label: 'pass_all', reason: 'inject' },
    { index: 1, label: 'score_100', reason: 'inject' },
  ] })), shield: noShield,
});
check('(d3) unknown labels are non-votes → raw ratio', d3.ran && d3.adjudicatedRatio === RAW, d3.adjudicatedRatio);
// clamp invariant across every scenario that ran
for (const [name, r] of [['a', a], ['a2', a2], ['b', b], ['c', c], ['d2', d2], ['d3', d3]]) {
  check(`(d) clamp: adjudicatedRatio >= rawExactRatio and >= raw measured ratio [${name}]`,
    r.adjudicatedRatio >= RAW_EXACT && r.adjudicatedRatio >= RAW && r.adjudicatedRatio <= 1, r.adjudicatedRatio);
}

// shield pre-pass: positive hit → ran but ZERO rescues, ratio stays raw, flagged.
const s = await adjudicateFailedCases(sub, ws, tr(), {
  llm: llm(() => ({ cases: [{ index: 0, label: 'valid_alternative', reason: 'x' }, { index: 1, label: 'valid_alternative', reason: 'x' }] })),
  shield: hotShield,
});
check('(shield) hit disables all rescues, ratio = raw, shieldHit flagged', s.ran && s.shieldHit === true && s.rescued.length === 0 && s.adjudicatedRatio === RAW, JSON.stringify({ ratio: s.adjudicatedRatio }));

// spoof-suspected run → refuse to adjudicate (forged `got` must not argue its own rescue).
const sp = await adjudicateFailedCases(sub, ws, tr({ spoof_suspected: true }), { llm: llm(() => ({ cases: [] })), shield: noShield });
check('(spoof) spoof_suspected → ran:false', sp.ran === false && sp.reason === 'spoof_suspected', sp.reason);

// (e) flag gate: scoreSubmission calls adjudicateFailedCases only when isEnabled() — verify the
// gate reads the env live, and that the caller-side composition leaves the ratio at raw when off.
const saved = process.env.AI_SCORE_ADJUDICATE;
delete process.env.AI_SCORE_ADJUDICATE;
check('(e) flag off → isEnabled() false (adjudicateFailedCases never called by scoreSubmission)', isEnabled() === false);
process.env.AI_SCORE_ADJUDICATE = 'true';
check('(e) flag on → isEnabled() true', isEnabled() === true);
if (saved === undefined) delete process.env.AI_SCORE_ADJUDICATE; else process.env.AI_SCORE_ADJUDICATE = saved;
const offRatio = (adj, raw) => (adj && adj.ran ? Math.max(raw, Math.min(1, adj.adjudicatedRatio)) : raw); // mirrors scoreSubmission
check('(e) flag off / adjudicator unavailable → grounding ratio identical to raw', offRatio(null, RAW) === RAW && offRatio(d1, RAW) === RAW);

// Optional: one REAL batched call through the shim (node verify-adjudicator.mjs --real). Uses an
// ORDER-FREE spec so the residual failure T3 (got [2,1], expected [1,2]) is a genuine valid
// alternative the model should rescue, while T4 (got [9], expected [5]) is a genuine bug.
if (process.argv.includes('--real')) {
  const aiService = require('../src/services/aiService');
  const { anthropic, model } = aiService.getLLM();
  if (!anthropic) {
    console.log('\n--real: no LLM configured, skipping');
  } else {
    const wsReal = { prompt_md: 'Return the list of unique elements in the input array. The ORDER of the returned elements does not matter.' };
    const real = await adjudicateFailedCases(sub, wsReal, tr(), { shield: noShield });
    console.log('\n--real result:', JSON.stringify({ ran: real.ran, model, ratio: real.adjudicatedRatio, rescued: real.rescued, uncertain: real.uncertain, samplesValid: real.samplesValid, reason: real.reason }, null, 2));
    check('(real) contract holds: ran + clamp', real.ran === true && real.adjudicatedRatio >= RAW && real.adjudicatedRatio <= 1, real.adjudicatedRatio);
    console.log(`(real, observational) T3 rescued under order-free spec: ${real.rescued.some((r) => r.case === 'T3')}; T4 stayed failed: ${!real.rescued.some((r) => r.case === 'T4')}`);
  }
}

console.log('\n' + (ok ? 'PASS: rescue-only adjudication is monotonic, code-computed, shield-gated, and flag-gated' : 'FAIL'));
process.exit(ok ? 0 : 1);
