-- 091 — CRITICAL: stop candidates forging their own verified-credential score.
-- Finding S-1 (codebase-scan 2026-07-02). The 029 policy `cred_candidate FOR ALL TO authenticated
-- USING/WITH CHECK (candidate_id = auth.uid())` let a candidate INSERT/UPDATE/DELETE their own
-- verified_credentials rows over PostgREST — e.g. PATCH {"score":100} — while keeping the real
-- digest_hash, so the public /verify page rendered a forged score as "Genuine, tamper-evident".
-- Credentials are MINTED by the service role (which bypasses RLS), so candidates only ever need to
-- READ their own row. This migration:
--   1. Replaces cred_candidate with a SELECT-only policy (candidates read their own credentials).
--   2. Adds a BELT-AND-SUSPENDERS guard trigger (079 idiom): any write attempted as the user-facing
--      roles (authenticated/anon) is rejected, so even a future mis-added policy cannot reopen the hole.
--      Service-role writes (minting/revocation from the backend) run as a different role and pass.
--
-- Reversible DOWN:
--   DROP TRIGGER IF EXISTS verified_credentials_guard_write ON public.verified_credentials;
--   DROP FUNCTION IF EXISTS public.guard_verified_credentials_write();
--   DROP POLICY IF EXISTS cred_candidate_select ON public.verified_credentials;
--   CREATE POLICY cred_candidate ON public.verified_credentials FOR ALL TO authenticated
--     USING (candidate_id = auth.uid()) WITH CHECK (candidate_id = auth.uid());  -- restores 029 (INSECURE)

DROP POLICY IF EXISTS cred_candidate ON public.verified_credentials;

CREATE POLICY cred_candidate_select ON public.verified_credentials
  FOR SELECT TO authenticated
  USING (candidate_id = auth.uid());

CREATE OR REPLACE FUNCTION public.guard_verified_credentials_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only constrain the user-facing PostgREST roles; the service role (backend minting) is unaffected.
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'verified_credentials is read-only for candidates; credentials are issued server-side';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS verified_credentials_guard_write ON public.verified_credentials;
CREATE TRIGGER verified_credentials_guard_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.verified_credentials
  FOR EACH ROW EXECUTE FUNCTION public.guard_verified_credentials_write();

COMMENT ON TABLE public.verified_credentials IS
  'Portable Touchstones-verified credential. Candidate RLS is SELECT-only; all writes are '
  'service-role (minting/revocation). A guard trigger rejects any authenticated/anon write '
  '(defense-in-depth vs S-1 credential-forgery). Score/digest are never candidate-writable.';
