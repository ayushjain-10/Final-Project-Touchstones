-- ============================================
-- Phase 6D: Cleanup - Drop JSONB Columns
-- ============================================
-- WARNING: Only run this AFTER 1-2 weeks of verification that all
-- normalized tables + flat columns are working correctly.
-- TAKE A FULL BACKUP BEFORE RUNNING THIS MIGRATION.

-- ============================================
-- 1. DROP JSONB COLUMNS FROM candidate_submissions
-- ============================================

-- Comments are now in the 'comments' table
ALTER TABLE candidate_submissions DROP COLUMN IF EXISTS comments;

-- Pipeline history is now in 'submission_pipeline_history' table
ALTER TABLE candidate_submissions DROP COLUMN IF EXISTS pipeline_history;

-- Pipeline notes are now in 'submission_pipeline_notes' table
ALTER TABLE candidate_submissions DROP COLUMN IF EXISTS pipeline_notes;

-- Autopilot data is now in flat columns (autopilot_triggered, autopilot_triggered_at, etc.)
ALTER TABLE candidate_submissions DROP COLUMN IF EXISTS autopilot;

-- shared_with is now in 'submission_shares' junction table
-- NOTE: Only drop this after updating ALL access checks in comments.js and talent.js
-- to use the junction table instead of the shared_with array.
-- ALTER TABLE candidate_submissions DROP COLUMN IF EXISTS shared_with;

-- ============================================
-- 2. UPDATE RLS POLICIES (if shared_with column dropped)
-- ============================================
-- When ready to drop shared_with, update these RLS policies to use submission_shares:
--
-- DROP POLICY IF EXISTS "Users can view comments on accessible submissions" ON comments;
-- CREATE POLICY "Users can view comments on accessible submissions"
--   ON comments FOR SELECT
--   USING (EXISTS (
--     SELECT 1 FROM candidate_submissions cs
--     WHERE cs.id = comments.candidate_id
--     AND (cs.user_id = auth.uid() OR EXISTS (
--       SELECT 1 FROM submission_shares ss
--       WHERE ss.submission_id = cs.id AND ss.shared_with_user_id = auth.uid()
--     ))
--   ));

-- ============================================
-- VERIFICATION
-- ============================================
SELECT 'Phase 6D: JSONB cleanup complete!' as status;
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'candidate_submissions'
ORDER BY ordinal_position;
