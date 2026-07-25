-- 071_network_reqs.sql — Candidate Network / "Apply with Touchstones" (CC3/v3).
-- ----------------------------------------------------------------------------------------
-- An employer-owned OPEN REQ that a candidate can apply to by REUSING an existing verified
-- credential instead of re-screening. v2 built the recruiter-initiated *accept-prior*
-- (credentials.js → credential_acceptances); this is the candidate-initiated side. The req
-- carries only employer-chosen PUBLIC display fields (title / role_family / company_label) +
-- a visibility switch; it is addressed by an opaque public_token (same shape as
-- verified_credentials.public_token, 029). Nothing here is PII — the public read path is the
-- SECURITY DEFINER get_req() RPC (073, service-role only, backend-proxied), never a broad
-- policy.
--
-- RLS mirrors 056 (passports): the OWNER (auth.uid()) fully controls their own reqs; there
-- is NO anon/cross-account row visibility. The candidate-facing /apply/:token page never
-- reads this table directly — it is served exclusively by the redacted get_req() RPC.
--
-- NOT applied by this file — the founder/integrator applies migrations manually (the
-- grant-bearing parts 072/073 are deploy-ordering sensitive: apply AFTER the code ships).

CREATE TABLE IF NOT EXISTS public.network_reqs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  public_token  TEXT UNIQUE NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  title         TEXT NOT NULL,           -- role title (public, employer-chosen — NOT PII)
  role_family   TEXT,                    -- optional role family (public)
  company_label TEXT,                    -- optional public team/company label (employer-chosen — NOT PII)
  is_open       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_network_reqs_owner
  ON public.network_reqs (owner_id, created_at DESC);

ALTER TABLE public.network_reqs ENABLE ROW LEVEL SECURITY;

-- Owner (the employer account) — full control over their own reqs. No anon visibility:
-- the public candidate-facing read is exclusively the get_req() RPC (073).
DROP POLICY IF EXISTS req_owner_select ON public.network_reqs;
CREATE POLICY req_owner_select ON public.network_reqs
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
DROP POLICY IF EXISTS req_owner_insert ON public.network_reqs;
CREATE POLICY req_owner_insert ON public.network_reqs
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS req_owner_update ON public.network_reqs;
CREATE POLICY req_owner_update ON public.network_reqs
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS req_owner_delete ON public.network_reqs;
CREATE POLICY req_owner_delete ON public.network_reqs
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

SELECT 'network_reqs ready' AS status;
