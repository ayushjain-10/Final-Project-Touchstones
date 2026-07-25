-- 017_revoke_cron_fn_public_execute.sql
-- Completes 016. Revoking EXECUTE from anon/authenticated was insufficient because
-- Postgres grants EXECUTE to PUBLIC by default at function creation, and both roles
-- inherit it through PUBLIC. Revoke from PUBLIC and re-grant only to service_role.
--
-- These 4 functions are cron-only (invoked by pg_cron, which runs as the function
-- owner). The Node fallback path runs the equivalent logic in JS and does NOT call
-- these RPCs, so removing public/anon/authenticated EXECUTE has no app impact. The
-- function owner always retains EXECUTE regardless of grants, so pg_cron is unaffected.

REVOKE EXECUTE ON FUNCTION public.process_due_follow_ups()        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_auto_scheduling()         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_queue_items()   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pause_stale_campaigns()         FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.process_due_follow_ups()        TO service_role;
GRANT EXECUTE ON FUNCTION public.check_auto_scheduling()         TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_queue_items()   TO service_role;
GRANT EXECUTE ON FUNCTION public.pause_stale_campaigns()         TO service_role;
