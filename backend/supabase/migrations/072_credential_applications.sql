-- 072_credential_applications.sql — the candidate-initiated "Apply with Touchstones" record.
-- ----------------------------------------------------------------------------------------
-- A candidate attaches one of THEIR OWN verified credentials (029) to an employer's open req
-- (071) — reusing a screen they already passed instead of re-screening. The accepting account
-- (the req owner) sees applications to ITS reqs only and can accept via the existing
-- accept-prior path (credential_acceptances). This is the standard-making moat: every accepted
-- credential makes the next employer more likely to accept.
--
-- SECURITY — the v2 lessons, enforced at the RLS layer (PostgREST is exposed directly, so RLS
-- is the real boundary; an Express check is NOT enough):
--   • (the 060/S4-1 lesson) A candidate may apply ONLY with a credential they OWN, and only AS
--     themselves. The INSERT WITH CHECK requires candidate_id = auth.uid() AND credential_id ∈
--     the caller's own verified_credentials. credential_id IN (...) is evaluated under the
--     caller's RLS (cred_candidate, 029), so it returns the caller's own credentials only — a
--     candidate CANNOT attach a foreign credential, even via raw PostgREST. Both checks
--     fail-CLOSED on NULL (NULL = auth.uid() → false).
--   • (the 061/S4-1b lesson) The TRUST / lifecycle columns — status, accepted_at — are
--     SERVER-AUTHORITATIVE. status is the application state machine (only the gated, req-owner
--     accept route flips it to 'accepted'); accepted_at is stamped server-side. We strip the
--     table-level INSERT/UPDATE grant from `authenticated` and grant back ONLY the
--     candidate-ownable base columns; a direct PostgREST write that supplies status/accepted_at
--     is rejected. (The employer reads the candidate's credential token via the credential join
--     in get_req_applications, 073 — it is never denormalized onto this row.)
--
-- The accepting account's read is a separate, additive SELECT policy (req owner sees apps to
-- their reqs). No candidate PII is stored here; the optional `note` is a short candidate
-- cover line, surfaced only to the req owner (never on a public surface).
--
-- NOT applied by this file — the founder/integrator applies migrations manually (deploy
-- AFTER the route code: this strips grants, so an early apply would 4xx live inserts).

CREATE TABLE IF NOT EXISTS public.credential_applications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  req_id        UUID NOT NULL REFERENCES public.network_reqs(id) ON DELETE CASCADE,
  candidate_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  credential_id UUID NOT NULL REFERENCES public.verified_credentials(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('submitted','accepted','declined','withdrawn')),
  note          TEXT,                    -- optional short candidate cover line (req-owner-only; never public)
  accepted_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (req_id, credential_id)          -- one application per credential per req (idempotent re-apply)
);

CREATE INDEX IF NOT EXISTS idx_cred_apps_candidate
  ON public.credential_applications (candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cred_apps_req
  ON public.credential_applications (req_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cred_apps_credential
  ON public.credential_applications (credential_id);

ALTER TABLE public.credential_applications ENABLE ROW LEVEL SECURITY;

-- ── Candidate owns their own applications (read / withdraw) ──
DROP POLICY IF EXISTS app_candidate_select ON public.credential_applications;
CREATE POLICY app_candidate_select ON public.credential_applications
  FOR SELECT TO authenticated USING (candidate_id = auth.uid());

-- RLS-FIRST cross-candidate isolation (the 060 lesson): apply only AS yourself, only with a
-- credential you OWN. The credential_id subquery runs under the caller's RLS (cred_candidate),
-- so it can only ever match the caller's own credentials.
DROP POLICY IF EXISTS app_candidate_insert ON public.credential_applications;
CREATE POLICY app_candidate_insert ON public.credential_applications
  FOR INSERT TO authenticated
  WITH CHECK (
    candidate_id  = auth.uid()
    AND credential_id IN (SELECT id FROM public.verified_credentials WHERE candidate_id = auth.uid())
  );

-- Candidate may withdraw (delete) their own application.
DROP POLICY IF EXISTS app_candidate_delete ON public.credential_applications;
CREATE POLICY app_candidate_delete ON public.credential_applications
  FOR DELETE TO authenticated USING (candidate_id = auth.uid());

-- ── The accepting account (req owner) sees applications to ITS reqs only (read) ──
-- Additive SELECT policy (RLS SELECT policies are OR-ed): the req-owner gate is the network_reqs
-- ownership subquery, evaluated under the owner's RLS (req_owner_select, 071).
DROP POLICY IF EXISTS app_req_owner_select ON public.credential_applications;
CREATE POLICY app_req_owner_select ON public.credential_applications
  FOR SELECT TO authenticated
  USING (req_id IN (SELECT id FROM public.network_reqs WHERE owner_id = auth.uid()));

-- ── Server-authoritative columns (the 061 lesson) ──
-- Postgres ignores column-level grants when a table-level grant exists, so REVOKE the
-- table-level INSERT/UPDATE and GRANT back only the candidate-ownable base columns.
--   * authenticated may INSERT only: req_id, candidate_id, credential_id, note
--     (RLS app_candidate_insert still gates WHICH rows — credential + identity ownership).
--   * authenticated may NOT UPDATE at all — status/accepted_at transitions are service-role
--     only (the gated accept route). Candidates change state via DELETE (withdraw).
REVOKE INSERT ON public.credential_applications FROM authenticated;
GRANT  INSERT (req_id, candidate_id, credential_id, note)
  ON public.credential_applications TO authenticated;
REVOKE UPDATE ON public.credential_applications FROM authenticated;

SELECT 'credential_applications ready (RLS: candidate owns + credential-ownership; trust cols server-authoritative)' AS status;
