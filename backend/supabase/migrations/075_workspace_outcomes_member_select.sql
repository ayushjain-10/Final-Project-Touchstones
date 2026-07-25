-- Team workspace sharing, completion: an ACTIVE teammate can READ the workspace's
-- submission_outcomes (the advanced/offer/hired/retained labels the Dashboard shows),
-- matching the member-select policies migration 038 already added for work_samples,
-- work_sample_submissions, and proof_scores. Read-only — labeling stays owner-only
-- (outcomes_owner, migration 029). Reuses the submission_in_my_workspace() helper from 038.

DROP POLICY IF EXISTS so_member_select ON submission_outcomes;
CREATE POLICY so_member_select ON submission_outcomes FOR SELECT
  USING (public.submission_in_my_workspace(submission_id));
