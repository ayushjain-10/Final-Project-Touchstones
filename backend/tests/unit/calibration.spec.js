/**
 * Unit tests for the outcome-flywheel calibration helpers (Feature 1). These are PURE
 * and env-independent: bucketing + aggregation contain no PII and never touch the DB,
 * so they run in CI / mock mode. They are the load-bearing logic of the calibration moat.
 */
const { bucketForScore, calibrate, SCORE_BUCKETS } = require('../../src/routes/supabase/outcomes');

describe('bucketForScore', () => {
  test('maps scores to the three bands at their boundaries', () => {
    expect(bucketForScore(0)).toBe('0-59');
    expect(bucketForScore(59)).toBe('0-59');
    expect(bucketForScore(60)).toBe('60-79');
    expect(bucketForScore(79)).toBe('60-79');
    expect(bucketForScore(80)).toBe('80-100');
    expect(bucketForScore(100)).toBe('80-100');
  });

  test('clamps out-of-range scores into the end bands', () => {
    expect(bucketForScore(-10)).toBe('0-59');
    expect(bucketForScore(150)).toBe('80-100');
  });

  test('returns null for non-numeric input', () => {
    expect(bucketForScore('not a number')).toBeNull();
    expect(bucketForScore(null)).toBeNull();
    expect(bucketForScore(undefined)).toBeNull();
    expect(bucketForScore(NaN)).toBeNull();
  });
});

describe('calibrate', () => {
  test('empty input yields all three buckets with null rates', () => {
    const out = calibrate([]);
    expect(out).toHaveLength(SCORE_BUCKETS.length);
    for (const b of out) {
      expect(b.n).toBe(0);
      expect(b.offer_rate).toBeNull();
      expect(b.hire_rate).toBeNull();
      expect(b.retention_90d_rate).toBeNull();
    }
  });

  test('computes per-bucket offer/hire/retention rates as percentages', () => {
    const rows = [
      // 80-100 band: 2 rows, 1 offer, 1 hire, 0 retained
      { score: 90, got_offer: true, hired: true, retained_90d: false },
      { score: 85, got_offer: false, hired: false, retained_90d: false },
      // 60-79 band: 1 row, fully positive
      { score: 70, got_offer: true, hired: true, retained_90d: true },
      // 0-59 band: 1 row, nothing
      { score: 30, got_offer: false, hired: false, retained_90d: false },
    ];
    const out = calibrate(rows);
    const byKey = Object.fromEntries(out.map((b) => [b.bucket, b]));

    expect(byKey['80-100'].n).toBe(2);
    expect(byKey['80-100'].offer_rate).toBe(50);   // 1/2
    expect(byKey['80-100'].hire_rate).toBe(50);    // 1/2
    expect(byKey['80-100'].retention_90d_rate).toBe(0);

    expect(byKey['60-79'].n).toBe(1);
    expect(byKey['60-79'].offer_rate).toBe(100);
    expect(byKey['60-79'].retention_90d_rate).toBe(100);

    expect(byKey['0-59'].n).toBe(1);
    expect(byKey['0-59'].offer_rate).toBe(0);
  });

  test('each rate is over its KNOWN denominator: null/unknown excluded from BOTH numerator and denominator', () => {
    const rows = [
      { score: 90, got_offer: true, hired: true, retained_90d: true },
      { score: 90, got_offer: false, hired: null, retained_90d: null },
      { score: 90, got_offer: null, hired: null, retained_90d: null },
      { score: 90, got_offer: 'true', hired: 1, retained_90d: false }, // truthy-but-not-true is neither true nor false → unknown
    ];
    const out = calibrate(rows);
    const band = out.find((b) => b.bucket === '80-100');
    expect(band.n).toBe(4); // n stays the band size (count of labeled submissions in the band)
    // offer known = {true, false} = 2 ('true' string and null both excluded); 1 yes → 1/2
    expect(band.offer_rate).toBe(50);
    // hire known = {true} = 1 (null, null, and 1 all excluded); 1 yes → 1/1
    expect(band.hire_rate).toBe(100);
    // retention known = {true, false} = 2 (nulls excluded); 1 yes → 1/2
    expect(band.retention_90d_rate).toBe(50);
  });

  test('a rate is null (not 0) when every outcome for that metric is unknown', () => {
    const rows = [
      { score: 90, got_offer: true, hired: null, retained_90d: null },
      { score: 90, got_offer: false, hired: null, retained_90d: null },
    ];
    const band = calibrate(rows).find((b) => b.bucket === '80-100');
    expect(band.n).toBe(2);
    expect(band.offer_rate).toBe(50); // 1 of 2 known
    expect(band.hire_rate).toBeNull(); // 0 known → null, never a misleading 0%
    expect(band.retention_90d_rate).toBeNull();
  });

  test('rows with an unbucketable score are dropped, not crashed', () => {
    const out = calibrate([{ score: 'x', got_offer: true, hired: true, retained_90d: true }]);
    for (const b of out) expect(b.n).toBe(0);
  });
});
