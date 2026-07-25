-- 112 -- Camera + microphone requirement on a screen (TOU-147).
-- work_samples.av_required marks a screen whose start gate requires the candidate to grant
-- camera + microphone access before Start unlocks. STANCE (product ground rules): presence
-- signals only. NO video or audio is ever recorded, stored, or transmitted; the granted
-- MediaStream never leaves the browser. Track on/off transitions become av_* integrity events
-- (review flags for humans, never automated pass/fail). Consent is recorded server-side at
-- Start via the existing proof_consent ledger (025/088: camera + microphone modalities are
-- already server-role-only grant rows) plus an av_consent_granted integrity event.
--
-- Enforcement: POST /api/proof/submissions/:id/start rejects with 400 av_consent_required
-- when the screen has av_required and the body lacks { av_consent: true }.
--
-- DOWN (reversible):
--   CREATE OR REPLACE VIEW public.work_samples_candidate AS
--     SELECT id, owner_id, job_id, title, role_family, prompt_md, response_type, language,
--            duration_minutes, starter_files, languages, status, created_at, deliverables
--     FROM public.work_samples;
--   ALTER TABLE public.work_samples DROP COLUMN IF EXISTS av_required;

ALTER TABLE public.work_samples
  ADD COLUMN IF NOT EXISTS av_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.work_samples.av_required IS
  'When true, the candidate start gate requires camera + microphone access (consent-gated) before Start unlocks. Presence signals only: nothing is recorded or stored; av_* integrity events are human review flags, never pass/fail.';

-- Candidate-safe projection (078 + 111): the gate renders before start, so candidates must be
-- able to read the requirement. Appended at the end; grants re-affirmed as in 078/111.
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
    av_required
  FROM public.work_samples;

REVOKE ALL ON public.work_samples_candidate FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_samples_candidate TO service_role;

SELECT 'camera + microphone requirement (112) ready' AS status;
