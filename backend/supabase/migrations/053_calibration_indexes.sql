-- 053_calibration_indexes.sql — index the aggregates behind the Benchmarks surface (CC3).
-- ---------------------------------------------------------------------------------------
-- Every calibration query starts from "the latest live score per submission, joined to its
-- work sample's role_family and its outcome label". These indexes keep that path cheap as
-- proof_scores / work_samples grow. (submission_outcomes already has an implicit index from
-- its UNIQUE(submission_id); work_sample_submissions(work_sample_id) and proof_scores
-- (submission_id) are indexed by migration 011 — we only add what 011 didn't.)

-- Per-role grouping + the account_roles list both filter/aggregate by role_family.
CREATE INDEX IF NOT EXISTS idx_work_samples_role_family ON work_samples(role_family);

-- "latest, non-superseded score per submission" is the hot read for every aggregate; a
-- PARTIAL index over only the live rows stays small and skips the superseded history.
CREATE INDEX IF NOT EXISTS idx_proof_scores_live ON proof_scores(submission_id)
  WHERE superseded_by IS NULL;

-- Snapshot freshness / scope lookups (cache-on-read picks the most recent row per key).
CREATE INDEX IF NOT EXISTS idx_calibration_snapshots_scope
  ON calibration_snapshots(scope, account_id, role_family, computed_at DESC);

SELECT 'calibration indexes ready' AS status;
