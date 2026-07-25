-- 026_integrity_client_ts_text.sql
-- Fix the chain-verification break introduced by storing client_ts as TIMESTAMPTZ.
--
-- THE BUG
--   The canonical row hash (integrity_row_hash, migration 021) hashes the RAW client_ts
--   TEXT the client sent, e.g. '2026-06-24T12:00:00.000Z'. But migration 012 declared
--   submission_integrity_events.client_ts as TIMESTAMPTZ, so PostgREST re-renders it on
--   read into Postgres's own timestamptz text form ('2026-06-24 12:00:00+00' — a space
--   instead of 'T', '+00:00'/'+00' instead of 'Z', dropped '.000' fractional zeros).
--   The JS verifier (integrity.js verifyLinkage) re-hashes the value it reads BACK from the
--   DB, so it hashes those re-rendered bytes — never the bytes that were originally hashed —
--   and every honest chain with a client_ts fails verification.
--
-- THE FIX (the safe one)
--   Store client_ts as TEXT so the EXACT client bytes that were hashed round-trip unchanged
--   on read. After this, both the SQL integrity_row_hash and the JS contentHash hash the
--   same stored bytes: the literal string the client sent. We do NOT change the hash recipe
--   and do NOT touch migrations 012/021 (append_integrity_event already passes client_ts as
--   TEXT, and integrity_row_hash already coalesces it to '').
--
-- ACCEPTABLE DATA LOSS
--   Any rows written BEFORE this migration (whose client_ts was already coerced to
--   timestamptz and would re-render differently than what was hashed) will not verify. This
--   is acceptable: this is a pre-launch chain with no real candidate data. The USING cast
--   below renders existing timestamptz values to text deterministically; they simply won't
--   match their stored row_hash, which is the same as the pre-fix state for those rows.

ALTER TABLE submission_integrity_events
  ALTER COLUMN client_ts TYPE text USING client_ts::text;

COMMENT ON COLUMN submission_integrity_events.client_ts IS
  'Raw client-supplied timestamp string, stored as TEXT so the exact bytes hashed into row_hash round-trip unchanged on read (see migration 026). MUST NOT be re-typed to timestamptz: that would re-render the value and break chain verification.';

SELECT 'integrity client_ts stored as text (hash round-trip) ready' AS status;
