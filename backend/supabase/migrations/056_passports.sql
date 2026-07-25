-- 056_passports.sql — Touchstones Passport (S4): a candidate-owned, portable
-- proof-of-capability profile. ONE passport per candidate (profiles.id), addressed
-- by a public `handle`. The passport itself carries only candidate-controlled
-- display fields (display_name, headline) + a visibility switch; the verified
-- RESULTS live in passport_entries (057), each linked to an already-issued,
-- public-safe verified_credential. Nothing here exposes PII — the public read
-- path is the SECURITY DEFINER get_passport() RPC (059), never a broad policy.
--
-- RLS mirrors 037/039/040: the candidate (auth.uid()) fully controls their own
-- passport; there is NO anon/cross-account row visibility (public access is
-- exclusively via the redacted RPC).
--
-- NOT applied by this file — the founder applies migrations manually.

CREATE TABLE IF NOT EXISTS public.passports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  handle        TEXT NOT NULL UNIQUE
                  CHECK (handle ~ '^[a-z0-9](-?[a-z0-9]){2,31}$'),   -- lower slug, 3-32, no leading/trailing/double hyphen
  display_name  TEXT,
  headline      TEXT,
  is_public     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Handles are stored lower-cased + matched case-insensitively; a unique index on
-- lower(handle) is a hard guarantee even if a caller bypasses app normalization.
CREATE UNIQUE INDEX IF NOT EXISTS uq_passports_handle_lower ON public.passports (lower(handle));

ALTER TABLE public.passports ENABLE ROW LEVEL SECURITY;

-- Owner (the candidate) — full control over their own passport row. No anon
-- visibility: the public read is exclusively the get_passport() RPC (059).
DROP POLICY IF EXISTS passport_owner_select ON public.passports;
CREATE POLICY passport_owner_select ON public.passports
  FOR SELECT TO authenticated USING (candidate_id = auth.uid());
DROP POLICY IF EXISTS passport_owner_insert ON public.passports;
CREATE POLICY passport_owner_insert ON public.passports
  FOR INSERT TO authenticated WITH CHECK (candidate_id = auth.uid());
DROP POLICY IF EXISTS passport_owner_update ON public.passports;
CREATE POLICY passport_owner_update ON public.passports
  FOR UPDATE TO authenticated USING (candidate_id = auth.uid()) WITH CHECK (candidate_id = auth.uid());
DROP POLICY IF EXISTS passport_owner_delete ON public.passports;
CREATE POLICY passport_owner_delete ON public.passports
  FOR DELETE TO authenticated USING (candidate_id = auth.uid());
