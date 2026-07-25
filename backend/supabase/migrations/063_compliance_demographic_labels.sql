-- 063_compliance_demographic_labels.sql — CC1 Compliance & Adverse-Impact.
-- ============================================================================================
-- THE MOST SENSITIVE TABLE IN THE PRODUCT. Protected-class group labels for the EEOC four-fifths
-- adverse-impact analysis. Touchstones NEVER collects or infers protected attributes — these are
-- EMPLOYER-PROVIDED, strictly OPT-IN, and stored here, segregated from scoring and from every
-- candidate-facing surface. They are never read by anything except the owning account's own
-- compliance analysis.
--
-- SECURITY (v3 baseline #1 + #5 — "lock it hardest"):
--   * RLS is the real boundary: owner-only (account_id = auth.uid()) for SELECT/INSERT/UPDATE/DELETE.
--   * NO anon access at all (RLS + an explicit REVOKE on the anon role, defense-in-depth).
--   * No SECURITY DEFINER read path, no public token, never joined into a candidate-visible query.
--   * account_id is the owning employer (the work_sample owner); the route additionally verifies
--     the referenced submission belongs to that account before inserting.
--
-- NOT applied by this file — the founder/Management API applies migrations.

CREATE TABLE IF NOT EXISTS public.compliance_demographic_labels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,             -- owning employer (auth.uid())
  submission_id UUID NOT NULL REFERENCES public.work_sample_submissions(id) ON DELETE CASCADE, -- the decision the label attaches to
  attribute     TEXT NOT NULL CHECK (char_length(attribute) BETWEEN 1 AND 60),  -- e.g. 'race_ethnicity' | 'sex' | 'age_band'
  value         TEXT NOT NULL CHECK (char_length(value) BETWEEN 1 AND 120),     -- the group label (employer's own taxonomy)
  source        TEXT NOT NULL DEFAULT 'employer_provided',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, submission_id, attribute)   -- one value per (employer, decision, attribute); upsert target
);

CREATE INDEX IF NOT EXISTS idx_cdl_account_attr ON public.compliance_demographic_labels (account_id, attribute);
CREATE INDEX IF NOT EXISTS idx_cdl_submission   ON public.compliance_demographic_labels (submission_id);

ALTER TABLE public.compliance_demographic_labels ENABLE ROW LEVEL SECURITY;

-- Owner-only, all operations. TO authenticated (never PUBLIC/anon).
DROP POLICY IF EXISTS cdl_owner_select ON public.compliance_demographic_labels;
CREATE POLICY cdl_owner_select ON public.compliance_demographic_labels
  FOR SELECT TO authenticated USING (account_id = auth.uid());
DROP POLICY IF EXISTS cdl_owner_insert ON public.compliance_demographic_labels;
CREATE POLICY cdl_owner_insert ON public.compliance_demographic_labels
  FOR INSERT TO authenticated WITH CHECK (account_id = auth.uid());
DROP POLICY IF EXISTS cdl_owner_update ON public.compliance_demographic_labels;
CREATE POLICY cdl_owner_update ON public.compliance_demographic_labels
  FOR UPDATE TO authenticated USING (account_id = auth.uid()) WITH CHECK (account_id = auth.uid());
DROP POLICY IF EXISTS cdl_owner_delete ON public.compliance_demographic_labels;
CREATE POLICY cdl_owner_delete ON public.compliance_demographic_labels
  FOR DELETE TO authenticated USING (account_id = auth.uid());

-- Defense-in-depth: the anon role must have NO table privilege whatsoever on this table.
REVOKE ALL ON public.compliance_demographic_labels FROM anon;

SELECT 'compliance_demographic_labels ready (owner-only RLS, no anon)' AS status;
