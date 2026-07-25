-- 110_erase_account
--
-- WHY: erase_candidate (083/104) refuses any account whose profiles.account_type is not
-- 'candidate' (reason not_candidate) and also refuses candidates that own screens or sit in a
-- workspace. Direct deletion of such accounts is blocked by the append-only integrity chain
-- (012) and the NO ACTION invite FKs (106), so recruiter / mixed-role erasure had NO sanctioned
-- path; it was once worked around manually with a service-role transaction using the 104 GUC
-- bypass plus auth.admin.deleteUser. This migration makes that path a real, transactional RPC:
-- public.erase_account(p_uid, p_mode), the account-side sibling of erase_candidate.
--
-- SHAPE (mirrors 083/104):
--   * Guards are checked first, fail-closed, and return structured reasons:
--       not_found | is_candidate (use erase_candidate) | invalid_mode
--       | unhandled_schema (an FK into profiles/auth.users this function cannot map)
--       | third_party_evidence (strict mode only, see GUARD RAIL below).
--   * Unscored account (no proof_scores on its own submissions) -> mode 'hard': every owned
--     row is deleted and the profiles row itself is deleted; the CALLER then removes the
--     auth user via auth.admin.deleteUser (same division of labor as 083; the auth cascade
--     into profiles is a no-op by then).
--   * Scored account (it has kept, immutable trust records as a candidate) -> mode
--     'anonymized': its submissions/scores/audit chain are KEPT and scrubbed exactly as
--     083/104 do (response text NULL, ai_interactions '[erased]', probe turns emptied,
--     integrity meta tombstoned under the 104 GUC), the profile is PII-scrubbed, and all
--     recruiter-owned rows are deleted. The caller then bans + scrubs the auth identity.
--
-- GUARD RAIL (third-party evidence): if the account owns work_samples that carry submissions
-- from OTHER users, deleting those screens would cascade-destroy other people's evidence.
--   * p_mode = 'strict' (default): refuse, listing the blocking work sample ids.
--   * p_mode = 'detach': anonymize ownership instead (owner_id := NULL, the ownership
--     tombstone, in the spirit of 104's {"erased": true} meta tombstone) and keep the
--     submissions intact, then proceed.
-- Screens whose only kept submissions are the account's OWN scored ones are detached in BOTH
-- modes: they are not third-party evidence, but deleting them would cascade into proof_scores
-- and the append-only proof_audit_log (011), which has no erasure bypass, by design.
-- Surviving interview_probes run by the erased account (its account_id FK is ON DELETE
-- CASCADE) are detached the same way (account_id := NULL): they are part of the kept
-- candidate evidence, never the recruiter's to destroy.
--
-- COVERAGE: after the explicit special cases (work_samples, work_sample_submissions,
-- interview_probes, work_sample_invites, workspace_members, verified_credentials), every
-- remaining owned row is cleaned by a catalog-driven sweep over the FKs that reference
-- public.profiles(id) or auth.users(id): CASCADE FKs are deleted, SET NULL FKs are nulled.
-- This emulates exactly what dropping the profiles row would cascade to, works identically
-- in the anonymize branch (where the profiles row must survive), and cannot silently miss a
-- table added later: an FK with any other delete rule makes the RPC refuse (unhandled_schema)
-- BEFORE it mutates anything.
--
-- DDL: work_samples.owner_id and interview_probes.account_id drop NOT NULL so NULL can serve
-- as the detached-owner tombstone. RLS owner checks (owner_id = auth.uid()) never match NULL,
-- so detached rows are invisible to end users and reachable only by service paths.
--
-- SECURITY DEFINER + locked search_path; callable only by service_role. The definer runs as
-- the table owner, so the 091 verified_credentials write guard and RLS do not apply (same as
-- 083), and the 104 GUC bypass is set transaction-locally around the integrity-chain steps.
--
-- DATA NOTE: erased/anonymized data is not restorable, one-way by design (as in 104).
--
-- DOWN (reversal, per project rules; run manually to roll back):
--   * DROP FUNCTION IF EXISTS public.erase_account(uuid, text);
--   * ALTER TABLE work_samples ALTER COLUMN owner_id SET NOT NULL;
--     (fails while detached rows exist; delete or reassign owner_id IS NULL rows first)
--   * ALTER TABLE interview_probes ALTER COLUMN account_id SET NOT NULL;
--     (same caveat for account_id IS NULL rows)
--   * Erased data is not restorable (intentional, documented above).

-- (1) NULL as the detached-owner tombstone.
ALTER TABLE work_samples ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE interview_probes ALTER COLUMN account_id DROP NOT NULL;

-- (2) The RPC.
CREATE OR REPLACE FUNCTION public.erase_account(p_uid uuid, p_mode text DEFAULT 'strict')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text;
  v_scored int;
  v_third_party uuid[];
  v_self_kept uuid[];
  v_detached uuid[];
  v_unhandled text[];
  r record;
BEGIN
  IF p_mode NOT IN ('strict', 'detach') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_mode');
  END IF;

  SELECT account_type INTO v_type FROM profiles WHERE id = p_uid;
  IF v_type IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  -- Plain candidates already have a sanctioned path; keep exactly one path per account shape.
  IF v_type = 'candidate'
     AND NOT EXISTS (SELECT 1 FROM work_samples WHERE owner_id = p_uid)
     AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE member_id = p_uid OR owner_id = p_uid)
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'is_candidate');
  END IF;

  -- Fail closed on schema drift BEFORE mutating anything: every FK into profiles/auth.users
  -- from a table the sweep will visit must be single-column ON DELETE CASCADE or SET NULL.
  SELECT array_agg(DISTINCT c.conrelid::regclass::text) INTO v_unhandled
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE c.contype = 'f' AND n.nspname = 'public'
    AND c.confrelid IN ('public.profiles'::regclass, 'auth.users'::regclass)
    AND c.conrelid::regclass::text NOT IN
        ('profiles', 'work_samples', 'work_sample_submissions', 'interview_probes',
         'work_sample_invites', 'workspace_members')
    AND (c.confdeltype NOT IN ('c', 'n') OR array_length(c.conkey, 1) <> 1);
  IF v_unhandled IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unhandled_schema',
                              'tables', to_jsonb(v_unhandled));
  END IF;

  -- GUARD RAIL: owned screens carrying other users' submissions.
  SELECT coalesce(array_agg(DISTINCT ws.id), '{}') INTO v_third_party
  FROM work_samples ws
  WHERE ws.owner_id = p_uid
    AND EXISTS (SELECT 1 FROM work_sample_submissions s
                WHERE s.work_sample_id = ws.id AND s.candidate_id <> p_uid);
  IF p_mode = 'strict' AND array_length(v_third_party, 1) IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'third_party_evidence',
                              'blocking_work_samples', to_jsonb(v_third_party));
  END IF;

  -- Owned screens whose kept record is the account's OWN scored submissions: detach in both
  -- modes (deleting them would cascade into the append-only proof_audit_log, which RAISEs).
  SELECT coalesce(array_agg(DISTINCT ws.id), '{}') INTO v_self_kept
  FROM work_samples ws
  WHERE ws.owner_id = p_uid
    AND EXISTS (SELECT 1 FROM work_sample_submissions s
                JOIN proof_scores ps ON ps.submission_id = s.id
                WHERE s.work_sample_id = ws.id AND s.candidate_id = p_uid);

  v_detached := ARRAY(SELECT DISTINCT unnest(v_third_party || v_self_kept));

  SELECT count(*) INTO v_scored
  FROM proof_scores ps JOIN work_sample_submissions s ON s.id = ps.submission_id
  WHERE s.candidate_id = p_uid;

  -- Detach ownership (the NULL tombstone); the delete below then skips these rows.
  UPDATE work_samples SET owner_id = NULL WHERE id = ANY(v_detached);

  -- Invites: invited_by is a plain (NO ACTION) FK from 106 that would block the profiles
  -- delete, and the rows are the erased account's own outreach -> delete. Invites this
  -- account CLAIMED belong to another tenant: unlink and tombstone the invited email (their
  -- PII); the per-row id keeps the (work_sample_id, email) unique index satisfied.
  DELETE FROM work_sample_invites WHERE invited_by = p_uid;
  UPDATE work_sample_invites
     SET claimed_by = NULL, email = 'deleted-' || id::text || '@deleted.invalid'
   WHERE claimed_by = p_uid;

  -- verified_credentials has no inbound FK from the audit chain -> safe to delete (as in 083).
  DELETE FROM verified_credentials WHERE candidate_id = p_uid;

  -- Hard deletions whose cascades cross the append-only integrity trigger: 104 GUC bypass,
  -- transaction-local, flipped off again immediately after.
  PERFORM set_config('touchstone.erasure', 'on', true);
  -- Remaining owned screens carry no third-party and no scored submissions by construction.
  DELETE FROM work_samples WHERE owner_id = p_uid;
  IF v_scored = 0 THEN
    DELETE FROM work_sample_submissions WHERE candidate_id = p_uid;
  END IF;
  PERFORM set_config('touchstone.erasure', 'off', true);

  IF v_scored > 0 THEN
    -- Anonymize branch: keep the immutable trust record, scrub it exactly as 083/085/104 do.
    UPDATE work_sample_submissions SET response_text = NULL, response_code = NULL
      WHERE candidate_id = p_uid;
    UPDATE ai_interactions SET content = '[erased]'
      WHERE submission_id IN (SELECT id FROM work_sample_submissions WHERE candidate_id = p_uid);
    UPDATE ai_direction_scores SET reasoning = NULL, per_dimension = NULL
      WHERE submission_id IN (SELECT id FROM work_sample_submissions WHERE candidate_id = p_uid);
    UPDATE interview_probes SET turns = '[]'::jsonb, dimensions = NULL, reasoning = NULL
      WHERE submission_id IN (SELECT id FROM work_sample_submissions WHERE candidate_id = p_uid);

    PERFORM set_config('touchstone.erasure', 'on', true);
    UPDATE submission_integrity_events SET meta = jsonb_build_object('erased', true)
      WHERE submission_id IN (SELECT id FROM work_sample_submissions WHERE candidate_id = p_uid);
    PERFORM set_config('touchstone.erasure', 'off', true);
  END IF;

  -- Workspace rows reference auth.users and member_email is PII on either side of the
  -- relationship; if p_uid owned the workspace it dissolves with the account.
  DELETE FROM workspace_members WHERE owner_id = p_uid OR member_id = p_uid;

  -- Probes the account ran that survived the deletes above sit on kept submissions
  -- (detached screens / the kept trust record): candidate evidence, so detach, never delete.
  UPDATE interview_probes SET account_id = NULL WHERE account_id = p_uid;

  -- Catalog-driven sweep: emulate the profiles-row cascade for every remaining reference.
  -- Identifiers come from pg_catalog and are %I/%s-quoted; the drift guard above already
  -- proved each visited FK is single-column CASCADE or SET NULL.
  FOR r IN
    SELECT c.conrelid::regclass AS tbl,
           (SELECT a.attname FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS col,
           c.confdeltype AS rule
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'
      AND c.confrelid IN ('public.profiles'::regclass, 'auth.users'::regclass)
      AND c.conrelid::regclass::text NOT IN
          ('profiles', 'work_samples', 'work_sample_submissions', 'interview_probes',
           'work_sample_invites', 'workspace_members')
  LOOP
    IF r.rule = 'c' THEN
      EXECUTE format('DELETE FROM %s WHERE %I = $1', r.tbl, r.col) USING p_uid;
    ELSE
      EXECUTE format('UPDATE %s SET %I = NULL WHERE %I = $1', r.tbl, r.col, r.col) USING p_uid;
    END IF;
  END LOOP;

  IF v_scored = 0 THEN
    -- Every reference is gone; a missed NO ACTION FK would error here and roll back (fail
    -- closed). The caller removes the auth user next; its cascade into profiles is a no-op.
    DELETE FROM profiles WHERE id = p_uid;
    RETURN jsonb_build_object('ok', true, 'mode', 'hard',
                              'detached_work_samples', to_jsonb(v_detached));
  ELSE
    UPDATE profiles
      SET email = 'deleted-' || p_uid::text || '@deleted.invalid',
          first_name = NULL, last_name = NULL, company = NULL
      WHERE id = p_uid;
    RETURN jsonb_build_object('ok', true, 'mode', 'anonymized',
                              'detached_work_samples', to_jsonb(v_detached));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.erase_account(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_account(uuid, text) TO service_role;

SELECT 'erase_account (recruiter/mixed right-to-erasure RPC + detached-owner tombstone) ready' AS status;
