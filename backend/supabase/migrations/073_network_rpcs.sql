-- 073_network_rpcs.sql — redacted read paths for the Candidate Network (071/072).
-- ----------------------------------------------------------------------------------------
-- Two SECURITY DEFINER reads. Per the CC3 security baseline (the 062 lesson, applied STRICTER
-- than get_passport/get_credential): a public read RPC is SECURITY DEFINER with SET
-- search_path AND has EXECUTE REVOKED from PUBLIC, anon AND authenticated — granted ONLY to
-- service_role. The backend's PUBLIC route proxies the call via its service-role client, so
-- the function is NEVER directly reachable from a raw anon/authenticated PostgREST call.
--
--   • get_req(token)             — the redacted req context for the candidate-facing
--                                  /apply/:token page. DATA only (title/role/company/is_open);
--                                  NO owner id, NO PII.
--   • get_req_applications(req)  — the employer's inbox for ONE req: each application + the
--                                  candidate's verified-credential SUMMARY (live score/
--                                  direction/token/digest + accepted count) and the
--                                  candidate's PUBLIC passport handle (if any). The req owner
--                                  cannot read verified_credentials (RLS-locked to the
--                                  candidate), so this definer read joins it for them — but
--                                  the route gates req-ownership FIRST (RLS read of
--                                  network_reqs), then passes the gated req id here. No email /
--                                  no PII is surfaced — only the candidate-chosen public handle.
--
-- NOT applied by this file — the founder/integrator applies migrations manually.

-- ── get_req(token): redacted public req context (service-role only; backend-proxied) ──
CREATE OR REPLACE FUNCTION public.get_req(p_token text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'title',         r.title,
    'role_family',   r.role_family,
    'company_label', r.company_label,
    'is_open',       r.is_open,
    'created_at',    r.created_at
  )
  FROM network_reqs r
  WHERE r.public_token = p_token;
$$;
REVOKE EXECUTE ON FUNCTION public.get_req(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_req(text) TO service_role;

-- ── get_req_applications(req_id): the employer inbox for one gated req (service-role only) ──
-- The route MUST verify req-ownership under RLS before calling this (the tenant gate); this
-- function does not re-check ownership (it is service-role only and unreachable otherwise).
CREATE OR REPLACE FUNCTION public.get_req_applications(p_req_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',              a.id,
        'status',          a.status,
        'note',            a.note,
        'created_at',      a.created_at,
        'accepted_at',     a.accepted_at,
        'token',           vc.public_token,
        'score',           vc.score,
        'direction_score', vc.direction_score,
        'digest_hash',     vc.digest_hash,
        'issued_at',       vc.issued_at,
        'revoked',         (vc.revoked_at IS NOT NULL),
        'proof_of_human',  pe.proof_of_human,   -- the REAL snapshot (server-computed at passport add-time); null if not on a passport
        'candidate_handle', pp.handle,
        'accepted_count', (
          SELECT COUNT(DISTINCT ca.accepting_account_id)
          FROM credential_acceptances ca WHERE ca.credential_id = vc.id
        )
      )
      ORDER BY a.created_at DESC
    )
    FROM credential_applications a
    JOIN verified_credentials vc ON vc.id = a.credential_id
    LEFT JOIN passports pp ON pp.candidate_id = a.candidate_id AND pp.is_public = TRUE
    -- The proof-of-human snapshot lives on the passport entry (server-authoritative, 061). The
    -- join is constrained to an entry on the APPLICANT'S OWN passport — mirroring the 060
    -- defense-in-depth on get_passport — so a residual/forged passport_entries row pointing at
    -- this credential from another account can never (a) surface a foreign proof_of_human or
    -- (b) fan-out the application into duplicate rows. One passport per candidate (056 UNIQUE) +
    -- UNIQUE(passport,credential) (057) ⇒ at most one matching pe row.
    LEFT JOIN passport_entries pe
      ON pe.credential_id = a.credential_id
      AND pe.passport_id IN (SELECT id FROM passports WHERE candidate_id = a.candidate_id)
    WHERE a.req_id = p_req_id
  ), '[]'::jsonb);
$$;
REVOKE EXECUTE ON FUNCTION public.get_req_applications(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_req_applications(uuid) TO service_role;

SELECT 'network rpcs ready (get_req, get_req_applications — service-role only)' AS status;
