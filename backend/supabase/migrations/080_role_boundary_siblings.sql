-- 080 — Extend the Phase R role boundary to the SIBLING tables an adversarial review found still
-- open. Phase R hardened only work_samples; these tables had tenancy-only RLS (owner = auth.uid()),
-- which a candidate-role user satisfies for their OWN rows — so a candidate could author assessment
-- templates / jobs / employer reqs, and could read their submission's recruiter-private score and
-- even tamper with their own submission. This adds the is_verified_recruiter() predicate to the
-- recruiter-owned write policies and locks down the two candidate-data tables.

-- 1) RECRUITER-AUTHORING TABLES — block candidate-role writes at the DB (mirror of 077 on work_samples).
ALTER POLICY at_insert ON public.assessment_templates
  WITH CHECK (created_by = auth.uid() AND public.is_verified_recruiter());
ALTER POLICY at_update ON public.assessment_templates
  WITH CHECK (created_by = auth.uid() AND public.is_verified_recruiter());

ALTER POLICY "Users can create jobs" ON public.jobs
  WITH CHECK (auth.uid() = created_by AND public.is_verified_recruiter());
ALTER POLICY "Users can update own jobs" ON public.jobs
  WITH CHECK (auth.uid() = created_by AND public.is_verified_recruiter());

ALTER POLICY req_owner_insert ON public.network_reqs
  WITH CHECK (owner_id = auth.uid() AND public.is_verified_recruiter());
ALTER POLICY req_owner_update ON public.network_reqs
  WITH CHECK (owner_id = auth.uid() AND public.is_verified_recruiter());

-- 2) proof_scores — a candidate must NOT read the recruiter-private scoring internals of their own
-- submission (per-criterion breakdown, advance/reject outcome, threshold, injection_flag,
-- override_reason). Remove the candidate arm; only the screen owner + workspace members may read.
-- The candidate's safe result (outcome + any issued credential) is exposed later via a backend route.
ALTER POLICY ps_recruiter ON public.proof_scores
  USING (EXISTS (
    SELECT 1 FROM public.work_sample_submissions s
    JOIN public.work_samples w ON w.id = s.work_sample_id
    WHERE s.id = proof_scores.submission_id AND w.owner_id = auth.uid()
  ));

-- 3) work_sample_submissions — was FOR ALL with a candidate WITH CHECK, so a candidate could UPDATE
-- their own row via direct PostgREST: forge input_hash (tamper-evidence), rewrite response after
-- scoring, flip status, reassign work_sample_id. Make it READ-ONLY for end users; all writes go
-- through the backend (service_role) which mediates assign/submit/run. The submit route is moved to
-- service_role in the same change so candidates never need a token write.
DROP POLICY IF EXISTS wss_candidate ON public.work_sample_submissions;
CREATE POLICY wss_read ON public.work_sample_submissions
  FOR SELECT
  USING (
    candidate_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.work_samples w
      WHERE w.id = work_sample_submissions.work_sample_id AND w.owner_id = auth.uid()
    )
  );
