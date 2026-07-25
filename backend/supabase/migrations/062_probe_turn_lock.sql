-- 062_probe_turn_lock.sql — SECURITY/ROBUSTNESS FIX (v2-hardening-2, S1-1).
-- ----------------------------------------------------------------------------------------
-- FINDING (S1-1): the PUBLIC probe answer route did a read-modify-write on interview_probes.turns
-- with NO concurrency control. Two concurrent answers on one token both saw status='in_progress',
-- both fired (unbudgeted) LLM calls, double-appended integrity events, and last-write-wins
-- clobbered the transcript / could push past max_turns.
--
-- FIX: an atomic, serialized turn-append primitive. append_probe_turn takes a per-token
-- transaction advisory lock, re-reads the row UNDER the lock, enforces the turn-state machine
-- (a 'candidate' answer is only valid when the last turn is an 'interviewer' question; an
-- 'interviewer' question only right after a 'candidate' answer), then appends. A concurrent /
-- duplicate answer for the same question loses the turn-state check and is rejected (ok:false),
-- so exactly ONE answer is recorded and only its handler proceeds to spend on an LLM call.
-- Service-role only (the backend calls it via supabaseAdmin); never exposed to anon/authenticated.
--
-- NOT applied by this file — the founder applies migrations manually via the Management API.

CREATE OR REPLACE FUNCTION public.append_probe_turn(
  p_probe_id  uuid,
  p_token     text,
  p_role      text,
  p_content   text,
  p_client_ts timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_turns jsonb;
  v_status text;
  v_last jsonb;
  v_seq int;
  v_asked int;
BEGIN
  IF p_role NOT IN ('candidate', 'interviewer') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_role');
  END IF;

  -- Serialize all turn-appends for this probe (per token; fall back to id). Held for the
  -- duration of THIS transaction, so two concurrent calls cannot interleave the read-append.
  PERFORM pg_advisory_xact_lock(hashtext(COALESCE(p_token, p_probe_id::text)));

  SELECT turns, status INTO v_turns, v_status
  FROM interview_probes WHERE id = p_probe_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_status <> 'in_progress' THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_in_progress'); END IF;

  v_turns := COALESCE(v_turns, '[]'::jsonb);
  v_last := v_turns -> (jsonb_array_length(v_turns) - 1);

  -- Turn-state machine: reject a duplicate/out-of-order append (this is what stops the race).
  IF p_role = 'candidate' AND (v_last IS NULL OR v_last->>'role' <> 'interviewer') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_awaiting_answer');
  END IF;
  IF p_role = 'interviewer' AND v_last IS NOT NULL AND v_last->>'role' <> 'candidate' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_awaiting_question');
  END IF;

  v_seq := jsonb_array_length(v_turns) + 1;
  v_turns := v_turns || jsonb_build_object(
    'seq', v_seq, 'role', p_role, 'content', p_content, 'client_ts', p_client_ts
  );
  UPDATE interview_probes SET turns = v_turns WHERE id = p_probe_id;

  SELECT count(*) INTO v_asked
  FROM jsonb_array_elements(v_turns) e WHERE e->>'role' = 'interviewer';

  RETURN jsonb_build_object('ok', true, 'turns', v_turns, 'asked', v_asked, 'seq', v_seq);
END;
$$;

-- Service-role ONLY. Supabase default-grants EXECUTE on public functions to anon/authenticated,
-- so we must explicitly revoke from them (not just PUBLIC) — otherwise a candidate could call
-- this SECURITY DEFINER primitive directly and inject turns into any probe (RLS-bypassing).
REVOKE EXECUTE ON FUNCTION public.append_probe_turn(uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.append_probe_turn(uuid, text, text, text, timestamptz) TO service_role;

SELECT 'append_probe_turn (serialized turn-append) ready' AS status;
