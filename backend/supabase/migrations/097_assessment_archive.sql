-- 097 — assessment archive stamp (ADR-002).
-- archived_at marks a submission's bundle as uploaded to the owner's Azure Blob archive.
-- NULL = not yet archived, which is what makes the first sweep a free backfill of all history.
-- Written only by the service role (the sweep); no RLS change — candidates/recruiters keep
-- exactly the visibility they had, and the column carries no candidate data.

ALTER TABLE work_sample_submissions
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN work_sample_submissions.archived_at IS
  'When this submission''s bundle was uploaded to the assessment archive (ADR-002). NULL = pending; the sweep only touches terminal states.';

-- The sweep's working set: terminal rows not yet archived. Partial on the NULL set keeps it
-- O(pending); status leads so the sweep's `status IN (...)` filter is index-served too.
CREATE INDEX IF NOT EXISTS wss_archive_pending_idx
  ON work_sample_submissions (status, created_at)
  WHERE archived_at IS NULL;

-- Rollback:
--   DROP INDEX IF EXISTS wss_archive_pending_idx;
--   ALTER TABLE work_sample_submissions DROP COLUMN IF EXISTS archived_at;
