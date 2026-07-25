-- ============================================
-- Phase 6B: Normalize shared_with UUID[] to Junction Table
-- ============================================
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- Creates submission_shares junction table and migrates data from shared_with array.
-- The shared_with column is KEPT during dual-write transition.

-- ============================================
-- 1. CREATE JUNCTION TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS submission_shares (
  submission_id UUID NOT NULL REFERENCES candidate_submissions(id) ON DELETE CASCADE,
  shared_with_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  shared_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  shared_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (submission_id, shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS idx_submission_shares_user
  ON submission_shares(shared_with_user_id, shared_at DESC);

CREATE INDEX IF NOT EXISTS idx_submission_shares_submission
  ON submission_shares(submission_id);

-- ============================================
-- 2. MIGRATE DATA FROM shared_with UUID[]
-- ============================================
INSERT INTO submission_shares (submission_id, shared_with_user_id, shared_by, shared_at)
SELECT
  cs.id,
  unnested_user,
  cs.user_id,  -- assume owner did the sharing
  cs.updated_at  -- best available timestamp
FROM candidate_submissions cs,
  unnest(cs.shared_with) AS unnested_user
WHERE cs.shared_with IS NOT NULL
  AND array_length(cs.shared_with, 1) > 0
  AND NOT EXISTS (
    SELECT 1 FROM submission_shares ss
    WHERE ss.submission_id = cs.id
    AND ss.shared_with_user_id = unnested_user
  );

-- ============================================
-- 3. RLS POLICIES
-- ============================================
ALTER TABLE submission_shares ENABLE ROW LEVEL SECURITY;

-- Users can see shares for submissions they own or are shared with
DROP POLICY IF EXISTS "Users can view shares on accessible submissions" ON submission_shares;
CREATE POLICY "Users can view shares on accessible submissions"
  ON submission_shares FOR SELECT
  USING (
    shared_with_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM candidate_submissions cs
      WHERE cs.id = submission_shares.submission_id
      AND cs.user_id = auth.uid()
    )
  );

-- Only owner can insert shares
DROP POLICY IF EXISTS "Submission owners can share" ON submission_shares;
CREATE POLICY "Submission owners can share"
  ON submission_shares FOR INSERT
  WITH CHECK (
    shared_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM candidate_submissions cs
      WHERE cs.id = submission_shares.submission_id
      AND (cs.user_id = auth.uid() OR auth.uid() = ANY(cs.shared_with))
    )
  );

-- Only owner can remove shares
DROP POLICY IF EXISTS "Submission owners can unshare" ON submission_shares;
CREATE POLICY "Submission owners can unshare"
  ON submission_shares FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM candidate_submissions cs
      WHERE cs.id = submission_shares.submission_id
      AND cs.user_id = auth.uid()
    )
  );

-- ============================================
-- VERIFICATION QUERIES (run after migration)
-- ============================================
-- SELECT 'shares_migrated' as check, COUNT(*) FROM submission_shares;
-- SELECT 'shared_with_total' as check, SUM(array_length(shared_with, 1))
--   FROM candidate_submissions WHERE shared_with IS NOT NULL AND array_length(shared_with, 1) > 0;

SELECT 'Phase 6B: Shared-with normalization ready!' as status;
