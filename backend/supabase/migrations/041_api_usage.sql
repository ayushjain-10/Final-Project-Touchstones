-- 041_api_usage.sql — Verify API Phase 1: per-account daily usage counters.
--
-- The `/v1` usageMetering middleware bumps a counter per (account, day, endpoint) so the
-- console can show "verifications today" and so Phase 2 metering/quotas have a source of
-- truth. Writes happen on the request path via the service-role client (the caller has no
-- Supabase session — only an API key); the owner can READ their own usage in the console.
--
-- SECURITY / RLS (mirrors 016 + 037 — RLS is the tenant boundary):
--   * Owner (account_id = auth.uid()) may SELECT their own usage rows.
--   * No INSERT/UPDATE policy → authenticated users cannot forge counters; all writes go
--     through the service-role client (or the SECURITY DEFINER increment fn below), which
--     bypasses RLS. This is the same "writes via service role" shape as api_usage in 041.
--
-- NOT applied by this file — the founder/lead applies migrations manually.

CREATE TABLE IF NOT EXISTS public.api_usage (
  account_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  endpoint   TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, day, endpoint)
);

-- Console "usage over time" reads by account, newest day first.
CREATE INDEX IF NOT EXISTS idx_api_usage_account_day
  ON public.api_usage (account_id, day DESC);

ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;

-- --- Owner: read-only visibility of their own usage --------------------------------
DROP POLICY IF EXISTS api_usage_owner_select ON public.api_usage;
CREATE POLICY api_usage_owner_select ON public.api_usage
  FOR SELECT TO authenticated
  USING (account_id = auth.uid());

-- --- Atomic upsert-increment, callable on the request path -------------------------
-- SECURITY DEFINER so the request path (which holds only an API key, no session) can
-- bump the counter without an INSERT/UPDATE RLS policy existing on the table. Pinned
-- search_path (016 convention) to prevent search_path injection. The function only ever
-- touches public.api_usage for the passed account; it cannot read or write other tenants'
-- data, so granting it to service_role (server path) is safe. Revoked from anon/public.
CREATE OR REPLACE FUNCTION public.increment_api_usage(p_account UUID, p_endpoint TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.api_usage (account_id, day, endpoint, count)
  VALUES (p_account, (now() AT TIME ZONE 'utc')::date, p_endpoint, 1)
  ON CONFLICT (account_id, day, endpoint)
  DO UPDATE SET count = public.api_usage.count + 1;
END;
$$;

COMMENT ON FUNCTION public.increment_api_usage(uuid, text) IS
  'Atomic per-(account,day,endpoint) usage bump for the Verify API request path. SECURITY DEFINER + pinned search_path; service_role only (the API-key request path has no session). Day is UTC.';

REVOKE EXECUTE ON FUNCTION public.increment_api_usage(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_api_usage(uuid, text) TO service_role;

COMMENT ON TABLE public.api_usage IS
  'Verify API per-(account,day,endpoint) request counters. RLS: owner SELECTs own rows; writes via service role / increment_api_usage SECURITY DEFINER fn.';

SELECT 'api_usage ready' AS status;
