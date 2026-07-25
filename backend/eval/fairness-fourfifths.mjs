/**
 * fairness-fourfifths.mjs — subgroup adverse-impact check on SYNTHETIC data (instructor feedback #2).
 * --------------------------------------------------------------------------------------------------
 * Runs the EEOC four-fifths (80%) rule (complianceService.fourFifths — the exact production code)
 * over synthetic cohorts NOW, without waiting for real outcome labels. Three scenarios:
 *
 *   1. BLIND scorer (the product's design): scores are drawn independent of subgroup and thresholded
 *      at 60 → "advanced". Expect impact ratios ≈ 1.0 and NO flag — evidence that rubric-anchored,
 *      attribute-blind scoring does not, by construction, induce disparate selection on synthetic data.
 *   2. BIASED scorer (counterfactual): one subgroup is penalized before thresholding. Expect the
 *      four-fifths monitor to FLAG it (< 0.80) — evidence the check actually detects adverse impact.
 *   3. SMALL-N: a subgroup below the privacy floor is suppressed (insufficient_data), not reported.
 *
 * Deterministic (fixed seed) → reproducible. Run:  node eval/fairness-fourfifths.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { barChart, mulberry32, saveSvg, saveJson, COLORS } from './lib/plot.mjs';

const require = createRequire(import.meta.url);
const comp = require('../src/services/complianceService');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'out');
const rng = mulberry32(19780828); // EEOC Uniform Guidelines year — a nod, and a fixed seed
const THRESHOLD = 60; // scoreSubmission's DEFAULT_THRESHOLD: >= 60 → "advance"
// Synthetic pilot cohort size per subgroup. The four-fifths ratio is itself noisy at small n
// (at n≈150 an identically-distributed group can dip below 0.80 by chance ~ a coin-flip), so we
// use a pilot-scale n where the expected-fair case reads as fair; the paper discusses this
// small-sample instability explicitly (it is why the MIN_GROUP_SAMPLE floor exists).
const N_GROUP = 500;

// Standard-normal via Box-Muller, from the seeded uniform rng.
function gauss(mean, sd) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Simulate one subgroup: draw `n` blind work-sample scores ~ N(mu, sd), clamp [0,100], threshold.
// `penalty` models a (counterfactual) biased scorer that systematically marks a subgroup down.
function simulateGroup(value, n, { mu = 64, sd = 16, penalty = 0 } = {}) {
  let selected = 0;
  for (let i = 0; i < n; i += 1) {
    const score = Math.max(0, Math.min(100, gauss(mu, sd) - penalty));
    if (score >= THRESHOLD) selected += 1;
  }
  return { value, n, selected };
}

function runScenario(label, groups) {
  const analysis = comp.fourFifths(groups, { minGroup: comp.MIN_GROUP_SAMPLE });
  return { label, input: groups, analysis };
}

// ── Scenario 1: BLIND scorer (fair by construction) ──
const blindGroups = [
  simulateGroup('Group A', N_GROUP),
  simulateGroup('Group B', N_GROUP),
  simulateGroup('Group C', N_GROUP),
  simulateGroup('Group D', N_GROUP),
];
const blind = runScenario('Blind scorer (attribute-independent)', blindGroups);

// ── Scenario 2: BIASED scorer (D penalized) — the detection test ──
const biasedGroups = [
  simulateGroup('Group A', N_GROUP),
  simulateGroup('Group B', N_GROUP),
  simulateGroup('Group C', N_GROUP),
  simulateGroup('Group D', N_GROUP, { penalty: 16 }), // systematic mark-down for one subgroup
];
const biased = runScenario('Biased scorer (Group D penalized) — counterfactual', biasedGroups);

// ── Scenario 3: SMALL-N privacy floor ──
const smallGroups = [simulateGroup('Majority', 120), simulateGroup('Tiny', 3)];
const small = runScenario('Small-n privacy floor', smallGroups);

// ── Console report ──
function printScenario(s) {
  console.log(`\n■ ${s.label}`);
  console.log(`  reference: ${s.analysis.reference_value ?? '—'}   flagged: ${s.analysis.flagged}   insufficient: ${s.analysis.insufficient}`);
  const pad = (v, w) => String(v).padStart(w);
  console.log(`  ${pad('group', 10)} ${pad('n', 4)} ${pad('selected', 9)} ${pad('rate', 7)} ${pad('impact', 7)} ${pad('suff', 5)}`);
  for (const g of s.analysis.groups) {
    console.log(`  ${pad(g.value, 10)} ${pad(g.n, 4)} ${pad(g.selected ?? '—', 9)} ${pad(g.rate != null ? (g.rate * 100).toFixed(1) + '%' : '—', 7)} ${pad(g.impact_ratio ?? '—', 7)} ${pad(g.sufficient, 5)}`);
  }
}

console.log('\nSUBGROUP FAIRNESS — EEOC four-fifths (80%) rule on synthetic cohorts (seed 19780828)');
printScenario(blind);
printScenario(biased);
printScenario(small);

const minRatio = (s) => Math.min(...s.analysis.groups.filter((g) => g.impact_ratio != null).map((g) => g.impact_ratio));
const blindMin = minRatio(blind);
const biasedMin = minRatio(biased);
console.log(`\nBlind scorer:  min impact ratio ${blindMin.toFixed(2)}  →  ${blind.analysis.flagged ? 'FLAGGED' : 'PASSES (>= 0.80)'}`);
console.log(`Biased scorer: min impact ratio ${biasedMin.toFixed(2)}  →  ${biased.analysis.flagged ? 'FLAGGED (< 0.80, detected)' : 'passes'}`);
console.log(`Small-n:       Tiny group suppressed → insufficient_data=${small.analysis.insufficient} (privacy floor ${comp.MIN_GROUP_SAMPLE})`);

// ── Figure: impact ratios, blind vs biased, with the 0.80 line ──
const groupNames = ['Group A', 'Group B', 'Group C', 'Group D'];
const ratioBy = (s) => Object.fromEntries(s.analysis.groups.map((g) => [g.value, g.impact_ratio]));
const rBlind = ratioBy(blind);
const rBiased = ratioBy(biased);
const fig = barChart({
  title: 'Adverse-impact ratio by subgroup (four-fifths rule)',
  ylabel: 'Impact ratio (group rate ÷ top rate)',
  yMax: 1.2,
  refLine: 0.8,
  refLabel: '0.80 four-fifths threshold',
  seriesColors: { 'Blind scorer': COLORS.clay, 'Biased scorer': COLORS.sand },
  groups: groupNames.map((name) => ({
    label: name,
    bars: [
      { series: 'Blind scorer', value: rBlind[name], flagged: rBlind[name] != null && rBlind[name] < 0.8 },
      { series: 'Biased scorer', value: rBiased[name], flagged: rBiased[name] != null && rBiased[name] < 0.8 },
    ],
  })),
  note: 'Blind scoring holds every subgroup at/above 0.80; penalizing Group D drops it below the line and the monitor flags it.',
});
saveSvg(OUT, 'fairness-fourfifths.svg', fig);

const out = {
  method: 'EEOC four-fifths (80%) rule via complianceService.fourFifths; synthetic cohorts; seed 19780828',
  threshold: THRESHOLD,
  min_group_sample: comp.MIN_GROUP_SAMPLE,
  scenarios: {
    blind: { flagged: blind.analysis.flagged, min_impact_ratio: +blindMin.toFixed(3), reference: blind.analysis.reference_value, groups: blind.analysis.groups },
    biased: { flagged: biased.analysis.flagged, min_impact_ratio: +biasedMin.toFixed(3), reference: biased.analysis.reference_value, groups: biased.analysis.groups },
    small_n: { insufficient: small.analysis.insufficient, groups: small.analysis.groups },
  },
};
saveJson(OUT, 'fairness-results.json', out);
console.log('\nWrote: out/fairness-fourfifths.svg, out/fairness-results.json\n');
