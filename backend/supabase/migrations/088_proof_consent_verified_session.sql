-- 088_proof_consent_verified_session.sql
-- ADR-001 Phase 2 (CONSENT ONLY). Extends + hardens the proof_consent ledger (025) for the
-- verified-session feature. This is proof_consent's FIRST-EVER enforcement site. NO media, storage,
-- Azure Blob, or transcription here — those are Phase 3 (verified_sessions / session_media).
-- Everything is gated behind ENABLE_VERIFIED_SESSION at the app layer; this migration is purely
-- additive + reversible. prod/main is FROZEN — apply to DEV only, by hand, per the ADR.
--
-- CHANGES
--   1. Extend the modality CHECK with the capture modalities camera / microphone /
--      walkthrough_recording (ADR §8/§11).
--   2. Add server-stamped evidence columns:
--        submission_id     — ties a consent decision to the specific session/submission
--        decision          — 'granted' | 'declined' (a decline is recorded candidate-side only;
--                            it is NEVER recruiter-visible — see the RLS note + ADR Principle 7)
--        consent_copy_hash — SHA-256 of the actually-rendered consent copy, SERVER-stamped on grant
--        context           — server-stamped capture context (ids/states only; never PII/payloads)
--   3. HARDEN the 025 policies so consent rows are evidence-grade (ADR §8):
--        (a) candidate self-INSERT limited to the LEGACY modalities (behavioral/face/keystroke);
--            the new capture modalities are service-role-only, so the copy hash + context are
--            server-stamped and a script can't forge a "granted camera" row without the rendered copy.
--        (b) candidate UPDATE restricted by a BEFORE UPDATE trigger to EXACTLY the
--            withdrawn_at NULL->timestamp transition (the 079 guard-trigger idiom; RLS WITH CHECK
--            cannot compare OLD vs NEW per column). service_role writes bypass the guard.
--        (c) no DELETE (unchanged — consent history is evidence).
--
-- DOWN (reversible; safe once no rows use the new modalities):
--   DROP TRIGGER IF EXISTS proof_consent_guard_update ON public.proof_consent;
--   DROP FUNCTION IF EXISTS public.guard_proof_consent_update();
--   DROP POLICY IF EXISTS consent_self_insert ON public.proof_consent;
--   CREATE POLICY consent_self_insert ON public.proof_consent FOR INSERT TO authenticated
--     WITH CHECK (candidate_id = auth.uid());                       -- restore 025's open insert
--   ALTER TABLE public.proof_consent DROP CONSTRAINT IF EXISTS proof_consent_modality_check;
--   ALTER TABLE public.proof_consent ADD CONSTRAINT proof_consent_modality_check
--     CHECK (modality IN ('behavioral','face','keystroke'));        -- restore prior CHECK
--   DROP INDEX IF EXISTS idx_proof_consent_submission;
--   ALTER TABLE public.proof_consent
--     DROP COLUMN IF EXISTS submission_id, DROP COLUMN IF EXISTS decision,
--     DROP COLUMN IF EXISTS consent_copy_hash, DROP COLUMN IF EXISTS context;

-- 1 + 2 — additive columns + extended modality CHECK ------------------------------------------
ALTER TABLE public.proof_consent
  ADD COLUMN IF NOT EXISTS submission_id     UUID REFERENCES public.work_sample_submissions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS decision          TEXT NOT NULL DEFAULT 'granted' CHECK (decision IN ('granted','declined')),
  ADD COLUMN IF NOT EXISTS consent_copy_hash TEXT,
  ADD COLUMN IF NOT EXISTS context           JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.proof_consent DROP CONSTRAINT IF EXISTS proof_consent_modality_check;
ALTER TABLE public.proof_consent
  ADD CONSTRAINT proof_consent_modality_check
  CHECK (modality IN ('behavioral','face','keystroke','camera','microphone','walkthrough_recording'));

CREATE INDEX IF NOT EXISTS idx_proof_consent_submission ON public.proof_consent(submission_id);

-- 3a — candidate self-INSERT limited to the legacy modalities; capture modalities are server-only.
DROP POLICY IF EXISTS consent_self_insert ON public.proof_consent;
CREATE POLICY consent_self_insert ON public.proof_consent
  FOR INSERT TO authenticated
  WITH CHECK (candidate_id = auth.uid() AND modality IN ('behavioral','face','keystroke'));

-- 3b — withdrawal-only UPDATE guard (079 idiom). NOT SECURITY DEFINER: current_user must reflect the
-- PostgREST-set role so service_role (the backend) is unaffected and only the user-facing roles are
-- constrained. The 025 consent_self_withdraw policy (candidate UPDATE own rows) STAYS; this trigger
-- constrains WHICH change is permitted to exactly the withdrawn_at NULL->timestamp transition.
CREATE OR REPLACE FUNCTION public.guard_proof_consent_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NOT (OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL) THEN
      RAISE EXCEPTION 'proof_consent: candidates may only withdraw (set withdrawn_at once)';
    END IF;
    IF NEW.candidate_id      IS DISTINCT FROM OLD.candidate_id
       OR NEW.submission_id  IS DISTINCT FROM OLD.submission_id
       OR NEW.modality       IS DISTINCT FROM OLD.modality
       OR NEW.decision       IS DISTINCT FROM OLD.decision
       OR NEW.consent_version IS DISTINCT FROM OLD.consent_version
       OR NEW.consent_copy_hash IS DISTINCT FROM OLD.consent_copy_hash
       OR NEW.granted_at     IS DISTINCT FROM OLD.granted_at
       OR NEW.context        IS DISTINCT FROM OLD.context THEN
      RAISE EXCEPTION 'proof_consent: only withdrawn_at may change on a candidate withdrawal';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proof_consent_guard_update ON public.proof_consent;
CREATE TRIGGER proof_consent_guard_update
  BEFORE UPDATE ON public.proof_consent
  FOR EACH ROW EXECUTE FUNCTION public.guard_proof_consent_update();

COMMENT ON TABLE public.proof_consent IS
  'Per-(candidate,modality,submission) versioned consent ledger. Capture modalities '
  '(camera/microphone/walkthrough_recording) are server-mediated grants carrying a server-stamped '
  'consent_copy_hash; candidate UPDATE is withdrawal-only (trigger-guarded, 079 idiom). '
  'Candidate-scoped RLS. A declined/withdrawn state is NEVER exposed to a recruiter or any external '
  'system (ADR-001 Principle 7).';

SELECT 'proof_consent verified-session extension + hardening ready' AS status;
