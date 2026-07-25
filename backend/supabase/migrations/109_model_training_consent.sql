-- 109_model_training_consent.sql
-- Adds an OPTIONAL 'model_training' modality to proof_consent so candidates can opt in to
-- their assessment activity (structured events, timings, scores; never media, transcripts,
-- name, or email) being used to improve scoring models.
--
-- Product rules (enforced in flow/copy, not here): the checkbox is optional, unchecked by
-- default, and declining NEVER gates an assessment. Training exports (export-training-set.js)
-- and the assessment archive ML use must filter to rows with modality = 'model_training',
-- decision = 'granted', withdrawn_at IS NULL, and the new consent_version.
--
-- Reversible: constraint swap only, no data change. See PROJECT-DOCUMENTATION/15-AZURE-EXIT-PLAN.md.

alter table public.proof_consent
  drop constraint proof_consent_modality_check;

alter table public.proof_consent
  add constraint proof_consent_modality_check
  check (modality = any (array[
    'behavioral'::text,
    'face'::text,
    'keystroke'::text,
    'camera'::text,
    'microphone'::text,
    'walkthrough_recording'::text,
    'model_training'::text
  ]));

-- Rollback (valid only while no model_training rows exist):
-- alter table public.proof_consent drop constraint proof_consent_modality_check;
-- alter table public.proof_consent add constraint proof_consent_modality_check
--   check (modality = any (array['behavioral'::text,'face'::text,'keystroke'::text,
--     'camera'::text,'microphone'::text,'walkthrough_recording'::text]));
