-- 058_credential_acceptances.sql — the accept-prior network (S4). A recruiter
-- (accepting_account) ACCEPTS an existing verified_credential for one of their
-- reqs instead of re-screening. Each acceptance is one row; the public network
-- counter ("accepted by N teams") is COUNT(DISTINCT accepting_account_id) over a
-- credential. This is the compounding-standard signal: every accepted credential
-- strengthens the network.
--
-- RLS: the accepting account sees + manages its OWN acceptances. The public
-- network COUNT is exposed only through the SECURITY DEFINER get_credential_full()
-- RPC (059) — never via a broad read. The route writes after a session check.
--
-- NOT applied by this file — the founder applies migrations manually.

CREATE TABLE IF NOT EXISTS public.credential_acceptances (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id         UUID NOT NULL REFERENCES public.verified_credentials(id) ON DELETE CASCADE,
  public_token          TEXT NOT NULL,                 -- denormalized for the public counter RPC / lookups
  accepting_account_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  req_label             TEXT,                          -- free-text req/role the recruiter attached it to
  work_sample_id        UUID REFERENCES public.work_samples(id) ON DELETE SET NULL,
  accepted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (credential_id, accepting_account_id)         -- one acceptance per team per credential (idempotent)
);

CREATE INDEX IF NOT EXISTS idx_cred_acceptances_token
  ON public.credential_acceptances (public_token);
CREATE INDEX IF NOT EXISTS idx_cred_acceptances_account
  ON public.credential_acceptances (accepting_account_id, accepted_at DESC);

ALTER TABLE public.credential_acceptances ENABLE ROW LEVEL SECURITY;

-- The accepting account sees + manages its own acceptances.
DROP POLICY IF EXISTS cred_acceptance_owner_select ON public.credential_acceptances;
CREATE POLICY cred_acceptance_owner_select ON public.credential_acceptances
  FOR SELECT TO authenticated USING (accepting_account_id = auth.uid());
DROP POLICY IF EXISTS cred_acceptance_owner_insert ON public.credential_acceptances;
CREATE POLICY cred_acceptance_owner_insert ON public.credential_acceptances
  FOR INSERT TO authenticated WITH CHECK (accepting_account_id = auth.uid());
DROP POLICY IF EXISTS cred_acceptance_owner_delete ON public.credential_acceptances;
CREATE POLICY cred_acceptance_owner_delete ON public.credential_acceptances
  FOR DELETE TO authenticated USING (accepting_account_id = auth.uid());
