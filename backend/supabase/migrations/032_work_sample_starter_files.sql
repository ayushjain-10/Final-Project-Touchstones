-- 032_work_sample_starter_files.sql
-- Let an authored screen carry starter files (for the in-browser candidate IDE)
-- and language hints. This is what closes the loop: a recruiter turns an
-- assessment_template (which already has starter_files) into a live work_sample
-- that opens pre-loaded in the candidate's CodeMirror editor.
ALTER TABLE work_samples
  ADD COLUMN IF NOT EXISTS starter_files jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE work_samples
  ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}';

SELECT 'work_samples.starter_files + languages added' AS status;
