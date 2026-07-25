/**
 * Unit tests for calibrationService (CC3 / Calibrated Score + Benchmarks).
 * These cover the PURE math layer — percentiles, quantiles, histogram binning, known-denominator
 * outcome rates, band aggregation, lift, the calibrated likelihood band, and the histogram-based
 * percentile used for the anonymized global fallback. No DB, no PII → runs in CI / mock mode.
 * This is the load-bearing, must-be-honest logic of the moat, so it gets exhaustive coverage.
 */
const svc = require('../../src/services/calibrationService');

describe('rankStats', () => {
  test('midrank percentile + top_percent on a simple cohort', () => {
    const scores = [10, 20, 30, 40, 50];
    const r = svc.rankStats(scores, 30);
    expect(r.n).toBe(5);
    expect(r.below).toBe(2);
    expect(r.equal).toBe(1);
    expect(r.above).toBe(2);
    expect(r.percentile).toBe(50); // (2 + 0.5) / 5 = 50%
    expect(r.top_percent).toBe(40); // 2/5 scored higher
  });

  test('the single highest score is never reported as "top 0%" via midrank, but top_percent is 0', () => {
    const r = svc.rankStats([10, 20, 30, 40, 100], 100);
    expect(r.top_percent).toBe(0); // nobody scored higher
    expect(r.percentile).toBe(90); // (4 + 0.5)/5 = 90 — midrank, not 100
  });

  test('empty / non-numeric cohort yields null percentile (never a fabricated 0)', () => {
    expect(svc.rankStats([], 80).percentile).toBeNull();
    expect(svc.rankStats(['x', null], 80).percentile).toBeNull();
    expect(svc.rankStats([10, 20], 'nope').percentile).toBeNull();
  });
});

describe('quantiles', () => {
  test('linear-interpolated quantiles over a known set', () => {
    const q = svc.quantiles([0, 25, 50, 75, 100]);
    expect(q.n).toBe(5);
    expect(q.min).toBe(0);
    expect(q.max).toBe(100);
    expect(q.p50).toBe(50);
    expect(q.mean).toBe(50);
  });

  test('empty set → all null, no crash', () => {
    const q = svc.quantiles([]);
    expect(q.n).toBe(0);
    expect(q.p50).toBeNull();
    expect(q.mean).toBeNull();
  });
});

describe('histogram', () => {
  test('ten 10-pt bins; 100 lands in the inclusive top bin', () => {
    const bins = svc.histogram([0, 5, 9, 10, 95, 100]);
    expect(bins).toHaveLength(10);
    expect(bins[0]).toMatchObject({ lo: 0, hi: 9, n: 3 }); // 0,5,9
    expect(bins[1]).toMatchObject({ lo: 10, hi: 19, n: 1 }); // 10
    expect(bins[9]).toMatchObject({ lo: 90, hi: 100, n: 2 }); // 95,100
  });

  test('out-of-range + non-numeric scores are clamped / dropped', () => {
    const bins = svc.histogram([-5, 150, 'x', null]);
    expect(bins[0].n).toBe(1); // -5 clamps to 0
    expect(bins[9].n).toBe(1); // 150 clamps to 100
    const total = bins.reduce((a, b) => a + b.n, 0);
    expect(total).toBe(2); // 'x' and null dropped
  });
});

describe('knownRate (null is unknown, excluded from BOTH numerator and denominator)', () => {
  test('a null label never drags a rate down', () => {
    const rows = [
      { got_offer: true },
      { got_offer: false },
      { got_offer: null }, // unknown — excluded
      { got_offer: undefined }, // unknown — excluded
    ];
    const r = svc.knownRate(rows, 'got_offer');
    expect(r.n).toBe(2); // only the two KNOWN values
    expect(r.rate).toBe(50); // 1 of 2 known
  });

  test('only strict booleans count (truthy 1 / "true" are NOT known)', () => {
    const rows = [{ advanced: 1 }, { advanced: 'true' }, { advanced: true }];
    const r = svc.knownRate(rows, 'advanced');
    expect(r.n).toBe(1);
    expect(r.rate).toBe(100);
  });
});

