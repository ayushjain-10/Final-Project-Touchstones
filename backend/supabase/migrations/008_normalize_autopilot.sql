-- ============================================
-- Phase 6C: Normalize Autopilot JSONB to Flat Columns
-- ============================================
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- Adds flat columns to candidate_submissions and creates workflow_logs table.
-- The autopilot JSONB column is KEPT during transition.

-- ============================================
-- 1. ADD FLAT COLUMNS TO candidate_submissions
-- ============================================
ALTER TABLE candidate_submissions
  ADD COLUMN IF NOT EXISTS autopilot_triggered BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS autopilot_triggered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS autopilot_best_match_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS autopilot_best_match_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS autopilot_action_taken TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS autopilot_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS autopilot_email_message_id TEXT;

-- Add check constraint on match score
ALTER TABLE candidate_submissions
  ADD CONSTRAINT chk_autopilot_match_score
  CHECK (autopilot_best_match_score >= 0 AND autopilot_best_match_score <= 100);

-- ============================================
-- 2. CREATE WORKFLOW LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS submission_workflow_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id UUID NOT NULL REFERENCES candidate_submissions(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_logs_submission
  ON submission_workflow_logs(submission_id, logged_at DESC);

-- ============================================
-- 3. MIGRATE DATA FROM JSONB TO FLAT COLUMNS
-- ============================================
UPDATE candidate_submissions
SET
  autopilot_triggered = COALESCE((autopilot->>'triggered')::boolean, FALSE),
  autopilot_triggered_at = (autopilot->>'triggered_at')::timestamptz,
  autopilot_best_match_job_id = CASE
    WHEN autopilot->>'best_match_job_id' IS NOT NULL
     AND autopilot->>'best_match_job_id' ~ '^[0-9a-f]{8}-'
    THEN (autopilot->>'best_match_job_id')::uuid
    ELSE NULL
  END,
  autopilot_best_match_score = LEAST(COALESCE((autopilot->>'best_match_score')::int, 0), 100),
  autopilot_action_taken = COALESCE(autopilot->>'action_taken', 'none'),
  autopilot_email_sent_at = (autopilot->>'email_sent_at')::timestamptz,
  autopilot_email_message_id = autopilot->>'email_message_id'
WHERE autopilot IS NOT NULL
  AND autopilot != '{}'::jsonb;

-- Migrate workflow_log arrays into the new table
INSERT INTO submission_workflow_logs (submission_id, action, details, logged_at)
SELECT
  cs.id,
  elem->>'action',
  COALESCE(elem->'details', '{}'::jsonb),
  COALESCE((elem->>'timestamp')::timestamptz, cs.updated_at)
FROM candidate_submissions cs,
  jsonb_array_elements(cs.autopilot->'workflow_log') AS elem
WHERE cs.autopilot IS NOT NULL
  AND cs.autopilot->'workflow_log' IS NOT NULL
  AND jsonb_typeof(cs.autopilot->'workflow_log') = 'array'
  AND jsonb_array_length(cs.autopilot->'workflow_log') > 0;

-- ============================================
-- 4. ADD INDEXES FOR COMMON QUERIES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_cs_autopilot_triggered
  ON candidate_submissions(autopilot_triggered) WHERE autopilot_triggered = TRUE;

CREATE INDEX IF NOT EXISTS idx_cs_autopilot_action
  ON candidate_submissions(autopilot_action_taken)
  WHERE autopilot_action_taken != 'none';

CREATE INDEX IF NOT EXISTS idx_cs_autopilot_score
  ON candidate_submissions(autopilot_best_match_score DESC)
  WHERE autopilot_best_match_score > 0;

CREATE INDEX IF NOT EXISTS idx_cs_autopilot_job
  ON candidate_submissions(autopilot_best_match_job_id)
  WHERE autopilot_best_match_job_id IS NOT NULL;

-- ============================================
-- 5. RLS POLICIES FOR WORKFLOW LOGS
-- ============================================
ALTER TABLE submission_workflow_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view workflow logs of own submissions" ON submission_workflow_logs;
CREATE POLICY "Users can view workflow logs of own submissions"
  ON submission_workflow_logs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM candidate_submissions cs
    WHERE cs.id = submission_workflow_logs.submission_id
    AND cs.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "System can insert workflow logs" ON submission_workflow_logs;
CREATE POLICY "System can insert workflow logs"
  ON submission_workflow_logs FOR INSERT
  WITH CHECK (TRUE);

-- ============================================
-- VERIFICATION QUERIES (run after migration)
-- ============================================
-- SELECT 'autopilot_migrated' as check,
--   COUNT(*) FILTER (WHERE autopilot_triggered) as flat_triggered,
--   COUNT(*) FILTER (WHERE (autopilot->>'triggered')::boolean = true) as jsonb_triggered
-- FROM candidate_submissions;
-- SELECT 'workflow_logs_migrated' as check, COUNT(*) FROM submission_workflow_logs;

SELECT 'Phase 6C: Autopilot normalization ready!' as status;
