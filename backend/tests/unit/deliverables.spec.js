/**
 * Deliverables checklist validation (TOU-146, migration 111).
 * sanitizeDeliverables guards the work-sample create/update path: strings only, trimmed,
 * empties dropped, capped at 8 items of 200 chars each; anything else collapses to null
 * (null = no checklist). sanitizeDeliverablesCheck guards the submit path's self-check
 * metadata stamp: integer indexes 0..7 only, de-duplicated, sorted, else null.
 */
const { sanitizeDeliverables, sanitizeDeliverablesCheck } = require('../../src/routes/supabase/proof');

describe('sanitizeDeliverables', () => {
  test('trims strings and drops empties', () => {
    expect(sanitizeDeliverables(['  Include a rollout plan  ', '', '   ', 'State assumptions'])).toEqual([
      'Include a rollout plan',
      'State assumptions',
    ]);
  });

  test('drops non-string entries', () => {
    expect(sanitizeDeliverables(['Real item', 42, null, { requirement: 'nope' }, ['nested']])).toEqual([
      'Real item',
    ]);
  });

  test('caps at 8 items', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `Item ${i + 1}`);
    const out = sanitizeDeliverables(twelve);
    expect(out).toHaveLength(8);
    expect(out[7]).toBe('Item 8');
  });

  test('caps each item at 200 chars', () => {
    const long = 'x'.repeat(500);
    const out = sanitizeDeliverables([long]);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(200);
  });

  test('returns null for a non-array, an empty array, or an all-invalid array', () => {
    expect(sanitizeDeliverables(undefined)).toBeNull();
    expect(sanitizeDeliverables('a string')).toBeNull();
    expect(sanitizeDeliverables({})).toBeNull();
    expect(sanitizeDeliverables([])).toBeNull();
    expect(sanitizeDeliverables(['', '   ', 7])).toBeNull();
  });
});

describe('sanitizeDeliverablesCheck', () => {
  test('keeps valid indexes, de-duplicated and sorted', () => {
    expect(sanitizeDeliverablesCheck([3, 0, 3, '2'])).toEqual([0, 2, 3]);
  });

  test('drops out-of-range, negative, and non-integer values', () => {
    expect(sanitizeDeliverablesCheck([0, 8, 99, -1, 1.5, 'seven', null, 7])).toEqual([0, 7]);
  });

  test('returns null for non-arrays and empty/all-invalid arrays', () => {
    expect(sanitizeDeliverablesCheck(undefined)).toBeNull();
    expect(sanitizeDeliverablesCheck('0,1')).toBeNull();
    expect(sanitizeDeliverablesCheck([])).toBeNull();
    expect(sanitizeDeliverablesCheck([-1, 12, 'x'])).toBeNull();
  });
});
