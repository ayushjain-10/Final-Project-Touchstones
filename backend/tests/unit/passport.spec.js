/**
 * Touchstones Passport (S4) — pure-logic unit tests (no DB).
 * Locks the handle rules, percentile math, proof-of-human snapshot derivation,
 * and the public-shape redaction allowlist (the PII-leak guard).
 */
const fs = require('fs');
const path = require('path');
const {
  HANDLE_RE,
  normalizeHandle,
  isValidHandle,
  scorePercentile,
  proofOfHumanFromDigest,
  pickPublicEntry,
  PUBLIC_ENTRY_KEYS,
} = require('../../src/services/passportService');

describe('normalizeHandle', () => {
  test.each([
    ['  Jane_Doe!! ', 'jane-doe'], // trim, lower, _→-, strip punctuation
    ['Ada Lovelace', 'ada-lovelace'], // spaces → hyphen
    ['--weird--name--', 'weird-name'], // collapse + trim hyphens
    ['ALLCAPS', 'allcaps'],
    ['dev.7', 'dev7'], // dot stripped
    ['a-b-c', 'a-b-c'],
  ])('normalizes %j → %j', (input, expected) => {
    expect(normalizeHandle(input)).toBe(expected);
  });

  test.each([
    ['ab', 'too short (min 3)'],
    ['', 'empty'],
    ['!!', 'no alnum left'],
    ['-', 'just a hyphen'],
    [null, 'non-string'],
    [42, 'non-string'],
    ['a'.repeat(33), 'too long (max 32)'],
  ])('rejects %j (%s) → null', (input) => {
    expect(normalizeHandle(input)).toBeNull();
  });

  test('normalized handles always pass the DB CHECK regex', () => {
    for (const raw of ['Jane Doe', 'x_y_z', 'Backend.Eng-2026', 'AAA']) {
      const h = normalizeHandle(raw);
      expect(h).not.toBeNull();
      expect(HANDLE_RE.test(h)).toBe(true);
    }
  });
});

describe('isValidHandle', () => {
  test.each(['jane-doe', 'abc', 'a1b2c3', 'dev7'])('accepts %j', (h) => {
    expect(isValidHandle(h)).toBe(true);
  });
  test.each(['ab', 'Jane', 'has space', '-lead', 'trail-', 'dou--ble', 'a'.repeat(33)])(
    'rejects %j',
    (h) => {
      expect(isValidHandle(h)).toBe(false);
    },
  );
});

describe('scorePercentile', () => {
  test('share at-or-below, rounded to an int 0-100', () => {
    // 6 of 7 values ≤ 84 → 86%
    expect(scorePercentile(84, [10, 50, 84, 90, 30, 84, 20])).toBe(86);
  });
  test('top score → 100', () => {
    expect(scorePercentile(100, [10, 20, 30, 40, 50])).toBe(100);
  });
  test('below everything → still bounded ≥ 0', () => {
    expect(scorePercentile(0, [10, 20, 30, 40, 50])).toBe(0);
  });
  test('null below the minimum sample size', () => {
    expect(scorePercentile(84, [1, 2, 3, 4])).toBeNull(); // < 5 samples
  });
  test('null for a non-numeric score', () => {
    expect(scorePercentile('x', [1, 2, 3, 4, 5, 6])).toBeNull();
  });
  test('ignores non-numeric comparison values', () => {
    expect(scorePercentile(50, [10, 'bad', 90, null, 40, 60, 50])).not.toBeNull();
  });
});

describe('proofOfHumanFromDigest', () => {
  test('bot_verdict true → flagged', () => {
    expect(proofOfHumanFromDigest({ verified_chain: true, summary: { bot_verdict: true } })).toBe('flagged');
  });
  test('broken chain → flagged', () => {
    expect(proofOfHumanFromDigest({ verified_chain: false, summary: {} })).toBe('flagged');
  });
  test('heavy paste (<50% typed) → review', () => {
    expect(proofOfHumanFromDigest({ verified_chain: true, summary: { typed_fraction: 0.3 } })).toBe('review');
  });
  test('wandered (tab_hidden > 5) → review', () => {
    expect(proofOfHumanFromDigest({ verified_chain: true, summary: { tab_hidden_count: 9 } })).toBe('review');
  });
  test('clean → verified', () => {
    expect(
      proofOfHumanFromDigest({ verified_chain: true, summary: { typed_fraction: 0.9, tab_hidden_count: 1, window_blur_count: 0 } }),
    ).toBe('verified');
  });
  test('missing digest → review (advisory, not a hard fail)', () => {
    expect(proofOfHumanFromDigest(null)).toBe('review');
  });

  // S4-2 (v2-hardening-2, FIXED): a zero-behavioral-event submission must NOT get the strongest
  // badge — no usable keystroke telemetry (typed_fraction null, e.g. a headless/programmatic
  // submit) now fails CLOSED to 'review'. Kept byte-identical to the frontend
  // verificationStateFromDigest (proofMappers.js).
  test('[S4-2] zero-event digest → review (fail closed, not verified)', () => {
    expect(proofOfHumanFromDigest({ verified_chain: true, summary: { typed_fraction: null } })).toBe('review');
    expect(proofOfHumanFromDigest({ verified_chain: true, summary: {} })).toBe('review'); // no summary fields at all
  });
  test('[S4-2] a real interactive session (numeric typed_fraction, clean) still → verified', () => {
    expect(proofOfHumanFromDigest({ verified_chain: true, summary: { typed_fraction: 0.92, tab_hidden_count: 0 } })).toBe('verified');
  });
});

