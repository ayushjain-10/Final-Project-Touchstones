-- 033_code_execution.sql
-- Hidden tests let a screen RUN the candidate's code in an isolated sandbox and feed
-- objective pass/fail into the review (the biggest credibility gap for engineering
-- screening). `tests` shape: { command, files:[{path,content}], timeout_ms? }.
ALTER TABLE work_samples ADD COLUMN IF NOT EXISTS tests jsonb;
ALTER TABLE assessment_templates ADD COLUMN IF NOT EXISTS tests jsonb;
-- Where the per-submission run result is cached (passed/failed/stdout/stderr).
ALTER TABLE work_sample_submissions ADD COLUMN IF NOT EXISTS execution_result jsonb;

SELECT 'code-execution columns added' AS status;
