-- 029_outcome_credential_variants.sql — schema foundations for the compounding moat
-- features (the API/UI for these is built incrementally; the tables + RLS land first).
--   • outcome-labeled dataset flywheel  (the real moat — data nobody else collects)
--   • portable "Touchstones-verified" credential  (post-PMF network effect)
--   • adaptive task variants per candidate  (nothing is shareable)

-- ── Outcome labels: did-they-get-the-offer / stayed-90-days → feeds calibration ──
CREATE TABLE IF NOT EXISTS submission_outcomes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES work_sample_submissions(id) ON DELETE CASCADE,
  advanced      BOOLEAN,
  got_offer     BOOLEAN,
  hired         BOOLEAN,
  retained_90d  BOOLEAN,
  notes         TEXT,
  labeled_by    UUID,
  labeled_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (submission_id)
);
ALTER TABLE submission_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outcomes_owner ON submission_outcomes;
CREATE POLICY outcomes_owner ON submission_outcomes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM work_sample_submissions s JOIN work_samples w ON w.id = s.work_sample_id
                 WHERE s.id = submission_id AND w.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM work_sample_submissions s JOIN work_samples w ON w.id = s.work_sample_id
                      WHERE s.id = submission_id AND w.owner_id = auth.uid()));

-- ── Portable, explainable "Touchstones-verified" credential ──
CREATE TABLE IF NOT EXISTS verified_credentials (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  UUID NOT NULL REFERENCES work_sample_submissions(id) ON DELETE CASCADE,
  candidate_id   UUID,
  public_token   TEXT UNIQUE NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  score          INT,
  direction_score INT,
  digest_hash    TEXT,
  issued_at      TIMESTAMPTZ DEFAULT NOW(),
  revoked_at     TIMESTAMPTZ
);
ALTER TABLE verified_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cred_candidate ON verified_credentials;
CREATE POLICY cred_candidate ON verified_credentials FOR ALL TO authenticated
  USING (candidate_id = auth.uid()) WITH CHECK (candidate_id = auth.uid());

-- Public verification is by single token only (no broad read policy) — anyone holding a
-- credential link can verify it, but cannot enumerate the table.
CREATE OR REPLACE FUNCTION public.get_credential(p_token text)
RETURNS TABLE(score int, direction_score int, issued_at timestamptz, revoked_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT score, direction_score, issued_at, revoked_at
  FROM verified_credentials WHERE public_token = p_token AND revoked_at IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.get_credential(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_credential(text) TO anon, authenticated;

-- ── Adaptive task variants (anti-share): per-candidate parameterized task ──
CREATE TABLE IF NOT EXISTS work_sample_variants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_sample_id UUID NOT NULL REFERENCES work_samples(id) ON DELETE CASCADE,
  submission_id  UUID REFERENCES work_sample_submissions(id) ON DELETE CASCADE,
  variant_seed   TEXT NOT NULL,
  params         JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE work_sample_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS variants_owner ON work_sample_variants;
CREATE POLICY variants_owner ON work_sample_variants FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM work_samples w WHERE w.id = work_sample_id AND w.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM work_samples w WHERE w.id = work_sample_id AND w.owner_id = auth.uid()));

SELECT 'outcome_credential_variants ready' AS status;
