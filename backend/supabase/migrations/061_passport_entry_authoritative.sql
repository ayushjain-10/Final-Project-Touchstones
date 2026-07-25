-- 061_passport_entry_authoritative.sql — SECURITY FIX (v2-hardening-2, S4-1b).
-- ----------------------------------------------------------------------------------------
-- FINDING (S4-1b): even with 060 (credential ownership enforced), the trust-signal columns
-- on passport_entries — proof_of_human, percentile, title, role_family — were CANDIDATE-
-- WRITABLE. Via direct PostgREST a candidate could set proof_of_human='verified',
-- percentile=99, title='Staff Engineer' on their own entry — fabricating exactly the
-- signals the SERVER is supposed to compute (from the integrity digest + calibration).
--
-- FIX: make those columns server-authoritative by removing the candidate's ability to write
-- them. proof_of_human + percentile are computed in application code (digest /
-- calibrationService — not expressible in pure SQL), so the route now writes them via the
-- service-role client AFTER an RLS-gated, credential-ownership-checked base insert; this
-- migration strips the column-level write privilege from `authenticated` so a direct
-- PostgREST write that supplies them is rejected.
--
--   * authenticated may INSERT only: passport_id, credential_id, submission_id, is_visible,
--     sort_order  (RLS policy from 060 still gates WHICH rows — credential ownership).
--   * authenticated may UPDATE only: is_visible, sort_order  (the PATCH visibility/reorder
--     route). title / role_family / proof_of_human / percentile are NOT writable by
--     authenticated — only the service role sets them.
--
-- NOTE: Postgres ignores column-level grants when a table-level grant exists, so we REVOKE
-- the table-level INSERT/UPDATE and GRANT back only the allowed columns. SELECT/DELETE and
-- the 056/060 RLS policies are unchanged. Idempotent.
--
-- NOT applied by this file — the founder applies migrations manually via the Management API.

-- INSERT: only the candidate-ownable base columns.
REVOKE INSERT ON public.passport_entries FROM authenticated;
GRANT  INSERT (passport_id, credential_id, submission_id, is_visible, sort_order)
  ON public.passport_entries TO authenticated;

-- UPDATE: only visibility + ordering (the PATCH route). Trust columns are service-role only.
REVOKE UPDATE ON public.passport_entries FROM authenticated;
GRANT  UPDATE (is_visible, sort_order)
  ON public.passport_entries TO authenticated;

SELECT 'passport_entry trust columns are now server-authoritative' AS status;
