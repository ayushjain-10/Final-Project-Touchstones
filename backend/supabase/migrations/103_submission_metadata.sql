-- 103: late-submission grace window (launch blocker: timer expiry handling).
-- metadata carries flags the trusted backend stamps on a submission at write time. First
-- consumer is late_submission: POST /api/proof/submissions/:id/submit now accepts a submit
-- that arrives inside a short post-deadline grace window (the client auto-submits at zero,
-- so network latency or tab wake-up must never cost a candidate their work) and flags it
-- here for human review, instead of rejecting with 410.
-- Written only by the service role (work_sample_submissions is read-only to end-user tokens,
-- see 080); no RLS change. The submit route only references this column on a LATE submit, so
-- on-time submissions do not depend on this migration being applied.

ALTER TABLE work_sample_submissions
  ADD COLUMN IF NOT EXISTS metadata jsonb;

COMMENT ON COLUMN work_sample_submissions.metadata IS
  'Server-stamped submission flags, e.g. {"late_submission": true, "late_by_seconds": 42} when the submit was accepted inside the post-deadline grace window. Review hints for humans, never automated pass/fail.';

-- Rollback:
--   ALTER TABLE work_sample_submissions DROP COLUMN IF EXISTS metadata;
