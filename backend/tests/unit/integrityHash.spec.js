/**
 * Golden-vector tests for the integrity hash-chain canonicalization (env-independent → CI).
 *
 * THE LOAD-BEARING INVARIANT
 *   The JS verifier (integrity.js: canonicalJson / contentHash / verifyLinkage) MUST be
 *   byte-identical to the SQL `integrity_row_hash` (migration 021), because that function
 *   hashes `coalesce(p_meta,'{}'::jsonb)::text`. Postgres `jsonb::text` is NOT compact: it
 *   emits a SPACE after every key colon and after every member/element comma, and it orders
 *   object keys by UTF-8 byte length first, then bytewise. If canonicalJson diverges by a
 *   single byte, every honest chain with non-empty meta fails verification.
 *
 *   These tests have no DB. Instead they hardcode the EXACT string Postgres `jsonb::text`
 *   produces for each golden input and assert canonicalJson reproduces it, then exercise
 *   verifyLinkage on a hand-built chain whose row_hashes we compute with the (now-fixed)
 *   contentHash — proving linkage holds and that a one-byte tamper is detected.
 */
require('../../src/polyfill'); // Node 25+ SlowBuffer/WebStreams shim, needed before requiring the router
const crypto = require('crypto');
const { canonicalJson, contentHash, verifyLinkage, genesis } = require('../../src/routes/supabase/integrity');

describe('canonicalJson is byte-identical to Postgres jsonb::text', () => {
  // Each pair is { input, jsonbText } where jsonbText is the verbatim output of
  // `SELECT input::jsonb::text` in Postgres. The spacing (": " and ", ") and the key
  // ordering (UTF-8 byte length, then bytewise) are the parts that historically diverged.
  const goldens = [
    { name: 'empty object', input: {}, jsonbText: '{}' },
    { name: 'single integer key', input: { chars: 1 }, jsonbText: '{"chars": 1}' },
    { name: 'two keys, comma spacing', input: { a: 1, b: 2 }, jsonbText: '{"a": 1, "b": 2}' },
    {
      // jsonb orders by byte length first: "n"(1) before "outer"(5); inner "a"(1) before
      // "chars"(5). Input order is deliberately scrambled to prove canonicalJson re-sorts.
      name: 'nested object, jsonb key ordering',
      input: { outer: { chars: 42, a: 1 }, n: 3 },
      jsonbText: '{"n": 3, "outer": {"a": 1, "chars": 42}}',
    },
    {
      // Byte length first: "z"(1) before "aa"(2) and "é"(2, 0xC3 0xA9). Between the two
      // 2-byte keys, bytewise: "aa"(0x61 0x61) < "é"(0xC3 0xA9).
      name: 'unicode key, byte-length-then-bytewise ordering',
      input: { aa: 2, 'é': 3, z: 1 },
      jsonbText: '{"z": 1, "aa": 2, "é": 3}',
    },
    {
      name: 'array element comma spacing',
      input: { list: [1, 2, 3] },
      jsonbText: '{"list": [1, 2, 3]}',
    },
    {
      // booleans + short ASCII string; "ok"(2) before "name"(4) by byte length.
      name: 'boolean + string scalars',
      input: { ok: true, name: 'hi' },
      jsonbText: '{"ok": true, "name": "hi"}',
    },
    {
      // Liveness floats are stored as Number(x.toFixed(4)) — trailing zeros stripped, so
      // these short non-exponential decimals render identically in jsonb::text and JS.
      name: 'liveness floats (toFixed-rounded)',
      input: { ear: Number((0.3).toFixed(4)), yaw: Number((0.1234).toFixed(4)) },
      jsonbText: '{"ear": 0.3, "yaw": 0.1234}',
    },
  ];

  for (const g of goldens) {
    test(`${g.name} → ${g.jsonbText}`, () => {
      expect(canonicalJson(g.input)).toBe(g.jsonbText);
    });
  }
});

