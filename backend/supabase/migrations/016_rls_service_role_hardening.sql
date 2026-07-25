-- 016_rls_service_role_hardening.sql
-- Service-role / RLS enforcement hardening. Non-destructive: no data, columns, or
-- tables are dropped. Resolves the Supabase security advisor findings that are
-- real enforcement gaps. Idempotent where practical.
--
-- Findings addressed (from get_advisors security, project zgbuqsalcdwdbwdweocl):
--   1. function_search_path_mutable  -> pin search_path on the 13 app-owned functions
--   2. anon/authenticated_security_definer_function_executable
--                                    -> revoke EXECUTE on the 4 cron-only SECURITY DEFINER fns
--   3. rls_policy_always_true (submission_workflow_logs INSERT WITH CHECK true)
--                                    -> scope INSERT to the owning submission
--
-- Note on pgvector: the vector/halfvec/sparsevec functions also report a mutable
-- search_path, but they are owned by the `vector` extension and must NOT be altered
-- here (the extension manages them). Only the 13 application functions are pinned.

-- ---------------------------------------------------------------------------
-- 1. Pin search_path on application functions (prevents search_path injection,
--    especially important for the SECURITY DEFINER cron functions). Behavior is
--    unchanged because every body references objects in `public`.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.update_updated_at_column()                                            SET search_path = public, pg_temp;
ALTER FUNCTION public.proof_audit_log_immutable()                                           SET search_path = public, pg_temp;
ALTER FUNCTION public.submission_integrity_immutable()                                      SET search_path = public, pg_temp;

ALTER FUNCTION public.analytics_overview(p_user_id uuid)                                     SET search_path = public, pg_temp;
ALTER FUNCTION public.analytics_jobs(p_user_id uuid)                                         SET search_path = public, pg_temp;
ALTER FUNCTION public.analytics_outreach(p_user_id uuid, p_days integer)                     SET search_path = public, pg_temp;
ALTER FUNCTION public.analytics_autopilot(p_user_id uuid, p_days integer)                    SET search_path = public, pg_temp;
ALTER FUNCTION public.analytics_funnel(p_user_id uuid, p_days integer, p_job_id uuid)        SET search_path = public, pg_temp;

ALTER FUNCTION public.match_candidate_submissions(query_embedding vector, match_count integer, similarity_threshold double precision)
                                                                                            SET search_path = public, pg_temp;

ALTER FUNCTION public.process_due_follow_ups()                                               SET search_path = public, pg_temp;
ALTER FUNCTION public.check_auto_scheduling()                                                SET search_path = public, pg_temp;
ALTER FUNCTION public.cleanup_expired_queue_items()                                          SET search_path = public, pg_temp;
ALTER FUNCTION public.pause_stale_campaigns()                                                SET search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 2. Lock down the cron-only SECURITY DEFINER functions. These are invoked by
--    pg_cron (or the Node fallback via the service-role key), never by end users.
--    Exposing them over PostgREST (/rest/v1/rpc/...) let any anon/authenticated
--    caller trigger privileged maintenance. Revoke EXECUTE from those roles;
--    service_role (and the function owner used by pg_cron) keep it.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.process_due_follow_ups()        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_auto_scheduling()         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_queue_items()   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pause_stale_campaigns()         FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tighten submission_workflow_logs INSERT. The app only ever writes these
--    rows via the service-role client (supabaseAdmin in autopilot.js / talent.js),
--    which bypasses RLS, so scoping the policy does not affect the app. It does
--    close the hole where a signed-in user could forge workflow-log rows.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "System can insert workflow logs" ON public.submission_workflow_logs;

CREATE POLICY "Users can insert workflow logs of own submissions"
  ON public.submission_workflow_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.candidate_submissions cs
      WHERE cs.id = submission_workflow_logs.submission_id
        AND cs.user_id = auth.uid()
    )
  );
