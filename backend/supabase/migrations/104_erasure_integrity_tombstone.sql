-- 104_erasure_integrity_tombstone
--
-- WHY: right-to-erasure (erase_candidate, 083/085) and the tamper-evident integrity chain
-- (submission_integrity_events, 012/021) conflicted in BOTH erasure branches:
--   * HARD branch (unscored candidate): DELETE FROM work_sample_submissions cascades into
--     submission_integrity_events (FK ON DELETE CASCADE, 011), whose BEFORE DELETE trigger
--     trg_integrity_immutable (012) RAISEs. Any unscored candidate with integrity events
--     could not be erased at all: the whole RPC aborted.
--   * ANONYMIZE branch (scored candidate): chain rows were kept untouched, but meta is NOT
--     "only hashes" (085's comment overclaimed this): it carries event payloads, including
--     probe question/answer text (category='interview', meta.text from interviewProbeService).
--     Keeping those fails the erasure obligation.
--
-- FIX (this migration):
--   (1) trg_integrity_immutable gains a NARROW bypass: a transaction-local GUC
--       (touchstone.erasure = 'on') set only by the erasure path. Under the GUC, DELETE is
--       allowed (hard-branch cascade) and UPDATE is allowed ONLY when every column except
--       meta is unchanged (a payload scrub can never rewrite the chain itself). RLS policies
--       and table grants are untouched: end users still have zero direct DML on this table
--       (093), so only service_role / owner code paths can ever reach this bypass.
--   (2) erase_candidate (CREATE OR REPLACE of the 085 body): the anonymize branch tombstones
--       integrity payloads (meta := {"erased": true}) for the candidate's submissions,
--       PRESERVING seq, type, category, timestamps, prev_hash, row_hash and source so the
--       chain linkage and the signable head_hash survive; the hard branch sets the GUC so
--       the cascade delete can proceed.
--   (3) One-time scrub of probe transcript text already persisted in the chain
--       (interviewProbeService stored the first 500 chars of every probe turn in meta.text).
--       Replaced with {len, sha256, erased:true}: length plus a content hash of the stored
--       text keep the row auditable and tamper-bound without retaining the words themselves.
--       The service now writes {len, sha256} for new rows, so no further scrub is needed.
--
-- VERIFIER CONTRACT: the JS verifier (integrityDigestService.verifyLinkage) recomputes each
-- row's content hash from meta, so a scrubbed row can no longer prove its own payload bytes.
-- verifyLinkage (updated alongside this migration) skips the content-hash check for rows
-- whose meta carries erased:true but still enforces the prev_hash -> row_hash linkage. The
-- stored row_hash of a scrubbed row remains pinned by every later row's prev_hash, so the
-- chain stays tamper-evident end to end and existing credentials (head_hash) remain valid.
-- Candidates cannot forge tombstones: they have no UPDATE grant (093) and the append RPC
-- always writes a row_hash matching the meta it was given.
--
-- DATA NOTE: the payload scrubs in (2)'s anonymize branch and in (3) are ONE-WAY by design
-- (that is the point of erasure). The DOWN section below restores schema and functions,
-- never scrubbed data.
--
-- DOWN (reversal, per project rules; run manually to roll back):
--   * Restore the 012 trigger function (unconditional append-only):
--       CREATE OR REPLACE FUNCTION submission_integrity_immutable() RETURNS TRIGGER AS $fn$
--       BEGIN
--         RAISE EXCEPTION 'submission_integrity_events is append-only; % is not permitted', TG_OP;
--       END;
--       $fn$ LANGUAGE plpgsql;
--   * Restore erase_candidate to the 085 body (see 085_erase_candidate_freetext.sql; note
--     that body breaks hard-branch erasure again, which is why 104 exists).
--   * Scrubbed meta payloads are not restorable (intentional, documented above).

-- (1) Narrow erasure bypass in the append-only trigger. Everything else still RAISEs.
CREATE OR REPLACE FUNCTION submission_integrity_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('touchstone.erasure', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;  -- hard-erasure cascade from work_sample_submissions
    END IF;
    IF TG_OP = 'UPDATE'
       AND NEW.id            IS NOT DISTINCT FROM OLD.id
       AND NEW.submission_id IS NOT DISTINCT FROM OLD.submission_id
       AND NEW.seq           IS NOT DISTINCT FROM OLD.seq
       AND NEW.type          IS NOT DISTINCT FROM OLD.type
       AND NEW.category      IS NOT DISTINCT FROM OLD.category
       AND NEW.client_ts     IS NOT DISTINCT FROM OLD.client_ts
       AND NEW.server_ts     IS NOT DISTINCT FROM OLD.server_ts
       AND NEW.ts            IS NOT DISTINCT FROM OLD.ts
       AND NEW.prev_hash     IS NOT DISTINCT FROM OLD.prev_hash
       AND NEW.row_hash      IS NOT DISTINCT FROM OLD.row_hash
       AND NEW.source        IS NOT DISTINCT FROM OLD.source
    THEN
      RETURN NEW;  -- payload (meta) scrub only; chain columns provably unchanged
    END IF;
  END IF;
  RAISE EXCEPTION 'submission_integrity_events is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

-- (2) erase_candidate: 085 body + the integrity-chain handling in both branches.
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

  -- verified_credentials has no inbound FK from the audit chain -> safe to delete in both paths.
  DELETE FROM verified_credentials WHERE candidate_id = p_uid;

  IF v_scored = 0 THEN
    -- 104: the cascade into submission_integrity_events must pass the append-only trigger;
    -- transaction-local GUC, flipped off again immediately after the delete.
    PERFORM set_config('touchstone.erasure', 'on', true);
    DELETE FROM work_sample_submissions WHERE candidate_id = p_uid; -- cascades to all linked tables
    PERFORM set_config('touchstone.erasure', 'off', true);
    RETURN jsonb_build_object('ok', true, 'mode', 'hard');
  ELSE
    UPDATE work_sample_submissions SET response_text = NULL, response_code = NULL WHERE candidate_id = p_uid;
    UPDATE profiles
      SET email = 'deleted-' || p_uid::text || '@deleted.invalid', first_name = NULL, last_name = NULL, company = NULL
      WHERE id = p_uid;

    -- Scrub candidate free-text in the KEPT linked tables (085). Scope to this candidate's
    -- submissions; keep the numeric scores + hash-chain rows intact.
    UPDATE ai_interactions SET content = '[erased]'
      WHERE submission_id IN (SELECT id FROM work_sample_submissions WHERE candidate_id = p_uid);
    UPDATE ai_direction_scores SET reasoning = NULL, per_dimension = NULL
      WHERE submission_id IN (SELECT id FROM work_sample_submissions WHERE candidate_id = p_uid);
    UPDATE interview_probes SET turns = '[]'::jsonb, dimensions = NULL, reasoning = NULL
      WHERE submission_id IN (SELECT id FROM work_sample_submissions WHERE candidate_id = p_uid);

    -- 104: tombstone integrity event payloads. Chain columns (seq, type, category,
    -- timestamps, prev_hash, row_hash, source) are preserved so linkage and the signable
    -- head_hash still verify; the verifier skips the content hash of erased rows.
    PERFORM set_config('touchstone.erasure', 'on', true);
    UPDATE submission_integrity_events SET meta = jsonb_build_object('erased', true)
      WHERE submission_id IN (SELECT id FROM work_sample_submissions WHERE candidate_id = p_uid);
    PERFORM set_config('touchstone.erasure', 'off', true);

    RETURN jsonb_build_object('ok', true, 'mode', 'anonymized');
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.erase_candidate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_candidate(uuid) TO service_role;

-- (3) One-time scrub of probe transcript text out of the chain. sha256 is computed over the
-- stored (500-char-truncated) text, which is all that was ever persisted here; it keeps the
-- scrubbed row content-addressable for audit without retaining the words. ONE-WAY (see DATA
-- NOTE above). digest() lives in the extensions schema on Supabase, hence the search_path.
DO $$
BEGIN
  PERFORM set_config('search_path', 'public, extensions, pg_temp', true);
  PERFORM set_config('touchstone.erasure', 'on', true);
  UPDATE submission_integrity_events
     SET meta = jsonb_build_object(
       'len',    coalesce((meta->>'len')::int, length(meta->>'text')),
       'sha256', encode(digest(coalesce(meta->>'text', ''), 'sha256'), 'hex'),
       'erased', true
     )
   WHERE category = 'interview'
     AND meta ? 'text';
  PERFORM set_config('touchstone.erasure', 'off', true);
END $$;

SELECT 'erasure/integrity tombstone (trigger bypass + erase_candidate + probe-text scrub) ready' AS status;