describe('bands + rateBlock', () => {
  test('aggregates labeled rows into the three score bands with per-metric known-n', () => {
    const rows = [
      // 80-100: 2 advanced known (1 true), offers unknown
      { score: 95, advanced: true, got_offer: null, hired: null, retained_90d: null },
      { score: 82, advanced: false, got_offer: null, hired: null, retained_90d: null },
      // 60-79: 1 advanced true
      { score: 70, advanced: true, got_offer: true, hired: false, retained_90d: null },
    ];
    const bands = svc.bands(rows);
    const byKey = Object.fromEntries(bands.map((b) => [b.bucket, b]));
    expect(byKey['80-100'].n).toBe(2);
    expect(byKey['80-100'].advanced_rate).toBe(50);
    expect(byKey['80-100'].advanced_n).toBe(2);
    expect(byKey['80-100'].offer_rate).toBeNull(); // all offers unknown
    expect(byKey['60-79'].advanced_rate).toBe(100);
    expect(byKey['0-59'].n).toBe(0);
  });

  test('sufficient flips only at the MIN_BAND_SAMPLE threshold on the advance signal', () => {
    const below = Array.from({ length: svc.MIN_BAND_SAMPLE - 1 }, () => ({ score: 90, advanced: true }));
    const at = Array.from({ length: svc.MIN_BAND_SAMPLE }, () => ({ score: 90, advanced: true }));
    expect(svc.rateBlock(below).sufficient).toBe(false);
    expect(svc.rateBlock(at).sufficient).toBe(true);
  });
});

describe('liftOf', () => {
  test('band ÷ overall, rounded to 1 decimal', () => {
    expect(svc.liftOf(60, 20)).toBe(3);
    expect(svc.liftOf(33, 30)).toBe(1.1);
  });
  test('null/zero-safe (no Infinity headline)', () => {
    expect(svc.liftOf(50, 0)).toBeNull();
    expect(svc.liftOf(null, 20)).toBeNull();
    expect(svc.liftOf(50, null)).toBeNull();
  });
});

describe('likelihood', () => {
  test('uses the OUTCOME advance rate when the band is sufficient', () => {
    expect(svc.likelihood({ bandAdvancedRate: 70, bandSufficient: true, topPercent: 99 }))
      .toMatchObject({ label: 'Likely to clear an onsite', basis: 'outcome', confidence: 'calibrated' });
    expect(svc.likelihood({ bandAdvancedRate: 40, bandSufficient: true, topPercent: 5 }).basis).toBe('outcome');
    expect(svc.likelihood({ bandAdvancedRate: 10, bandSufficient: true, topPercent: 5 }).label)
      .toBe('Unlikely to clear an onsite');
  });

  test('falls back to a TRANSPARENT score-percentile heuristic when outcomes are thin', () => {
    const r = svc.likelihood({ bandAdvancedRate: null, bandSufficient: false, topPercent: 10 });
    expect(r.basis).toBe('percentile');
    expect(r.confidence).toBe('uncalibrated');
    expect(r.label).toBe('Strong relative score');
  });

  test('no data at all → honest "not enough data"', () => {
    expect(svc.likelihood({ bandAdvancedRate: null, bandSufficient: false, topPercent: null }))
      .toMatchObject({ basis: 'none', confidence: 'none' });
  });
});

