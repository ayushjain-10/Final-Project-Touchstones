-- 086 — support the waitlist nurture sweep (backend/src/services/waitlistNurture.js): a once-only
-- claim column so a demo requester gets exactly one 48-hour nurture email. Mirrors the deadline
-- sweep's reminder_sent_at claim (082). Idempotent + reversible:
--   up:   ALTER TABLE ... ADD COLUMN IF NOT EXISTS nurtured_at timestamptz;
--   down: ALTER TABLE public.waitlist DROP COLUMN IF EXISTS nurtured_at;
--
-- SAFETY: the nurture sweep is age-BANDED (only rows created 48–96h ago) and gated OFF by default
-- (WAITLIST_NURTURE_ENABLED), so enabling it can never blast the pre-existing waitlist backlog on
-- the shared dev/prod DB — only freshly-aged rows in the band are ever nurtured, exactly once.
ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS nurtured_at timestamptz;
