-- 085 — close the free-text gap in erase_candidate's ANONYMIZE branch.
--
-- 083 anonymizes a SCORED candidate by scrubbing the submission bodies (response_text/response_code)
-- and profile PII, while KEEPING the submissions/scores/audit chain (the immutable trust record).
-- But three tables linked to those KEPT submissions still hold candidate free-text and were NOT
-- scrubbed, so personal data survived "erasure":
--   * ai_interactions.content        — the candidate's AI-assistant prompts/messages
--   * ai_direction_scores.reasoning + per_dimension — model eval text/evidence quoting the candidate
--   * interview_probes.turns + dimensions + reasoning — the candidate's probe answers + eval
--
-- All three FK submission_id → work_sample_submissions ON DELETE CASCADE, so the HARD-delete branch
-- (unscored candidate) already removes them; only the anonymize branch needs an explicit scrub.
-- The integrity hash-chains (proof_audit_log, submission_integrity_events) store only hashes, so they
-- remain intact + tamper-evident — anonymized data is not personal data.
--
-- This is a CREATE OR REPLACE of 083 with the anonymize branch extended (strictly more-complete
-- deletion; no behavior change to the guards or the hard-delete path). The founder applies migrations
-- manually.

CREATE OR REPLACE FUNCTION public.erase_candidate(p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text;
  v_scored int;
BEGIN
  SELECT account_type INTO v_type FROM profiles WHERE id = p_uid;
  IF v_type IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_type <> 'candidate' THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_candidate'); END IF;
  IF EXISTS (SELECT 1 FROM work_samples WHERE owner_id = p_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'owns_screens');
  END IF;
  IF EXISTS (SELECT 1 FROM workspace_members WHERE member_id = p_uid OR owner_id = p_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'workspace_member');
  END IF;

  SELECT count(*) INTO v_scored
  FROM proof_scores ps JOIN work_sample_submissions s ON s.id = ps.submission_id
  WHERE s.candidate_id = p_uid;

  -- verified_credentials has no inbound FK from the audit chain → safe to delete in both paths.
  DELETE FROM verified_credentials WHERE candidate_id = p_uid;

  IF v_scored = 0 THEN
    DELETE FROM work_sample_submissions WHERE candidate_id = p_uid; -- cascades to all linked tables
    RETURN jsonb_build_object('ok', true, 'mode', 'hard');
  ELSE
    UPDATE work_sample_submissions SET response_text = NULL, response_code = NULL WHERE candidate_id = p_uid;
    UPDATE profiles
      SET email = 'deleted-' || p_uid::text || '@deleted.invalid', first_name = NULL, last_name = NULL, company = NULL
      WHERE id = p_uid;

    -- Scrub candidate free-text in the KEPT linked tables (083 missed these). Scope to this
    -- candidate's submissions; keep the numeric scores + hash-chain rows intact.
    UPDATE ai_interactions SET content = '[erased]'
      WHERE submission_id IN (SELECT id FROM work_sample_submissions WHERE candidate_id = p_uid);
    UPDATE ai_direction_scores SET reasoning = NULL, per_dimension = NULL
      WHERE submission_id IN (SELECT id FROM work_sample_submissions WHERE candidate_id = p_uid);
    UPDATE interview_probes SET turns = '[]'::jsonb, dimensions = NULL, reasoning = NULL
      WHERE submission_id IN (SELECT id FROM work_sample_submissions WHERE candidate_id = p_uid);

    RETURN jsonb_build_object('ok', true, 'mode', 'anonymized');
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.erase_candidate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_candidate(uuid) TO service_role;