describe('percentileFromHistogram (anonymized global fallback)', () => {
  test('estimates a percentile from bin counts only', () => {
    const bins = svc.histogram([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const r = svc.percentileFromHistogram(bins, 100);
    expect(r.n).toBe(10);
    expect(r.percentile).toBeGreaterThanOrEqual(90);
    expect(r.top_percent).toBeLessThanOrEqual(10);
  });
  test('empty histogram → null', () => {
    const r = svc.percentileFromHistogram(svc.histogram([]), 80);
    expect(r.percentile).toBeNull();
  });
});

describe('reportFromRows', () => {
  test('separates the distribution basis (all scored) from the calibration basis (labeled)', () => {
    const rows = [
      { score: 90, role_family: 'backend', labeled: true, advanced: true, got_offer: true, hired: null, retained_90d: null },
      { score: 85, role_family: 'backend', labeled: false, advanced: null, got_offer: null, hired: null, retained_90d: null },
      { score: 40, role_family: 'frontend', labeled: true, advanced: false, got_offer: false, hired: null, retained_90d: null },
    ];
    const rep = svc.reportFromRows(rows, 'backend');
    expect(rep.role_family).toBe('backend');
    expect(rep.scored_size).toBe(2); // both backend rows have a score
    expect(rep.sample_size).toBe(1); // only one backend row is labeled
    expect(rep.distribution.reduce((a, b) => a + b.n, 0)).toBe(2);
    expect(rep.outcome_rates.advanced_rate).toBe(100); // 1/1 known advanced=true
  });
});

// S3-1 (v2-hardening): k-anonymity guard for the CROSS-ACCOUNT global fallback. A score band
// can be backed by a single other tenant's candidate (advanced_n=1, advanced_rate=100); that
// per-band rate must NOT be surfaced. suppressThinBandRates nulls any per-metric rate whose
// known-n is below MIN_BAND_SAMPLE, while keeping the (anonymized) counts.
describe('suppressThinBandRates (cross-account k-anonymity)', () => {
  const FLOOR = svc.MIN_BAND_SAMPLE; // 8

  test('nulls a per-metric rate when its known-n is below the floor; keeps the count', () => {
    const band = {
      bucket: '80-100', n: 12, sufficient: true,
      advanced_rate: 100, advanced_n: 1,        // thin → must be suppressed
      offer_rate: 50, offer_n: 10,              // >= floor → kept
      hire_rate: 100, hire_n: 2,                // thin → suppressed
      retention_90d_rate: 0, retention_90d_n: 9, // >= floor → kept
    };
    const out = svc.suppressThinBandRates(band, FLOOR);
    expect(out.advanced_rate).toBeNull();
    expect(out.advanced_n).toBe(1); // anonymized count is retained
    expect(out.offer_rate).toBe(50);
    expect(out.hire_rate).toBeNull();
    expect(out.retention_90d_rate).toBe(0); // a real 0% with enough sample is kept, not nulled
  });

  test('a fully-sufficient band is returned unchanged; null band stays null', () => {
    const band = {
      bucket: '60-79', n: 20, sufficient: true,
      advanced_rate: 70, advanced_n: 20, offer_rate: 40, offer_n: 18,
      hire_rate: 25, hire_n: 16, retention_90d_rate: 90, retention_90d_n: 10,
    };
    const out = svc.suppressThinBandRates(band, FLOOR);
    expect(out.advanced_rate).toBe(70);
    expect(out.offer_rate).toBe(40);
    expect(out.hire_rate).toBe(25);
    expect(out.retention_90d_rate).toBe(90);
    expect(svc.suppressThinBandRates(null, FLOOR)).toBeNull();
  });
});

// S3-2 (v2-hardening-2): k-anonymity by DISTINCT TENANTS. A "global" benchmark must combine
// >= MIN_DISTINCT_ACCOUNTS distinct accounts — a corpus of many rows from ONE account is not
// publishable as a global aggregate (it would leak that account's per-role rates).
describe('distinctAccountCount + MIN_DISTINCT_ACCOUNTS (global k-anonymity by tenant)', () => {
  test('MIN_DISTINCT_ACCOUNTS is a documented floor (default 5)', () => {
    expect(svc.MIN_DISTINCT_ACCOUNTS).toBeGreaterThanOrEqual(5);
  });

  test('counts distinct account_id, optionally role-scoped', () => {
    const rows = [
      { account_id: 'a', role_family: 'backend', score: 90 },
      { account_id: 'a', role_family: 'backend', score: 80 }, // same account → still 1
      { account_id: 'b', role_family: 'backend', score: 70 },
      { account_id: 'c', role_family: 'frontend', score: 60 },
      { account_id: null, role_family: 'backend', score: 50 }, // null ignored
    ];
    expect(svc.distinctAccountCount(rows)).toBe(3); // a, b, c
    expect(svc.distinctAccountCount(rows, 'backend')).toBe(2); // a, b
    expect(svc.distinctAccountCount(rows, 'frontend')).toBe(1); // c
  });

  test('a 50-row corpus from ONE account is below the distinct-account floor (not publishable)', () => {
    const single = Array.from({ length: 50 }, (_, i) => ({ account_id: 'solo', role_family: 'backend', score: 50 + (i % 50) }));
    expect(svc.distinctAccountCount(single)).toBe(1);
    expect(svc.distinctAccountCount(single) >= svc.MIN_DISTINCT_ACCOUNTS).toBe(false); // → global suppressed
  });

  test('>= 5 distinct accounts clears the floor', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ account_id: id, role_family: 'backend', score: 75 }));
    expect(svc.distinctAccountCount(many)).toBe(6);
    expect(svc.distinctAccountCount(many) >= svc.MIN_DISTINCT_ACCOUNTS).toBe(true);
  });
});

