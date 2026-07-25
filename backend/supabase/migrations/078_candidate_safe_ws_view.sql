-- 078 — Candidate-safe work_sample projection (closes the "duplicated allow-list leaks by omission"
-- gap). The candidate-facing reads in proof.js hand-copied a SELECT column list in three places;
-- any new private column (rubric, tests, baseline, scoring_strategy, employer notes) would leak the
-- day someone forgets to exclude it. This view is the SINGLE allow-list of candidate-safe columns —
-- it CANNOT expose rubric/tests/baseline because they aren't selected.
--
-- It excludes columns, not rows; callers keep their own status='published' filter. Granted to
-- service_role only: candidate-facing reads go through the backend (which uses service_role + this
-- view), never via a candidate's direct PostgREST query, so candidates can't enumerate the library.

CREATE OR REPLACE VIEW public.work_samples_candidate AS
  SELECT
    id,
    owner_id,
    job_id,
    title,
    role_family,
    prompt_md,
    response_type,
    language,
    duration_minutes,
    starter_files,
    languages,
    status,
    created_at
  FROM public.work_samples;

-- NEVER expose to end-user roles; backend-internal safe projection only.
REVOKE ALL ON public.work_samples_candidate FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_samples_candidate TO service_role;
