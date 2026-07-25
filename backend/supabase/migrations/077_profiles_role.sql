-- 077 — Role separation: candidate vs recruiter (the security boundary for the candidate portal).
--
-- THE GAP THIS CLOSES: proof.js had only `router.use(supabaseAuth)` (authentication, no
-- authorization) and profiles had no role concept, so any signup was effectively a full recruiter
-- (could author + send + score). This adds a secure-by-default role:
--   * account_type DEFAULT 'candidate' — every NEW signup is a candidate with no authoring power.
--   * Existing recruiters are BACKFILLED UP to verified recruiters in this same migration, BEFORE
--     the RLS WITH CHECK is tightened, so no current user is locked out (deploy-ordering safety).
-- Becoming a recruiter is invite/approval-only (workspace invite, or a founder-approved request:
--   recruiter_status none -> pending -> verified). This migration only seeds the columns + backfill;
--   the request/approval flow is wired in the app layer.
--
-- NOTE: a TYPE named `recruiter_status` already exists (001, candidate-pipeline enum) — unrelated.
-- We use a TEXT column of the same name (column vs type namespaces don't collide) with a CHECK.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'candidate'
    CHECK (account_type IN ('recruiter', 'candidate')),
  ADD COLUMN IF NOT EXISTS recruiter_status text NOT NULL DEFAULT 'none'
    CHECK (recruiter_status IN ('none', 'pending', 'verified', 'rejected')),
  ADD COLUMN IF NOT EXISTS recruiter_verified_at timestamptz;

-- Self-promotion guard, attempt 1 (INSUFFICIENT — see 079). profiles has a "Users can update own
-- profile" RLS policy with no column restriction, so a candidate could otherwise self-promote to
-- recruiter via direct PostgREST. NOTE: this column-level REVOKE is a NO-OP when authenticated holds
-- a table-level UPDATE grant (Postgres column-REVOKE can't subtract from a table grant), confirmed
-- by a direct-PostgREST attack test. The REAL guard is the BEFORE UPDATE trigger in migration 079.
-- Left here (harmless) as defense-in-depth in case the table grant is ever tightened.
REVOKE UPDATE (account_type, recruiter_status, recruiter_verified_at) ON public.profiles FROM authenticated;

-- Backfill (recruiter-first, runs while the OLD code is still serving — additive, breaks nothing):
-- anyone who owns a work_sample, or is a workspace owner/member, is a verified recruiter.
UPDATE public.profiles p SET
  account_type = 'recruiter',
  recruiter_status = 'verified',
  recruiter_verified_at = COALESCE(p.recruiter_verified_at, now())
WHERE EXISTS (SELECT 1 FROM public.work_samples w WHERE w.owner_id = p.id)
   OR EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.member_id = p.id OR m.owner_id = p.id);

-- Defense-in-depth: the founder + demo accounts stay verified recruiters regardless of activity.
UPDATE public.profiles SET
  account_type = 'recruiter',
  recruiter_status = 'verified',
  recruiter_verified_at = COALESCE(recruiter_verified_at, now())
WHERE email IN ('ayushshreeshreemal@gmail.com', 'demo@touchstones.ai');

-- The single authorization predicate. No-arg (uses auth.uid()) so a direct RPC call can only ever
-- reveal the CALLER's own status. SECURITY DEFINER + locked search_path (the 062 lesson). Granted to
-- authenticated because it is referenced inside RLS policies (evaluated as the querying role).
CREATE OR REPLACE FUNCTION public.is_verified_recruiter()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND account_type = 'recruiter'
      AND recruiter_status = 'verified'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_verified_recruiter() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_verified_recruiter() TO authenticated, service_role;

-- DB-LEVEL BACKSTOP (proves it via direct PostgREST, not just the UI): a candidate's own token can
-- never INSERT/UPDATE a work_sample. service_role BYPASSES RLS, so backend AI-gen / admin paths are
-- unaffected; only the candidate's token-scoped client is gated. Existing recruiters were backfilled
-- to verified ABOVE, so their inserts continue to pass. USING (read/own-rows) is left unchanged.
ALTER POLICY ws_owner_all ON public.work_samples
  WITH CHECK (owner_id = auth.uid() AND public.is_verified_recruiter());
