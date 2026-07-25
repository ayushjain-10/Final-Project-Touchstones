/**
 * complianceService — EEOC four-fifths math + honest small-n handling (PURE, env-independent),
 * plus a migration-content RLS regression on the sensitive labels table (063). The behavioral
 * cross-tenant RLS test (the real Postgres boundary) is complianceRls.test.js (hard-auth honeypot)
 * + a live PostgREST check at ship time — jest runs against a mock DB so RLS can't be exercised here.
 */
const fs = require('fs');
const path = require('path');
const svc = require('../../src/services/complianceService');

describe('fourFifths (EEOC 80% rule)', () => {
  test('classic adverse-impact table: lower-rate group flags below 0.80', () => {
    // Men 48/80 = 0.60 (reference); Women 12/40 = 0.30 → ratio 0.50 < 0.80 → flagged.
    const r = svc.fourFifths([
      { value: 'Men', n: 80, selected: 48 },
      { value: 'Women', n: 40, selected: 12 },
    ], { minGroup: 5 });
    expect(r.insufficient).toBe(false);
    expect(r.reference_value).toBe('Men');
    expect(r.reference_rate).toBe(0.6);
    const men = r.groups.find((g) => g.value === 'Men');
    const women = r.groups.find((g) => g.value === 'Women');
    expect(men.rate).toBe(0.6);
    expect(men.impact_ratio).toBe(1);
    expect(women.rate).toBe(0.3);
    expect(women.impact_ratio).toBe(0.5);
    expect(r.flagged).toBe(true);
  });

  test('a group at exactly 0.90 of the reference passes (>= 0.80)', () => {
    const r = svc.fourFifths([
      { value: 'A', n: 50, selected: 40 }, // 0.80 (reference)
      { value: 'B', n: 50, selected: 36 }, // 0.72 → 0.72/0.80 = 0.90
    ], { minGroup: 5 });
    expect(r.flagged).toBe(false);
    expect(r.groups.find((g) => g.value === 'B').impact_ratio).toBe(0.9);
    expect(r.reference_value).toBe('A');
  });

  test('the reference group is always the HIGHEST selection rate (ratio 1.0)', () => {
    const r = svc.fourFifths([
      { value: 'Low', n: 30, selected: 9 }, // 0.30
      { value: 'High', n: 30, selected: 24 }, // 0.80 (reference)
    ], { minGroup: 5 });
    expect(r.reference_value).toBe('High');
    expect(r.groups.find((g) => g.value === 'High').impact_ratio).toBe(1);
    expect(r.groups.find((g) => g.value === 'Low').impact_ratio).toBe(0.37); // 0.30/0.80 = 0.37499.. → 0.37
    expect(r.flagged).toBe(true);
  });

  // CC1-1 (v3-hardening-2): the flag must use the UNROUNDED ratio. A raw 0.795 (genuinely
  // adverse, < 0.80) must NOT round to 0.80 on display and thereby escape the flag.
  test('[CC1-1] a raw ratio of 0.795 is FLAGGED even though it displays as 0.80', () => {
    const r = svc.fourFifths([
      { value: 'Ref', n: 200, selected: 200 }, // rate 1.0 (reference)
      { value: 'Y', n: 200, selected: 159 }, // rate 0.795 → raw ratio 0.795 < 0.80
    ], { minGroup: 5 });
    const y = r.groups.find((g) => g.value === 'Y');
    expect(y.impact_ratio).toBe(0.8); // display rounds to 0.80…
    expect(r.flagged).toBe(true); // …but the FLAG fires on the raw 0.795 (no boundary miss)
  });
});

describe('fourFifths insufficient_data (honest small-n handling)', () => {
  test('a group below the floor is suppressed (rate + ratio null), no fabricated precision', () => {
    const r = svc.fourFifths([
      { value: 'A', n: 50, selected: 30 },
      { value: 'B', n: 3, selected: 1 }, // n < 5 → insufficient
    ], { minGroup: 5 });
    const B = r.groups.find((g) => g.value === 'B');
    expect(B.sufficient).toBe(false);
    expect(B.rate).toBeNull();
    expect(B.impact_ratio).toBeNull();
    // only ONE sufficient group remains → cannot compute a comparison.
    expect(r.insufficient).toBe(true);
    expect(r.flagged).toBe(false);
    expect(r.reference_value).toBeNull();
  });

  test('all groups below the floor → insufficient, group size kept, ratios suppressed', () => {
    const r = svc.fourFifths([
      { value: 'A', n: 2, selected: 1 },
      { value: 'B', n: 4, selected: 0 },
    ], { minGroup: 5 });
    expect(r.insufficient).toBe(true);
    r.groups.forEach((g) => {
      expect(g.impact_ratio).toBeNull();
      expect(g.rate).toBeNull();
    });
    expect(r.groups.find((g) => g.value === 'A').n).toBe(2); // group size retained
  });

  // v3-hardening re-identification guard: a sub-floor group must NOT expose its exact SELECTED
  // count (n=1, selected=1 would single out one protected-class individual's outcome). Only the
  // group size n is kept; selected + rate + ratio are all suppressed.
  test('re-identification: a sub-floor group suppresses the selected count (not just the ratio)', () => {
    const r = svc.fourFifths([
      { value: 'Majority', n: 40, selected: 24 },
      { value: 'Tiny', n: 1, selected: 1 }, // a single person — must NOT leak that they were selected
    ], { minGroup: 5 });
    const tiny = r.groups.find((g) => g.value === 'Tiny');
    expect(tiny.sufficient).toBe(false);
    expect(tiny.n).toBe(1); // group size kept (employer-provided)
    expect(tiny.selected).toBeNull(); // the OUTCOME is suppressed — no re-identification
    expect(tiny.rate).toBeNull();
    expect(tiny.impact_ratio).toBeNull();
    // a sufficient group still reports its selected count
    const maj = r.groups.find((g) => g.value === 'Majority');
    expect(maj.selected).toBe(24);
  });
});

