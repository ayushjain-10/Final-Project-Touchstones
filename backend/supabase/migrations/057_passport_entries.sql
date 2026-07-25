-- 057_passport_entries.sql — the verified results on a candidate's Passport (056).
-- Each entry links the passport to an already-issued verified_credential (the
-- public-safe, tamper-evident unit from 029) and snapshots the candidate-opted
-- display fields at add-time (title/role/proof-of-human/percentile) so the public
-- read is a single redacted query and the entry reads as a point-in-time
-- attestation. `is_visible` is the per-result public switch; the live score +
-- token are still read from the (non-revoked) credential at read time, so a later
-- revoke immediately hides the result everywhere.
--
-- RLS: the passport owner (candidate) controls their entries, gated through
-- passports.candidate_id. Public visibility is exclusively via get_passport()
-- (059) — there is no anon policy here.
--
-- NOT applied by this file — the founder applies migrations manually.

CREATE TABLE IF NOT EXISTS public.passport_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id     UUID NOT NULL REFERENCES public.passports(id) ON DELETE CASCADE,
  credential_id   UUID NOT NULL REFERENCES public.verified_credentials(id) ON DELETE CASCADE,
  submission_id   UUID REFERENCES public.work_sample_submissions(id) ON DELETE SET NULL,
  title           TEXT,            -- snapshot: work_samples.title (screen name, not PII)
  role_family     TEXT,            -- snapshot: work_samples.role_family
  proof_of_human  TEXT,            -- snapshot: 'verified' | 'review' | 'flagged'
  percentile      INT,             -- nullable: score-relative percentile (0-100) when computable
  is_visible      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (passport_id, credential_id)             -- a credential appears at most once per passport
);

CREATE INDEX IF NOT EXISTS idx_passport_entries_passport
  ON public.passport_entries (passport_id, sort_order);

ALTER TABLE public.passport_entries ENABLE ROW LEVEL SECURITY;

-- Owner (the candidate, via their passport) controls their own entries.
DROP POLICY IF EXISTS passport_entry_owner_select ON public.passport_entries;
CREATE POLICY passport_entry_owner_select ON public.passport_entries
  FOR SELECT TO authenticated
  USING (passport_id IN (SELECT id FROM public.passports WHERE candidate_id = auth.uid()));
DROP POLICY IF EXISTS passport_entry_owner_insert ON public.passport_entries;
CREATE POLICY passport_entry_owner_insert ON public.passport_entries
  FOR INSERT TO authenticated
  WITH CHECK (passport_id IN (SELECT id FROM public.passports WHERE candidate_id = auth.uid()));
DROP POLICY IF EXISTS passport_entry_owner_update ON public.passport_entries;
CREATE POLICY passport_entry_owner_update ON public.passport_entries
  FOR UPDATE TO authenticated
  USING (passport_id IN (SELECT id FROM public.passports WHERE candidate_id = auth.uid()))
  WITH CHECK (passport_id IN (SELECT id FROM public.passports WHERE candidate_id = auth.uid()));
DROP POLICY IF EXISTS passport_entry_owner_delete ON public.passport_entries;
CREATE POLICY passport_entry_owner_delete ON public.passport_entries
  FOR DELETE TO authenticated
  USING (passport_id IN (SELECT id FROM public.passports WHERE candidate_id = auth.uid()));
