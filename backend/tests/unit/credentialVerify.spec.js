/**
 * S4-3 (v2-hardening-2): credential verify recomputes the audit-chain head from the LIVE
 * proof_audit_log and compares it to the digest_hash bound at issue, surfacing chain_consistent
 * instead of merely re-asserting the stored value. These lock the pure tamper-evidence semantics
 * (the live-DB happy path — untampered → chain_consistent:true — is asserted in smoke-v2.sh).
 */
const { chainConsistent } = require('../../src/routes/supabase/credentials');

describe('chainConsistent (verify tamper-evidence)', () => {
  test('matching live head and stored digest → true (untampered)', () => {
    expect(chainConsistent('abc123', 'abc123')).toBe(true);
  });
  test('a mutated/added audit row (head differs) → false', () => {
    expect(chainConsistent('NEWHEAD_after_tamper', 'abc123')).toBe(false);
  });
  test('missing live head → false (cannot reconfirm)', () => {
    expect(chainConsistent(null, 'abc123')).toBe(false);
    expect(chainConsistent(undefined, 'abc123')).toBe(false);
  });
  test('missing stored digest → false (nothing to compare against)', () => {
    expect(chainConsistent('abc123', null)).toBe(false);
    expect(chainConsistent('abc123', '')).toBe(false);
  });
});