describe('fourFifths robustness (never NaN / throws)', () => {
  test('empty input → insufficient, no throw', () => {
    expect(() => svc.fourFifths([])).not.toThrow();
    const r = svc.fourFifths([]);
    expect(r.insufficient).toBe(true);
    expect(r.groups).toEqual([]);
  });
  test('zero selections everywhere → insufficient (no reference rate), no NaN', () => {
    const r = svc.fourFifths([
      { value: 'A', n: 10, selected: 0 },
      { value: 'B', n: 10, selected: 0 },
    ], { minGroup: 5 });
    expect(r.insufficient).toBe(true);
    r.groups.forEach((g) => expect(Number.isNaN(Number(g.rate))).toBe(false));
  });
  test('selected is clamped into [0, n]', () => {
    const r = svc.fourFifths([
      { value: 'A', n: 5, selected: 99 }, // clamps to 5 → rate 1.0
      { value: 'B', n: 5, selected: 2 },
    ], { minGroup: 5 });
    const A = r.groups.find((g) => g.value === 'A');
    expect(A.selected).toBe(5);
    expect(A.rate).toBe(1);
  });
});

describe('compliance constants', () => {
  test('selectable outcomes are the tracked outcomes only (never a demographic)', () => {
    expect(svc.SELECTABLE_OUTCOMES).toEqual(['advanced', 'got_offer', 'hired']);
  });
  test('four-fifths threshold is 0.80 and the group floor is >= 2 (n=1 has zero anonymity)', () => {
    expect(svc.FOUR_FIFTHS).toBe(0.8);
    expect(svc.MIN_GROUP_SAMPLE).toBeGreaterThanOrEqual(2);
  });
});

// CC1-2 (v3-hardening-2): the privacy floor cannot be configured below 2 — n=1 has zero
// anonymity (it singles out one protected-class individual's outcome). Even a misconfigured
// COMPLIANCE_MIN_GROUP_SAMPLE=1 is clamped to 2, keeping RID-1's suppression intact.
describe('[CC1-2] MIN_GROUP_SAMPLE hard privacy floor (>= 2 even on misconfig)', () => {
  const ORIG = process.env.COMPLIANCE_MIN_GROUP_SAMPLE;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.COMPLIANCE_MIN_GROUP_SAMPLE;
    else process.env.COMPLIANCE_MIN_GROUP_SAMPLE = ORIG;
    jest.resetModules();
  });
  test('a configured floor of 1 is clamped to 2; a single individual stays suppressed', () => {
    jest.resetModules();
    process.env.COMPLIANCE_MIN_GROUP_SAMPLE = '1';
    const reloaded = require('../../src/services/complianceService');
    expect(reloaded.MIN_GROUP_SAMPLE).toBe(2);
    const r = reloaded.fourFifths([
      { value: 'Solo', n: 1, selected: 1 },
      { value: 'Other', n: 1, selected: 0 },
    ]);
    const solo = r.groups.find((g) => g.value === 'Solo');
    expect(solo.sufficient).toBe(false); // n=1 never sufficient
    expect(solo.selected).toBeNull(); // outcome suppressed (RID-1 holds)
  });
});

// Migration-content RLS regression: the sensitive labels table (063) is the hardest-locked table.
// This fails loudly if the owner-only RLS / no-anon posture is ever weakened.
describe('migration 063 — labels table is owner-only RLS, no anon (the sensitive table)', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../supabase/migrations/063_compliance_demographic_labels.sql'),
    'utf8',
  );
  test('RLS is enabled', () => {
    expect(sql).toMatch(/ALTER TABLE public\.compliance_demographic_labels ENABLE ROW LEVEL SECURITY/i);
  });
  test('all four ops are owner-scoped to account_id = auth.uid()', () => {
    for (const op of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toMatch(new RegExp(`cdl_owner_${op}`, 'i'));
    }
    // >= 4 occurrences of the ownership predicate (one per policy, plus update WITH CHECK)
    expect((sql.match(/account_id = auth\.uid\(\)/g) || []).length).toBeGreaterThanOrEqual(4);
  });
  test('no anon access: REVOKE ALL FROM anon, policies TO authenticated (never PUBLIC)', () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.compliance_demographic_labels FROM anon/i);
    expect(sql).toMatch(/TO authenticated/i);
    expect(sql).not.toMatch(/TO PUBLIC/i);
  });
});
