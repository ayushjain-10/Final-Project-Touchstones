-- ============================================
-- Phase 6A: Normalize Comments + Pipeline History/Notes
-- ============================================
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- The comments table already exists (from 002_standalone_schema.sql)
-- This migration: (1) moves JSONB data into proper tables, (2) creates pipeline tables

-- ============================================
-- 1. MIGRATE COMMENTS FROM JSONB TO EXISTING TABLE
-- ============================================
-- The 'comments' table (id, candidate_id, user_id, content, created_at, updated_at)
-- already exists. Move data from candidate_submissions.comments JSONB array.

INSERT INTO comments (id, candidate_id, user_id, content, created_at)
SELECT
  (elem->>'id')::uuid,
  cs.id,
  (elem->>'created_by')::uuid,
  elem->>'content',
  COALESCE((elem->>'created_at')::timestamptz, cs.created_at)
FROM candidate_submissions cs,
  jsonb_array_elements(cs.comments) AS elem
WHERE cs.comments IS NOT NULL
  AND cs.comments != '[]'::jsonb
  AND jsonb_typeof(cs.comments) = 'array'
  AND jsonb_array_length(cs.comments) > 0
  AND NOT EXISTS (
    SELECT 1 FROM comments c WHERE c.id = (elem->>'id')::uuid
  );

-- ============================================
-- 2. CREATE PIPELINE HISTORY TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS submission_pipeline_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id UUID NOT NULL REFERENCES candidate_submissions(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  moved_at TIMESTAMPTZ DEFAULT NOW(),
  moved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_pipeline_history_submission
  ON submission_pipeline_history(submission_id, moved_at DESC);

-- Migrate existing JSONB pipeline_history data
INSERT INTO submission_pipeline_history (submission_id, from_stage, to_stage, moved_at, moved_by, note)
SELECT
  cs.id,
  elem->>'from_stage',
  COALESCE(elem->>'to_stage', 'new'),
  COALESCE((elem->>'moved_at')::timestamptz, cs.created_at),
  CASE
    WHEN elem->>'moved_by' IS NOT NULL AND elem->>'moved_by' ~ '^[0-9a-f]{8}-'
    THEN (elem->>'moved_by')::uuid
    ELSE NULL
  END,
  elem->>'note'
FROM candidate_submissions cs,
  jsonb_array_elements(cs.pipeline_history) AS elem
WHERE cs.pipeline_history IS NOT NULL
  AND cs.pipeline_history != '[]'::jsonb
  AND jsonb_typeof(cs.pipeline_history) = 'array'
  AND jsonb_array_length(cs.pipeline_history) > 0;

-- ============================================
-- 3. CREATE PIPELINE NOTES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS submission_pipeline_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id UUID NOT NULL REFERENCES candidate_submissions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_notes_submission
  ON submission_pipeline_notes(submission_id, created_at DESC);

-- Migrate existing JSONB pipeline_notes data
INSERT INTO submission_pipeline_notes (submission_id, content, created_by, created_at)
SELECT
  cs.id,
  elem->>'content',
  CASE
    WHEN elem->>'created_by' IS NOT NULL AND elem->>'created_by' ~ '^[0-9a-f]{8}-'
    THEN (elem->>'created_by')::uuid
    ELSE NULL
  END,
  COALESCE((elem->>'created_at')::timestamptz, cs.created_at)
FROM candidate_submissions cs,
  jsonb_array_elements(cs.pipeline_notes) AS elem
WHERE cs.pipeline_notes IS NOT NULL
  AND cs.pipeline_notes != '[]'::jsonb
  AND jsonb_typeof(cs.pipeline_notes) = 'array'
  AND jsonb_array_length(cs.pipeline_notes) > 0;

-- ============================================
-- 4. RLS POLICIES
-- ============================================
-- Comments table RLS (may already be enabled)
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view comments on accessible submissions" ON comments;
CREATE POLICY "Users can view comments on accessible submissions"
  ON comments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM candidate_submissions cs
    WHERE cs.id = comments.candidate_id
    AND (cs.user_id = auth.uid() OR auth.uid() = ANY(cs.shared_with))
  ));

DROP POLICY IF EXISTS "Users can insert comments on accessible submissions" ON comments;
CREATE POLICY "Users can insert comments on accessible submissions"
  ON comments FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM candidate_submissions cs
      WHERE cs.id = comments.candidate_id
      AND (cs.user_id = auth.uid() OR auth.uid() = ANY(cs.shared_with))
    )
  );

DROP POLICY IF EXISTS "Users can delete own comments" ON comments;
CREATE POLICY "Users can delete own comments"
  ON comments FOR DELETE
  USING (user_id = auth.uid());

-- Pipeline history RLS
ALTER TABLE submission_pipeline_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view pipeline history of accessible submissions"
  ON submission_pipeline_history FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM candidate_submissions cs
    WHERE cs.id = submission_pipeline_history.submission_id
    AND (cs.user_id = auth.uid() OR auth.uid() = ANY(cs.shared_with))
  ));

CREATE POLICY "Users can insert pipeline history"
  ON submission_pipeline_history FOR INSERT
  WITH CHECK (moved_by = auth.uid());

-- Pipeline notes RLS
ALTER TABLE submission_pipeline_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view notes on accessible submissions"
  ON submission_pipeline_notes FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM candidate_submissions cs
    WHERE cs.id = submission_pipeline_notes.submission_id
    AND (cs.user_id = auth.uid() OR auth.uid() = ANY(cs.shared_with))
  ));

CREATE POLICY "Users can insert notes"
  ON submission_pipeline_notes FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- ============================================
-- 5. ENABLE REALTIME (optional)
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE comments;

-- ============================================
-- VERIFICATION QUERIES (run after migration)
-- ============================================
-- SELECT 'comments_migrated' as check, COUNT(*) FROM comments;
-- SELECT 'pipeline_history_migrated' as check, COUNT(*) FROM submission_pipeline_history;
-- SELECT 'pipeline_notes_migrated' as check, COUNT(*) FROM submission_pipeline_notes;

SELECT 'Phase 6A: Comments + Pipeline normalization ready!' as status;