describe('contentHash mirrors the SQL integrity_row_hash recipe', () => {
  // Reference implementation of the migration-021 recipe, written here independently so the
  // test pins the EXACT bytes hashed rather than just calling the function under test against
  // itself. Recipe:
  //   sha256( prev || seq || US || type || US || (category||'') || US
  //           || canonical(meta) || US || (client_ts||'') ),  US = 0x1f
  function expectedHash(prev, ev) {
    const US = '\x1f';
    const s =
      String(prev || '') +
      String(ev.seq) + US +
      String(ev.type || '') + US +
      (ev.category == null ? '' : String(ev.category)) + US +
      canonicalJson(ev.meta == null ? {} : ev.meta) + US +
      (ev.client_ts == null ? '' : String(ev.client_ts));
    return crypto.createHash('sha256').update(s).digest('hex');
  }

  test('contentHash equals the hand-derived recipe (with spaced meta)', () => {
    const prev = genesis('11111111-1111-1111-1111-111111111111');
    const ev = {
      seq: 1, type: 'paste', category: 'provenance',
      meta: { chars: 42, lines: 3 }, client_ts: '2026-06-24T12:00:00.000Z',
    };
    expect(contentHash(prev, ev)).toBe(expectedHash(prev, ev));
  });

  test('a NULL/absent meta hashes like the empty object {}', () => {
    const prev = genesis('22222222-2222-2222-2222-222222222222');
    const a = contentHash(prev, { seq: 1, type: 'x', category: null, meta: null, client_ts: null });
    const b = contentHash(prev, { seq: 1, type: 'x', category: null, meta: {}, client_ts: null });
    expect(a).toBe(b);
  });
});

describe('verifyLinkage on a hand-built chain', () => {
  const submissionId = '33333333-3333-3333-3333-333333333333';

  // Build a valid 3-row chain exactly as append_integrity_event would: prev_hash links to
  // the previous row_hash (genesis for the first), row_hash = contentHash(prev, row).
  function buildChain() {
    const rows = [
      { seq: 1, type: 'tab_hidden', category: 'proctoring', meta: {}, client_ts: '2026-06-24T12:00:00.000Z' },
      { seq: 2, type: 'paste', category: 'provenance', meta: { chars: 128 }, client_ts: '2026-06-24T12:00:05.000Z' },
      { seq: 3, type: 'session_submit', category: 'provenance', meta: { typed_chars: 200, final_chars: 328 }, client_ts: '2026-06-24T12:01:00.000Z' },
    ];
    let prev = genesis(submissionId);
    for (const r of rows) {
      r.prev_hash = prev;
      r.row_hash = contentHash(prev, r);
      prev = r.row_hash;
    }
    return rows;
  }

  test('an honest chain (non-empty spaced meta) verifies', () => {
    expect(verifyLinkage(buildChain(), submissionId)).toBe(true);
  });

  test('a one-byte meta tamper is detected', () => {
    const rows = buildChain();
    // Flip one byte of stored meta WITHOUT recomputing row_hash → linkage must fail.
    rows[1].meta = { chars: 129 };
    expect(verifyLinkage(rows, submissionId)).toBe(false);
  });

  test('a broken prev_hash link is detected', () => {
    const rows = buildChain();
    rows[2].prev_hash = 'deadbeef'; // does not match rows[1].row_hash
    expect(verifyLinkage(rows, submissionId)).toBe(false);
  });

  test('a tampered row_hash (not matching its content) is detected', () => {
    const rows = buildChain();
    rows[0].row_hash = rows[0].row_hash.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    expect(verifyLinkage(rows, submissionId)).toBe(false);
  });

  // Migration 104: erasure replaces a row's meta with {erased:true} but preserves the chain
  // columns. The verifier skips the content check for such rows, keeps enforcing linkage.
  test('an erasure-tombstoned middle row still verifies (linkage preserved)', () => {
    const rows = buildChain();
    rows[1].meta = { erased: true }; // scrubbed payload; prev_hash/row_hash untouched
    expect(verifyLinkage(rows, submissionId)).toBe(true);
  });

  test('a tampered link is still detected when a row is tombstoned', () => {
    const rows = buildChain();
    rows[1].meta = { erased: true };
    rows[1].row_hash = 'deadbeef'; // rewriting a scrubbed row's hash breaks the next link
    expect(verifyLinkage(rows, submissionId)).toBe(false);
  });
});
