-- 082 — support the deadline sweep (backend/src/services/deadlineSweep.js): a once-only claim
-- column so a candidate is reminded about a due-soon screen exactly once. The sweep also flips
-- un-submitted past-deadline submissions to status='expired' (status is free-text; no enum change).
ALTER TABLE public.work_sample_submissions
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;
