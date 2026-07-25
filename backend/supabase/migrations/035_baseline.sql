-- 035_baseline.sql
-- Caches a per-task "one-shot AI baseline": the agent's unaided attempt at the task
-- plus its test result, so we can award the human credit specifically where they beat
-- it. Per-task (not per-submission) — computed once, reused across candidates.
ALTER TABLE work_samples ADD COLUMN IF NOT EXISTS baseline jsonb;

SELECT 'work_samples.baseline added' AS status;
