-- 111 -- Deliverables checklist on a screen (TOU-146).
-- work_samples.deliverables is an optional recruiter-authored list of concrete deliverables
-- ("include a rollout plan", "state your assumptions") shown to the candidate as a self-check
-- checklist in the workspace and to the recruiter in the result view. NULL = no checklist.
-- Shape: a jsonb array of 1 to 8 strings, each <= 200 chars (per-item length is enforced by the
-- backend validator in proof.js; the CHECK below pins the coarse shape so a raw write can't
-- store an object or an oversized array).
--
-- The candidate's self-check state rides in work_sample_submissions.metadata (103) under
-- deliverables_check (array of checked item indexes), stamped by the trusted backend at submit.
-- Review hints for humans, never automated pass/fail. No new table; existing work_samples RLS
-- (owner-only writes, candidate reads via the 078 view) applies unchanged.
--
-- DOWN (reversible):
--   CREATE OR REPLACE VIEW public.work_samples_candidate AS
--     SELECT id, owner_id, job_id, title, role_family, prompt_md, response_type, language,
--            duration_minutes, starter_files, languages, status, created_at
--     FROM public.work_samples;
--   ALTER TABLE public.work_samples DROP CONSTRAINT IF EXISTS work_samples_deliverables_shape;
--   ALTER TABLE public.work_samples DROP COLUMN IF EXISTS deliverables;

ALTER TABLE public.work_samples
  ADD COLUMN IF NOT EXISTS deliverables jsonb;

ALTER TABLE public.work_samples DROP CONSTRAINT IF EXISTS work_samples_deliverables_shape;
ALTER TABLE public.work_samples
  ADD CONSTRAINT work_samples_deliverables_shape
  CHECK (
    deliverables IS NULL
    OR (jsonb_typeof(deliverables) = 'array' AND jsonb_array_length(deliverables) BETWEEN 1 AND 8)
  );

COMMENT ON COLUMN public.work_samples.deliverables IS
  'Optional recruiter-authored deliverables checklist: jsonb array of 1..8 strings (<=200 chars each). Candidate self-check state lives in work_sample_submissions.metadata.deliverables_check. Review aid for humans, never automated pass/fail.';

-- Candidate-safe projection (078): deliverables are part of the brief, so candidates may see
-- them. CREATE OR REPLACE appends the new column at the end and preserves existing grants;
-- the REVOKE/GRANT below re-affirms the 078 posture (backend-internal, service_role only).
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
    deliverables
  FROM public.work_samples;

REVOKE ALL ON public.work_samples_candidate FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_samples_candidate TO service_role;

SELECT 'deliverables checklist (111) ready' AS status;
