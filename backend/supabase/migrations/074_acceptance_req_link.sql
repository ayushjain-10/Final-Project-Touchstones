-- 074_acceptance_req_link.sql — link an accept-prior acceptance to the network req it closed.
-- ----------------------------------------------------------------------------------------
-- "Extend acceptance/counters as needed" (CC3): when an employer accepts a candidate's
-- application (072) for one of their reqs (071), we record the acceptance through the SAME
-- accept-prior path as v2 (credential_acceptances, 058) — adding an optional req_id so the
-- acceptance is traceable to the network req. Purely ADDITIVE: a nullable column + an index.
-- The network counter ("accepted by N teams") is unchanged — still COUNT(DISTINCT
-- accepting_account_id) over a credential — so this does not alter existing semantics.
--
-- No grant changes: credential_acceptances rows are written ONLY by the backend via the
-- service-role client (credentials.js accept-prior + network.js application-accept), so the
-- authenticated role needs no new column privilege. The existing 058 RLS (the accepting
-- account sees its own acceptances) is unchanged.
--
-- NOT applied by this file — the founder/integrator applies migrations manually.

ALTER TABLE public.credential_acceptances
  ADD COLUMN IF NOT EXISTS req_id UUID REFERENCES public.network_reqs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cred_acceptances_req
  ON public.credential_acceptances (req_id);

-- ── HARDENING — close the self-acceptance counter-forgery (extends the counter integrity) ──
-- The original cred_acceptance_owner_insert (058) checked ONLY accepting_account_id = auth.uid(),
-- so a candidate could SELF-ACCEPT their own credential via a DIRECT PostgREST insert and inflate
-- the public "accepted by N teams" counter by one (their own account counting as a distinct team)
-- — forging the core network signal CC3 depends on. This STRENGTHENS (never weakens) the policy:
-- you still insert only AS yourself, but you may NOT accept your OWN credential.
--
-- Why it's safe + correct: the candidate_id subquery runs under the CALLER's RLS (verified_
-- credentials' only SELECT policy is cred_candidate, USING candidate_id = auth.uid()), so it
-- returns the credential's owner ONLY when the caller IS that owner — exactly the self-accept
-- case we block. For a legitimate accepter (who cannot read someone else's credential under RLS)
-- the subquery is blind → COALESCE to the zero-uuid → the inequality holds → insert allowed.
-- Both legit accept paths (credentials.js + network.js) write via the SERVICE-ROLE client, which
-- bypasses RLS entirely, so this governs ONLY direct authenticated PostgREST writes (the attack
-- surface). Idempotent. DEPLOY-ORDERING: tightens an existing policy — apply AFTER code ships.
DROP POLICY IF EXISTS cred_acceptance_owner_insert ON public.credential_acceptances;
CREATE POLICY cred_acceptance_owner_insert ON public.credential_acceptances
  FOR INSERT TO authenticated
  WITH CHECK (
    accepting_account_id = auth.uid()
    AND accepting_account_id <> COALESCE(
      (SELECT candidate_id FROM public.verified_credentials WHERE id = credential_id),
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  );

SELECT 'credential_acceptances.req_id link + self-acceptance guard ready' AS status;
