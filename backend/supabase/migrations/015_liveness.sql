-- 015: Active face-liveness signals (Feature 2, pillar 2 — the CAMERA pillar)
-- Additive + idempotent. Active liveness is an OPT-IN, consent-gated check: the
-- backend issues a randomized, HMAC-signed challenge (blink/turn/open-mouth) so a
-- candidate cannot pre-record a passing clip. The browser runs a face-landmarker
-- locally and POSTs back ONLY DERIVED signals (per-frame EAR / yaw / jaw-open
-- blendshape values, timestamps, and a pass/fail verdict). NO raw video or images
-- are ever uploaded or stored. The derived trace appends to the existing
-- hash-chained submission_integrity_events log with category = 'liveness'.
--
-- A failed / low-confidence check NEVER auto-rejects — it marks the submission
-- for needs_human_review. Trackers underperform in low light and on darker skin,
-- which is exactly why this is review-only, never a gate.

-- `source` server-attributes who wrote a row: client signals vs. a server-issued
-- challenge marker. The /verify endpoint stamps liveness rows 'server:liveness'
-- so a reviewer can tell a server-validated check from raw client telemetry.
ALTER TABLE submission_integrity_events
  ADD COLUMN IF NOT EXISTS source TEXT;   -- e.g. 'client' | 'server:liveness'

-- Helps a reviewer pull just the liveness trace for a submission quickly.
CREATE INDEX IF NOT EXISTS idx_integrity_category
  ON submission_integrity_events(submission_id, category);

SELECT 'liveness (camera pillar) integrity columns ready' AS status;
