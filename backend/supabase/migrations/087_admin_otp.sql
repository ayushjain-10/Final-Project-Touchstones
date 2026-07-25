-- 087 — one-time codes for the founder admin dashboard (backend/src/routes/admin.js).
-- Codes are emailed to ADMIN_EMAIL, stored ONLY as sha256 hashes, expire in 10 minutes,
-- allow 5 verify attempts, and are single-use (consumed_at). The table is service-role-only:
-- RLS is enabled with NO policies, so anon/authenticated clients can never touch it.
--
-- Reversible:
--   up:   this file
--   down: DROP TABLE IF EXISTS public.admin_otp;
CREATE TABLE IF NOT EXISTS public.admin_otp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts int NOT NULL DEFAULT 0
);

ALTER TABLE public.admin_otp ENABLE ROW LEVEL SECURITY;
-- Deny-all on purpose: no policies. Only the service role (which bypasses RLS) reads/writes.

CREATE INDEX IF NOT EXISTS admin_otp_created_idx ON public.admin_otp (created_at DESC);
