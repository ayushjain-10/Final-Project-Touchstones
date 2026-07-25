-- 083 — transactional right-to-erasure for a candidate's own account. The previous /delete-account
-- ran three non-transactional deletes; for any SCORED candidate the work_sample_submissions delete
-- cascades into the append-only proof_audit_log (011) whose BEFORE DELETE trigger RAISEs, aborting
-- mid-way and leaving a corrupt half-deletion (credentials gone, everything else intact). This RPC
-- does it atomically and correctly:
--   * Guards (account_type, owns no screens, not a workspace member) are checked HERE, fail-closed.
--   * Unscored (no immutable audit rows) → hard-delete submissions + credentials; the caller then
--     removes the auth user (cascade is clean).
--   * Scored → ANONYMIZE: scrub PII on the profile + submission bodies, drop credentials; KEEP the
--     submissions/scores/audit chain (immutable trust record). Anonymized data is not personal data.
-- SECURITY DEFINER + locked search_path; callable only by service_role (the backend, after it has
-- verified the caller owns the uid).

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
    DELETE FROM work_sample_submissions WHERE candidate_id = p_uid; -- no audit rows → no trigger
    RETURN jsonb_build_object('ok', true, 'mode', 'hard');
  ELSE
    UPDATE work_sample_submissions SET response_text = NULL, response_code = NULL WHERE candidate_id = p_uid;
    UPDATE profiles
      SET email = 'deleted-' || p_uid::text || '@deleted.invalid', first_name = NULL, last_name = NULL, company = NULL
      WHERE id = p_uid;
    RETURN jsonb_build_object('ok', true, 'mode', 'anonymized');
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.erase_candidate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_candidate(uuid) TO service_role;