// S4-5 (v2-hardening-2): the passport-entry percentile must be ROLE-SCOPED via the calibration
// engine (computeCalibration), honoring the sample floor — not an ad-hoc global query. These
// pin the role-scoping + the honest-null degrade the route relies on.
describe('computeCalibration percentile is role-scoped + floor-honest (S4-5)', () => {
  test('ranks within the role cohort, ignoring other roles', () => {
    const rows = [];
    for (let i = 0; i < 13; i += 1) rows.push({ role_family: 'backend', score: 10 + i * 4, labeled: false }); // 10..58
    for (const s of [90, 95, 99]) rows.push({ role_family: 'frontend', score: s, labeled: false }); // higher, other role
    const cal = svc.computeCalibration({ score: 80, roleFamily: 'backend', rows });
    expect(cal.scope).toBe('role');
    // 80 tops the backend cohort (role-scoped → ~100). A GLOBAL rank would be ~81 (below the
    // frontend 90/95/99). Asserting >=90 proves the percentile ignored the other role.
    expect(cal.percentile).toBeGreaterThanOrEqual(90);
  });

  test('below the role sample floor → heuristic scope, null percentile (no fabricated precision)', () => {
    const few = [
      { role_family: 'backend', score: 70, labeled: false },
      { role_family: 'backend', score: 80, labeled: false },
    ];
    const cal = svc.computeCalibration({ score: 75, roleFamily: 'backend', rows: few });
    expect(cal.scope).toBe('heuristic');
    expect(cal.percentile).toBeNull();
  });
});

