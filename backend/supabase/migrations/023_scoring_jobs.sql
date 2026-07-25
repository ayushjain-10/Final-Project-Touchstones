-- 023_scoring_jobs.sql  (roadmap #8)
-- The scoring queue. POST /score enqueues here and returns 202 {jobId}; a Node worker
-- (same codebase) drains it, calls Anthropic interactively, writes proof_scores +
-- hash-chained proof_audit_log, and flips status -> 'scored' so Realtime pushes the
-- result to the recruiter. Scoring leaves the request path for AVAILABILITY (one Render
-- worker cannot block 3-8s on an LLM under concurrency), per SYSTEM_DESIGN §2a/§5.
--
-- UNIQUE(submission_id, rubric_version): a rubric bump produces a NEW job rather than
-- being silently swallowed by an ON CONFLICT DO NOTHING on input_hash. Re-enqueue for
-- the same (submission, rubric) is a no-op (idempotent), which is the intended dedup.
--
-- Service-role (worker) only: enable RLS, NO public policies. The worker runs under
-- supabaseAdmin; candidates/recruiters never read or write the queue directly (they get
-- results via proof_scores RLS + Realtime).

CREATE TABLE IF NOT EXISTS scoring_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  UUID NOT NULL REFERENCES work_sample_submissions(id) ON DELETE CASCADE,
  rubric_version INT  NOT NULL,
  -- queued | processing | scored | needs_review | failed | pending_scoring
  status         TEXT NOT NULL DEFAULT 'queued',
  attempts       INT  DEFAULT 0,
  last_error     TEXT,
  interactive    BOOLEAN DEFAULT TRUE,   -- false = Batch API (bulk/background re-scoring)
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_scoring_jobs_submission_rubric UNIQUE (submission_id, rubric_version)
);

-- Defense-in-depth on the status domain (worker code is the primary enforcer).
ALTER TABLE scoring_jobs DROP CONSTRAINT IF EXISTS chk_scoring_jobs_status;
ALTER TABLE scoring_jobs
  ADD CONSTRAINT chk_scoring_jobs_status
  CHECK (status IN ('queued','processing','scored','needs_review','failed','pending_scoring'));

-- The worker polls for drainable work by status; this index keeps that a range scan.
CREATE INDEX IF NOT EXISTS idx_scoring_jobs_status ON scoring_jobs(status);

-- updated_at trigger — same convention as every other mutable table (001_initial_schema).
DROP TRIGGER IF EXISTS update_scoring_jobs_updated_at ON scoring_jobs;
CREATE TRIGGER update_scoring_jobs_updated_at
  BEFORE UPDATE ON scoring_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE scoring_jobs IS
  'Async scoring queue (SYSTEM_DESIGN §2a). Service-role/worker only. UNIQUE(submission_id, rubric_version).';

-- Service-role (worker) only: enable RLS, add NO public policies.
ALTER TABLE scoring_jobs ENABLE ROW LEVEL SECURITY;

SELECT 'scoring_jobs (async scoring queue) ready' AS status;
