-- 084 — store the authoritative submit-time per-case test results on the submission.
-- On submit, the backend runs the FULL structured test suite (all cases) once in the sandbox and
-- writes the per-case outcome here (distinct from execution_result, which caches ad-hoc /run output).
-- The recruiter sees every case; candidate reads are redacted in the route (hidden cases → pass/fail
-- only). Written by the trusted backend (service role); end-user tokens can't write it (080).
ALTER TABLE work_sample_submissions ADD COLUMN IF NOT EXISTS test_results jsonb;
