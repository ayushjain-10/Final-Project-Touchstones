-- 036_proof_scores_idempotent.sql  (REVIEW-2026-06 §F — scoring idempotency)
-- Scoring must be idempotent on retry: a job that fails AFTER inserting proof_scores
-- (e.g. the proof_audit_log insert throws) gets requeued, and on re-claim it must NOT
-- create a SECOND live score for the same (submission, rubric_version) or re-charge the
-- LLM. The scoring worker (scoringQueue.processJob) reads processed_events first, and
-- proofScoringService.scoreSubmission now also short-circuits on an existing non-
-- superseded proof_scores row before reserving spend. This partial unique index is the
-- DB-level backstop for that invariant under any race the application checks miss.
--
-- Partial (WHERE superseded_by IS NULL) so a DELIBERATE re-score still works: the
-- re-score path sets superseded_by on the prior row first, freeing the slot for the new
-- live score. Multiple superseded historical rows for the same pair remain allowed.

CREATE UNIQUE INDEX IF NOT EXISTS uq_proof_scores_live_submission_rubric
  ON proof_scores (submission_id, rubric_version)
  WHERE superseded_by IS NULL;

COMMENT ON INDEX uq_proof_scores_live_submission_rubric IS
  'At most one LIVE (non-superseded) score per (submission_id, rubric_version). Backstops scoring idempotency on worker retry (REVIEW-2026-06 §F).';

SELECT 'proof_scores idempotency index ready' AS status;
