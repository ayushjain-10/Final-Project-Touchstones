-- 090_advisor_hygiene.sql
-- Supabase security-advisor hygiene. Dev only; prod/main is FROZEN — the founder applies this by hand
-- (file only). Non-destructive: no data, tables, or columns are dropped. Idempotent + reversible
-- (down-path in the comment block below).
--
-- FIXED HERE (two real, low-blast-radius linter findings):
--  (a) function_search_path_mutable on public.immutable_array_to_string(text[], text).
--      Current def (verified via pg_get_functiondef; UNCHANGED here — we only pin search_path):
--        CREATE OR REPLACE FUNCTION public.immutable_array_to_string(text[], text)
--          RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT array_to_string($1, $2); $$;
--      proconfig was NULL (no search_path pinned) — that is the finding. The body is left untouched.
--  (b) anon/authenticated_security_definer_function_executable on three RETURNS-trigger functions the
--      linter flags as directly RPC-executable: notify_resend_on_waitlist(), notify_resend_on_new_user(),
--      handle_new_user(). They only ever run as triggers (and error outside trigger context anyway), so
--      granting EXECUTE to the user-facing roles is wrong. Trigger firing runs as the function owner and
--      is unaffected by revoking EXECUTE from anon/authenticated. (Same idiom as migration 016.)
--
-- DELIBERATELY NOT CHANGED (documented so the remaining advisor list is a decision, not an oversight):
--  * Public-by-design RPCs — get_credential / get_credential_full / get_passport / waitlist_count /
--    pool_search: these back PUBLIC verify + marketing surfaces (anon MUST be able to call them); their
--    EXECUTE-to-anon is intentional, and each is SECURITY DEFINER with a pinned search_path and
--    single-token / aggregate-only scoping. Leaving as-is.
--  * append_integrity_event: EXECUTE to authenticated is BY DESIGN — candidates/recruiters append via
--    their RLS-scoped session; trust weight is decided by source ('server_observed' is only stampable by
--    server code), not by who may call it. Leaving as-is.
--  * Deny-all RLS tables — admin_otp, ashby_integration_settings, processed_events, proof_audit_log,
--    scoring_jobs: having NO end-user policy is intentional (service-role-only by design, the 034 pattern).
--    "RLS enabled, no policy" is the correct posture, not a gap. Leaving as-is.
--  * notifications INSERT WITH CHECK (true): a genuinely over-permissive policy, but tightening it is a
--    behavior change with real blast radius — tracked as a FOLLOW-UP, not changed in this hygiene pass.
--  * Extensions installed in the public schema: relocating them can break references — FOLLOW-UP.
--
-- DOWN (reverse — restores the pre-migration state):
--   ALTER FUNCTION public.immutable_array_to_string(text[], text) RESET search_path;
--   GRANT EXECUTE ON FUNCTION public.notify_resend_on_waitlist() TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.notify_resend_on_new_user() TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.handle_new_user()           TO anon, authenticated;

-- (a) pin search_path (config-only change; the function body is untouched)
ALTER FUNCTION public.immutable_array_to_string(text[], text) SET search_path = public;

-- (b) revoke RPC executability on the trigger-only functions (migration 016 idiom)
REVOKE EXECUTE ON FUNCTION public.notify_resend_on_waitlist() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_resend_on_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()           FROM anon, authenticated;

SELECT 'advisor hygiene (search_path pin + trigger-fn EXECUTE revoke) ready' AS status;
