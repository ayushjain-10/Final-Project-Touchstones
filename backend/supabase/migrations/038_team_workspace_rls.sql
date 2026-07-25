-- 038_team_workspace_rls.sql
-- Make a workspace genuinely SHARED: an ACTIVE teammate (workspace_members) can READ
-- the owner's screens, submissions, and scores. Additive SELECT policies only — the
-- existing owner-only policies are untouched, so nothing that works today changes;
-- this only GRANTS read access to active members. Writes stay owner-only.
--
-- Membership checks go through SECURITY DEFINER helpers so the policy subqueries do
-- NOT re-trigger RLS on the joined tables (avoids recursion + keeps them fast).

CREATE OR REPLACE FUNCTION public.is_workspace_member(p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.owner_id = p_owner AND wm.member_id = auth.uid() AND wm.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.submission_in_my_workspace(p_submission uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM work_sample_submissions s
    JOIN work_samples w ON w.id = s.work_sample_id
    JOIN workspace_members wm ON wm.owner_id = w.owner_id
    WHERE s.id = p_submission AND wm.member_id = auth.uid() AND wm.status = 'active'
  );
$$;

DROP POLICY IF EXISTS ws_member_select ON work_samples;
CREATE POLICY ws_member_select ON work_samples FOR SELECT
  USING (public.is_workspace_member(owner_id));

DROP POLICY IF EXISTS wss_member_select ON work_sample_submissions;
CREATE POLICY wss_member_select ON work_sample_submissions FOR SELECT
  USING (public.submission_in_my_workspace(id));

DROP POLICY IF EXISTS ps_member_select ON proof_scores;
CREATE POLICY ps_member_select ON proof_scores FOR SELECT
  USING (public.submission_in_my_workspace(submission_id));

SELECT 'team workspace read-sharing RLS ready' AS status;
