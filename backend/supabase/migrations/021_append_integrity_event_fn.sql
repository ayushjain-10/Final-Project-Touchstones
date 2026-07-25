-- 021_append_integrity_event_fn.sql  (roadmap #7)
-- Atomic, race-safe chain extension for submission_integrity_events.
--
-- The bug this fixes: integrity.js read the chain head, computed seq/prev_hash in
-- Node, then inserted — a classic read-head-then-insert race. Two concurrent POSTs
-- read the same head and both write seq=N with the same prev_hash, silently FORKING
-- the tamper-evident chain (the whole point of which is that it cannot fork).
--
-- The fix has three independent guarantees so a fork errors LOUDLY instead of
-- silently:
--   (1) a per-submission advisory lock serializes concurrent appends to one chain,
--   (2) the head is read UNDER that lock (so seq/prev_hash are consistent),
--   (3) a UNIQUE(submission_id, seq) constraint is the last line of defense — if any
--       path ever bypasses the lock, the second writer gets a unique violation, not a
--       silent duplicate.
--
-- SECURITY DEFINER: chain authority is server-side. The function owns the write so it
-- can enforce the lock, the cap, and the canonical hash recipe regardless of the
-- caller's RLS. Callers still pass through an ownership check in the route before
-- invoking it; EXECUTE is granted to `authenticated` only (revoked from public/anon).

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- digest() for sha256

-- Last-line-of-defense: any concurrent fork that slips past the advisory lock collides
-- here instead of writing a duplicate seq. Created NOT VALID-safe via a unique index so
-- it is idempotent and does not break if (submission_id, seq) already happens to be
-- unique in existing data (it is — the chain has only ever been written single-threaded
-- in practice, but that is luck, not a guarantee, which is exactly what this closes).
CREATE UNIQUE INDEX IF NOT EXISTS uq_integrity_submission_seq
  ON submission_integrity_events(submission_id, seq);

-- Canonical content hash. MUST stay byte-identical to the JS verifier in
-- integrity.js (verifyLinkage). Recipe:
--   row_hash = sha256( prev_hash
--                      || seq || '\x1f' || type || '\x1f' || coalesce(category,'')
--                      || '\x1f' || canonical(meta) || '\x1f' || coalesce(client_ts,'') )
-- where canonical(meta) is jsonb cast to text with sorted keys. We use unit-separator
-- (0x1f) delimiters that cannot appear in the scalar fields, and jsonb's own canonical
-- text form (Postgres sorts object keys and strips insignificant whitespace) so the
-- string is reproducible. The JS side reproduces this exact recipe.
CREATE OR REPLACE FUNCTION public.integrity_row_hash(
  p_prev_hash  text,
  p_seq        int,
  p_type       text,
  p_category   text,
  p_meta       jsonb,
  p_client_ts  text
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp  -- digest() (pgcrypto) lives in the extensions schema on Supabase
AS $$
  SELECT encode(
    digest(
      coalesce(p_prev_hash, '')
        || p_seq::text          || chr(31)
        || coalesce(p_type, '') || chr(31)
        || coalesce(p_category, '') || chr(31)
        -- jsonb::text is canonical (sorted keys, no insignificant whitespace);
        -- coalesce to the empty object so a NULL meta hashes identically on both sides.
        || coalesce(p_meta, '{}'::jsonb)::text || chr(31)
        || coalesce(p_client_ts, ''),
      'sha256'
    ),
    'hex'
  );
$$;

COMMENT ON FUNCTION public.integrity_row_hash(text,int,text,text,jsonb,text) IS
  'Canonical chain row hash. Kept byte-identical to the JS verifier (integrity.js verifyLinkage). Pure/IMMUTABLE so it can be reused for verification.';

-- append_integrity_event: the ONLY supported way to extend a chain.
-- Returns the new head (seq + row_hash) so the caller can echo the trust digest.
-- p_source defaults to client_attested (display-only); a trusted server path passes
-- 'server_observed' to make a row count toward the digest.
CREATE OR REPLACE FUNCTION public.append_integrity_event(
  p_submission_id uuid,
  p_type          text,
  p_category      text    DEFAULT NULL,
  p_meta          jsonb   DEFAULT '{}'::jsonb,
  p_client_ts     text    DEFAULT NULL,
  p_source        text    DEFAULT 'client_attested'
-- OUT column names are prefixed out_* so they never collide with the same-named table
-- columns (seq/row_hash/prev_hash) referenced in the INSERT below — avoids plpgsql's
-- column-vs-variable ambiguity.
) RETURNS TABLE (out_seq int, out_row_hash text, out_prev_hash text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp  -- digest() (pgcrypto) lives in the extensions schema on Supabase
AS $$
DECLARE
  v_lock_key   bigint;
  v_prev_seq   int;
  v_prev_hash  text;
  v_count      int;
  v_new_seq    int;
  v_new_hash   text;
  -- Bounds chain growth per submission (SYSTEM_DESIGN §2b). The 200-rows/call slice in
  -- the route has no per-submission total; this is the missing total cap.
  c_max_events constant int := 500;
BEGIN
  IF p_submission_id IS NULL THEN
    RAISE EXCEPTION 'append_integrity_event: submission_id required';
  END IF;
  IF coalesce(p_source, '') NOT IN ('client_attested', 'server_observed') THEN
    RAISE EXCEPTION 'append_integrity_event: invalid source %', p_source;
  END IF;

  -- (1) Per-submission transaction-scoped advisory lock. Derived from the uuid so the
  -- lock space is the submission, not the whole table — concurrent appends to DIFFERENT
  -- submissions never contend. Released automatically at COMMIT/ROLLBACK.
  -- hashtextextended is the purpose-built text->bigint hash (stable, no fragile bit casts).
  v_lock_key := hashtextextended(p_submission_id::text, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- (2) Read the head UNDER the lock. FOR UPDATE on the head row is redundant with the
  -- advisory lock but makes the "read-then-insert is now serialized" intent explicit and
  -- guards against a missed lock. (FOR UPDATE cannot coexist with a window function, so the
  -- per-submission total is counted separately below.)
  SELECT e.seq, e.row_hash
    INTO v_prev_seq, v_prev_hash
  FROM submission_integrity_events e
  WHERE e.submission_id = p_submission_id
  ORDER BY e.seq DESC
  LIMIT 1
  FOR UPDATE;

  -- total cap (count of existing rows for this submission)
  SELECT count(*) INTO v_count
  FROM submission_integrity_events
  WHERE submission_id = p_submission_id;

  IF v_count >= c_max_events THEN
    RAISE EXCEPTION 'append_integrity_event: chain cap reached (% events) for submission %',
      c_max_events, p_submission_id
      USING ERRCODE = 'check_violation';
  END IF;

  v_new_seq  := coalesce(v_prev_seq, 0) + 1;
  -- genesis must match integrity.js genesis(): sha256('genesis:' || submission_id)
  v_prev_hash := coalesce(
    v_prev_hash,
    encode(digest('genesis:' || p_submission_id::text, 'sha256'), 'hex')
  );

  v_new_hash := public.integrity_row_hash(
    v_prev_hash, v_new_seq, p_type, p_category, coalesce(p_meta, '{}'::jsonb), p_client_ts
  );

  -- (3) Atomic insert. UNIQUE(submission_id, seq) is the loud failure if a fork ever
  -- races past the lock.
  INSERT INTO submission_integrity_events
    (submission_id, seq, type, category, meta, client_ts, server_ts, ts,
     prev_hash, row_hash, source)
  VALUES
    (p_submission_id, v_new_seq,
     left(coalesce(p_type, 'unknown'), 40),
     CASE WHEN p_category IS NULL THEN NULL ELSE left(p_category, 24) END,
     coalesce(p_meta, '{}'::jsonb),
     p_client_ts,
     now(), now(),
     v_prev_hash, v_new_hash, p_source);

  out_seq := v_new_seq;
  out_row_hash := v_new_hash;
  out_prev_hash := v_prev_hash;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.append_integrity_event(uuid,text,text,jsonb,text,text) IS
  'SECURITY DEFINER atomic chain extender for submission_integrity_events: advisory lock + head-read-under-lock + UNIQUE(submission_id,seq) + per-submission cap. The ONLY supported chain-write path. service-role/authenticated only.';

-- Grants: revoke the default PUBLIC EXECUTE, then grant only to the roles that the app
-- uses. authenticated calls it via req.user.supabase.rpc(...) (RLS-scoped session, but
-- the fn body runs as definer for chain authority); service_role for server paths.
REVOKE EXECUTE ON FUNCTION public.append_integrity_event(uuid,text,text,jsonb,text,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.append_integrity_event(uuid,text,text,jsonb,text,text) TO authenticated, service_role;

-- integrity_row_hash is a pure helper; keep it off the public REST surface too.
REVOKE EXECUTE ON FUNCTION public.integrity_row_hash(text,int,text,text,jsonb,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.integrity_row_hash(text,int,text,text,jsonb,text) TO authenticated, service_role;

SELECT 'append_integrity_event (atomic chain extension) ready' AS status;
