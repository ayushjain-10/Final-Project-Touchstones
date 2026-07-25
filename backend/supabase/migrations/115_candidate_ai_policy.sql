-- 115 -- Expose the authored AI policy through the candidate-safe work-sample view.
--
-- Recruiters already store the policy as rubric.ai_allowed. The candidate runner
-- must receive that one boolean so it can hide the assistant and state the correct
-- instructions. The rubric and every grading criterion remain private.
--
-- DOWN (reversible):
--   CREATE OR REPLACE VIEW public.work_samples_candidate AS
--     SELECT id, owner_id, job_id, title, role_family, prompt_md, response_type,
--            language, duration_minutes, starter_files, languages, status,
--            created_at, deliverables, av_required
--     FROM public.work_samples;

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
    created_at,
    deliverables,
    av_required,
    COALESCE((rubric ->> 'ai_allowed')::boolean, true) AS ai_allowed
  FROM public.work_samples;

COMMENT ON VIEW public.work_samples_candidate IS
  'Candidate-safe work-sample projection. Exposes the AI policy boolean but never the private rubric or grading criteria.';

REVOKE ALL ON public.work_samples_candidate FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_samples_candidate TO service_role;

SELECT 'candidate AI policy projection (115) ready' AS status;
