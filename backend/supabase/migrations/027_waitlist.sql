-- 027_waitlist.sql — pre-launch waitlist + demo requests for the marketing site.
-- One table, distinguished by `kind`. The frontend inserts directly via the ANON key
-- (instant; no backend cold-start dependency). RLS allows INSERT only — NOBODY can read
-- the list back through PostgREST (no SELECT policy => deny). The founder reads it via
-- the Supabase dashboard / service-role. A SECURITY DEFINER count function exposes ONLY
-- an aggregate number (no PII) for social proof on the landing page.

CREATE TABLE IF NOT EXISTS waitlist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL,
  name            TEXT,
  company         TEXT,
  role            TEXT,            -- founder | recruiter | eng-lead | other
  team_size       TEXT,
  kind            TEXT NOT NULL DEFAULT 'waitlist' CHECK (kind IN ('waitlist','demo')),
  message         TEXT,            -- demo requests
  referral_source TEXT,
  status          TEXT NOT NULL DEFAULT 'new',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Dedup per (email, kind), case-insensitive. A repeat signup hits this and the client
-- treats the unique violation as "already on the list".
CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_email_kind ON waitlist (lower(email), kind);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- INSERT-only for anon + authenticated. No USING/SELECT policy => reads are denied to
-- everyone except the service-role (which bypasses RLS).
DROP POLICY IF EXISTS waitlist_public_insert ON waitlist;
CREATE POLICY waitlist_public_insert ON waitlist
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'        -- basic shape; blocks obvious junk
    AND char_length(email) <= 200
    AND char_length(coalesce(name,'')) <= 120
    AND char_length(coalesce(company,'')) <= 160
    AND char_length(coalesce(message,'')) <= 2000
  );

-- Aggregate-only, no PII. Used for "N teams already waiting" social proof.
CREATE OR REPLACE FUNCTION public.waitlist_count()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM waitlist WHERE kind = 'waitlist';
$$;
REVOKE EXECUTE ON FUNCTION public.waitlist_count() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.waitlist_count() TO anon, authenticated;

COMMENT ON TABLE waitlist IS 'Pre-launch waitlist + demo requests. Insert-only via anon; service-role reads.';

SELECT 'waitlist ready' AS status;