// S4-1 (v2-hardening, P0 regression lock): the passport_entries INSERT/UPDATE RLS must
// enforce CREDENTIAL ownership (not just passport ownership), and the public get_passport
// RPC must only surface a credential whose candidate matches the passport owner. Migration
// 060 applies this; this test fails loudly if that file is reverted/weakened.
describe('migration 060 — passport_entry credential-ownership (S4-1 P0)', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../supabase/migrations/060_passport_entry_credential_ownership.sql'),
    'utf8',
  );
  test('INSERT WITH CHECK requires the credential to belong to the candidate', () => {
    expect(sql).toMatch(/passport_entry_owner_insert/);
    expect(sql).toMatch(/credential_id\s+IN\s*\(\s*SELECT\s+id\s+FROM\s+public\.verified_credentials\s+WHERE\s+candidate_id\s*=\s*auth\.uid\(\)/i);
  });
  test('UPDATE WITH CHECK also enforces credential ownership', () => {
    expect(sql).toMatch(/passport_entry_owner_update[\s\S]*credential_id\s+IN\s*\(\s*SELECT\s+id\s+FROM\s+public\.verified_credentials/i);
  });
  test('get_passport RPC join is hardened to the passport owner', () => {
    expect(sql).toMatch(/vc\.candidate_id\s*=\s*p\.candidate_id/);
  });
});

// S4-1b (v2-hardening-2): the trust columns (proof_of_human/percentile/title/role_family) must
// not be candidate-writable — migration 061 strips the column privilege so they're set only
// by the service role. This guards against the migration being reverted.
describe('migration 061 — passport_entry trust columns server-authoritative (S4-1b)', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../supabase/migrations/061_passport_entry_authoritative.sql'),
    'utf8',
  );
  test('table-level INSERT/UPDATE is revoked from authenticated', () => {
    expect(sql).toMatch(/REVOKE\s+INSERT\s+ON\s+public\.passport_entries\s+FROM\s+authenticated/i);
    expect(sql).toMatch(/REVOKE\s+UPDATE\s+ON\s+public\.passport_entries\s+FROM\s+authenticated/i);
  });
  test('authenticated is re-granted ONLY the non-trust columns', () => {
    expect(sql).toMatch(/GRANT\s+INSERT\s*\(passport_id, credential_id, submission_id, is_visible, sort_order\)/i);
    expect(sql).toMatch(/GRANT\s+UPDATE\s*\(is_visible, sort_order\)/i);
    // the trust columns must NOT appear in any GRANT
    expect(sql).not.toMatch(/GRANT[^;]*(proof_of_human|percentile)/i);
  });
});

describe('pickPublicEntry (PII-leak guard)', () => {
  test('keeps only the allowlisted public fields', () => {
    const out = pickPublicEntry({
      token: 't',
      score: 84,
      direction_score: 88,
      proof_of_human: 'verified',
      title: 'Debug a webhook',
      role_family: 'backend',
      percentile: 91,
      issued_at: '2026-06-26',
      // none of these must survive:
      candidate_id: 'SECRET-UUID',
      submission_id: 'SECRET-SUB',
      email: 'jane@example.com',
      passport_id: 'SECRET-PASSPORT',
    });
    expect(Object.keys(out).sort()).toEqual([...PUBLIC_ENTRY_KEYS].sort());
    expect(out).not.toHaveProperty('candidate_id');
    expect(out).not.toHaveProperty('submission_id');
    expect(out).not.toHaveProperty('email');
  });
  test('handles undefined fields without inventing keys', () => {
    const out = pickPublicEntry({ token: 't', score: 70 });
    expect(out).toEqual({ token: 't', score: 70 });
  });
  test('non-object input → empty object', () => {
    expect(pickPublicEntry(null)).toEqual({});
  });
});