// Cold-start calibration (empirical-Bayes shrinkage) — instructor feedback #1. The raw band needs
// MIN_BAND_SAMPLE labeled outcomes; below that we return a Beta-Binomial POSTERIOR (prior shrunk
// toward the observed count) so calibration is useful in early testing instead of collapsing to
// "insufficient". Pure math → runs in CI / mock mode.
describe('incomplete beta (betai) + betaQuantile', () => {
  test('betai matches known symmetric values', () => {
    expect(svc.betai(0.5, 1, 1)).toBeCloseTo(0.5, 6); // uniform CDF at 0.5
    expect(svc.betai(0.5, 2, 2)).toBeCloseTo(0.5, 6); // symmetric
    expect(svc.betai(0, 2, 3)).toBe(0);
    expect(svc.betai(1, 2, 3)).toBe(1);
    expect(svc.betai(0.5, 2, 8)).toBeGreaterThan(0.9); // mass concentrated near 0.2
  });
  test('betai is monotonically increasing in x', () => {
    let prev = -1;
    for (let x = 0; x <= 1.0001; x += 0.1) {
      const v = svc.betai(Math.min(1, x), 3, 5);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  test('betaQuantile inverts betai (median of symmetric Beta is 0.5)', () => {
    expect(svc.betaQuantile(0.5, 2, 2)).toBeCloseTo(0.5, 3);
    const q = svc.betaQuantile(0.9, 3, 5);
    expect(svc.betai(q, 3, 5)).toBeCloseTo(0.9, 3);
    expect(svc.betaQuantile(0, 2, 2)).toBe(0);
    expect(svc.betaQuantile(1, 2, 2)).toBe(1);
  });
});

describe('shrinkRate (Beta-Binomial cold-start posterior)', () => {
  test('n=0 returns the PRIOR itself, tier "prior", with a wide credible interval', () => {
    const r = svc.shrinkRate({ selected: 0, n: 0, priorMean: 0.7 });
    expect(r.tier).toBe('prior');
    expect(r.advanced_rate).toBeCloseTo(70, 1); // posterior == prior mean when there is no data
    expect(r.ci_low).toBeGreaterThanOrEqual(0);
    expect(r.ci_high).toBeLessThanOrEqual(100);
    expect(r.ci_high - r.ci_low).toBeGreaterThan(40); // wide: honest about the uncertainty
  });

  test('0 < n < MIN_BAND_SAMPLE → "provisional"; posterior mean sits between prior and MLE', () => {
    const r = svc.shrinkRate({ selected: 3, n: 4, priorMean: 0.7 }); // MLE 75%, prior 70%
    expect(r.tier).toBe('provisional');
    expect(r.advanced_rate).toBeGreaterThan(70); // pulled up toward the 75% observation
    expect(r.advanced_rate).toBeLessThan(75); // but shrunk back toward the prior
  });

  test('n >= MIN_BAND_SAMPLE → "calibrated"; converges to the MLE with a tighter interval', () => {
    const few = svc.shrinkRate({ selected: 3, n: 4, priorMean: 0.7 });
    const many = svc.shrinkRate({ selected: 60, n: 100, priorMean: 0.7 });
    expect(many.tier).toBe('calibrated');
    expect(many.advanced_rate).toBeGreaterThan(58); // ~60% MLE, prior nearly washed out
    expect(many.advanced_rate).toBeLessThan(63);
    expect(many.ci_high - many.ci_low).toBeLessThan(few.ci_high - few.ci_low); // interval narrows with n
    expect(many.ci_low).toBeLessThan(many.advanced_rate);
    expect(many.advanced_rate).toBeLessThan(many.ci_high);
  });

  test('robust: clamps selected into [0,n], coerces junk, never NaN/throws', () => {
    expect(() => svc.shrinkRate({ selected: 99, n: 5, priorMean: 0.5 })).not.toThrow();
    const clamped = svc.shrinkRate({ selected: 99, n: 5, priorMean: 0.5 }); // selected → 5
    expect(clamped.selected).toBe(5);
    expect(Number.isFinite(clamped.advanced_rate)).toBe(true);
    const junk = svc.shrinkRate({ selected: 'x', n: -3, priorMean: 2 }); // n→0, prior clamps to 1
    expect(junk.n).toBe(0);
    expect(Number.isFinite(junk.advanced_rate)).toBe(true);
  });
});

describe('computeCalibration attaches a cold-start estimate on every path', () => {
  test('cold start (no labels) → estimate tier "prior" at the band prior, not a dead end', () => {
    const few = [
      { role_family: 'backend', score: 70, labeled: false },
      { role_family: 'backend', score: 80, labeled: false },
    ];
    const cal = svc.computeCalibration({ score: 75, roleFamily: 'backend', rows: few });
    expect(cal.scope).toBe('heuristic'); // hard flag still honest…
    expect(cal.estimate).toBeTruthy(); // …but a usable estimate is now always present
    expect(cal.estimate.tier).toBe('prior');
    expect(cal.estimate.prior_mean).toBeCloseTo(45, 0); // COLD_START_PRIOR['60-79'] = 0.45
  });

  test('a role band with a few labels → estimate tier "provisional" (shrunk), band still not "sufficient"', () => {
    const rows = [];
    for (let i = 0; i < 12; i += 1) rows.push({ role_family: 'backend', score: 82 + (i % 4), labeled: false });
    rows.push({ role_family: 'backend', score: 90, labeled: true, advanced: true, got_offer: null, hired: null, retained_90d: null });
    rows.push({ role_family: 'backend', score: 95, labeled: true, advanced: true, got_offer: null, hired: null, retained_90d: null });
    rows.push({ role_family: 'backend', score: 88, labeled: true, advanced: false, got_offer: null, hired: null, retained_90d: null });
    const cal = svc.computeCalibration({ score: 92, roleFamily: 'backend', rows });
    expect(cal.scope).toBe('role');
    expect(cal.estimate.tier).toBe('provisional');
    expect(cal.estimate.n).toBe(3); // 3 labeled outcomes in the 80-100 band
    expect(cal.band.sufficient).toBe(false); // still below the raw MIN_BAND_SAMPLE headline floor
  });
});
