/**
 * calibration-coldstart.mjs — quantifies the cold-start fix (instructor feedback #1).
 * ----------------------------------------------------------------------------------
 * Question: before enough downstream outcome labels exist, does the empirical-Bayes posterior
 * (calibrationService.shrinkRate) give a MORE useful and MORE accurate band than the raw
 * selected/n rate — which the product must SUPPRESS below MIN_BAND_SAMPLE (=8) as "insufficient"?
 *
 * Method: a seeded Monte-Carlo. For each score band we fix a TRUE advance probability, draw
 * `selected ~ Binomial(N, p_true)` for a grid of label counts N, and compare:
 *   • raw MLE rate  (unavailable below MIN_BAND_SAMPLE — the "insufficient data" state)
 *   • shrunk posterior mean (always available; prior → provisional → calibrated)
 * We report mean-absolute-error vs the truth, the 90% credible-interval coverage, and the share
 * of results that are decision-ready. Deterministic (fixed seed) → the paper's numbers reproduce.
 *
 * Run:  node eval/calibration-coldstart.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineChart, mulberry32, binomial, saveSvg, saveJson, COLORS } from './lib/plot.mjs';

const require = createRequire(import.meta.url);
const cal = require('../src/services/calibrationService');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'out');

// TRUE advance probability per band (the world we're trying to recover). Deliberately OFFSET from
// the service's COLD_START_PRIOR (0.20/0.45/0.70) so the prior is a reasonable-but-imperfect start
// the data must correct — exactly the realistic cold-start condition.
const P_TRUE = { '0-59': 0.25, '60-79': 0.52, '80-100': 0.74 };
const PRIOR = cal.COLD_START_PRIOR;
const BANDS = Object.keys(P_TRUE);
const N_GRID = [0, 2, 4, 6, 8, 12, 16, 24, 40, 64, 120];
const TRIALS = 4000;
const MIN_BAND = cal.MIN_BAND_SAMPLE; // 8 — the raw "sufficient" floor
const rng = mulberry32(20260725);

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// perN[N] = { maeRaw, maeShrunk, rmseRaw, rmseShrunk, coverage, availRaw, availShrunk }
const perN = {};
for (const N of N_GRID) {
  const errRaw = [];
  const errShrunk = [];
  const sqRaw = [];
  const sqShrunk = [];
  const covered = [];
  for (const band of BANDS) {
    const truth = P_TRUE[band] * 100;
    const priorMean = PRIOR[band];
    for (let t = 0; t < TRIALS; t += 1) {
      const selected = binomial(N, P_TRUE[band], rng);
      const shrunk = cal.shrinkRate({ selected, n: N, priorMean });
      const eS = Math.abs(shrunk.advanced_rate - truth);
      errShrunk.push(eS);
      sqShrunk.push(eS * eS);
      covered.push(shrunk.ci_low <= truth && truth <= shrunk.ci_high ? 1 : 0);
      if (N > 0) {
        const raw = (selected / N) * 100; // the MLE (what we'd show without shrinkage)
        const eR = Math.abs(raw - truth);
        errRaw.push(eR);
        sqRaw.push(eR * eR);
      }
    }
  }
  perN[N] = {
    N,
    maeRaw: N > 0 ? +mean(errRaw).toFixed(2) : null,
    maeShrunk: +mean(errShrunk).toFixed(2),
    rmseRaw: N > 0 ? +Math.sqrt(mean(sqRaw)).toFixed(2) : null,
    rmseShrunk: +Math.sqrt(mean(sqShrunk)).toFixed(2),
    ci90_coverage: +(mean(covered) * 100).toFixed(1),
    // "decision-ready": the raw band is SUPPRESSED below MIN_BAND_SAMPLE (insufficient_data);
    // the shrunk estimate is always available (prior/provisional/calibrated).
    avail_raw_pct: N >= MIN_BAND ? 100 : 0,
    avail_shrunk_pct: 100,
  };
}

// ── Headline summary for the paper ──
const cold = N_GRID.filter((n) => n > 0 && n < MIN_BAND); // 2,4,6 — the deep cold-start regime
const maeRawCold = +mean(cold.map((n) => perN[n].maeRaw)).toFixed(2);
const maeShrunkCold = +mean(cold.map((n) => perN[n].maeShrunk)).toFixed(2);
const covAll = +mean(N_GRID.map((n) => perN[n].ci90_coverage)).toFixed(1);
const summary = {
  method: `Beta-Binomial shrinkage vs raw MLE; ${TRIALS} trials/band; seed 20260725`,
  bands: BANDS,
  p_true: P_TRUE,
  prior: PRIOR,
  prior_strength: cal.PRIOR_STRENGTH,
  min_band_sample: MIN_BAND,
  headline: {
    cold_start_regime: `N=${cold.join(',')} labeled outcomes`,
    mae_raw_pp: maeRawCold,
    mae_shrunk_pp: maeShrunkCold,
    error_reduction_pct: +(((maeRawCold - maeShrunkCold) / maeRawCold) * 100).toFixed(1),
    availability_below_floor: 'raw 0% (insufficient_data) vs shrunk 100% (provisional/prior)',
    mae_at_N0_prior_only_pp: perN[0].maeShrunk,
    ci90_coverage_mean_pct: covAll,
  },
  per_n: N_GRID.map((n) => perN[n]),
};

// ── Console table ──
const pad = (s, w) => String(s).padStart(w);
console.log('\nCOLD-START CALIBRATION — shrinkage posterior vs raw MLE (seed 20260725)\n');
console.log(`${pad('N', 4)} ${pad('MAE_raw', 9)} ${pad('MAE_shrunk', 11)} ${pad('RMSE_raw', 9)} ${pad('RMSE_shr', 9)} ${pad('CI90_cov%', 10)} ${pad('avail_raw', 10)} ${pad('avail_shr', 10)}`);
for (const n of N_GRID) {
  const r = perN[n];
  console.log(`${pad(n, 4)} ${pad(r.maeRaw ?? '—', 9)} ${pad(r.maeShrunk, 11)} ${pad(r.rmseRaw ?? '—', 9)} ${pad(r.rmseShrunk, 9)} ${pad(r.ci90_coverage, 10)} ${pad(r.avail_raw_pct + '%', 10)} ${pad(r.avail_shrunk_pct + '%', 10)}`);
}
console.log(`\nDeep cold start (N=${cold.join(',')}):  MAE raw ${maeRawCold}pp  →  shrunk ${maeShrunkCold}pp  (${summary.headline.error_reduction_pct}% lower error)`);
console.log(`At N=0 the shrunk estimate is the prior (MAE ${perN[0].maeShrunk}pp) and IS available; the raw band is suppressed as "insufficient".`);
console.log(`Mean 90% credible-interval coverage: ${covAll}%  (well-calibrated ≈ 90%).`);

// ── Figure 1: accuracy (MAE vs N) ──
const fig1 = lineChart({
  title: 'Cold-start accuracy: shrinkage posterior vs. raw rate',
  xlabel: 'Labeled outcomes in the score band (N)',
  ylabel: 'Mean absolute error (pp)',
  yMin: 0,
  yMax: 30,
  domain: N_GRID,
  series: [
    { label: 'Raw MLE (selected/n)', color: COLORS.gray, points: N_GRID.filter((n) => n > 0).map((n) => [n, perN[n].maeRaw]) },
    { label: 'Shrinkage posterior', color: COLORS.clay, points: N_GRID.map((n) => [n, perN[n].maeShrunk]) },
  ],
  note: 'Lower is better. Shrinkage cuts error when labels are scarce and converges to the raw rate as data arrives.',
});
saveSvg(OUT, 'coldstart-accuracy.svg', fig1);

// ── Figure 2: availability (% decision-ready) ──
const fig2 = lineChart({
  title: 'Cold-start availability: share of bands that yield a usable estimate',
  xlabel: 'Labeled outcomes in the score band (N)',
  ylabel: 'Decision-ready (%)',
  yMin: 0,
  yMax: 105,
  domain: N_GRID,
  series: [
    { label: 'Raw band (suppressed < 8)', color: COLORS.gray, dashed: true, points: N_GRID.map((n) => [n, perN[n].avail_raw_pct]) },
    { label: 'Shrinkage estimate', color: COLORS.clay, points: N_GRID.map((n) => [n, perN[n].avail_shrunk_pct]) },
  ],
  note: 'The raw band shows nothing until it has 8 labeled outcomes; the shrunk estimate is always available (tiered by confidence).',
});
saveSvg(OUT, 'coldstart-availability.svg', fig2);

saveJson(OUT, 'coldstart-results.json', summary);
console.log(`\nWrote: out/coldstart-accuracy.svg, out/coldstart-availability.svg, out/coldstart-results.json\n`);
