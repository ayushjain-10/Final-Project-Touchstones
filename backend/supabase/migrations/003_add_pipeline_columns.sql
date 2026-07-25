-- Add missing pipeline columns to candidate_submissions
-- Run this in Supabase SQL Editor

-- Add last_pipeline_activity column
ALTER TABLE candidate_submissions
ADD COLUMN IF NOT EXISTS last_pipeline_activity TIMESTAMPTZ;

-- Add best_match_job_id column
ALTER TABLE candidate_submissions
ADD COLUMN IF NOT EXISTS best_match_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;

-- Add pipeline_history JSONB array for audit logging
ALTER TABLE candidate_submissions
ADD COLUMN IF NOT EXISTS pipeline_history JSONB DEFAULT '[]';

-- Add pipeline_notes JSONB array for notes
ALTER TABLE candidate_submissions
ADD COLUMN IF NOT EXISTS pipeline_notes JSONB DEFAULT '[]';

-- Create index for pipeline queries
CREATE INDEX IF NOT EXISTS idx_candidate_submissions_pipeline_stage ON candidate_submissions(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_candidate_submissions_last_activity ON candidate_submissions(last_pipeline_activity);
CREATE INDEX IF NOT EXISTS idx_candidate_submissions_best_match_job ON candidate_submissions(best_match_job_id);

-- Set last_pipeline_activity to created_at for existing records
UPDATE candidate_submissions
SET last_pipeline_activity = created_at
WHERE last_pipeline_activity IS NULL;

SELECT 'Pipeline columns added successfully!' as status;
