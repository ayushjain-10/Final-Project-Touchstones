-- 039_api_keys.sql — Verify API Phase 1: per-account API keys (the tenancy root).
--
-- An account (== profiles.id == auth.users.id; there is NO separate org table) mints
-- API keys from the console to call the public `/v1` Verify API. A key is presented as
-- `tsk_(live|test)_<base62 of >=32 CSPRNG bytes>` ONCE at creation; the server stores
-- ONLY sha256(plaintext) (`hashed_key`) plus a display prefix + last4. We can therefore
-- never reproduce the plaintext (no recovery path — rotation issues a fresh key), and a
-- DB compromise leaks no usable credentials.
--
-- apiKeyAuth flow: sha256 the presented key, look up `api_keys` by `hashed_key` (keyed
-- by the hash, via the service-role client), reject not-found / revoked, verify the
-- key's mode matches its prefix, then resolve `account_id` → the tenant. last_used_at is
-- a best-effort bump.
--
-- SECURITY / RLS (mirrors 016 + 037 conventions — RLS is the tenant boundary; the
-- console uses the token-scoped client, never service-role, for these reads/writes):
--   * Owner (account_id = auth.uid()) has full control over their own key rows.
--   * No anon/cross-account visibility. The plaintext key is never stored.
-- The `/v1` apiKeyAuth lookup is by `hashed_key` and runs via the service-role client
-- (the presented key IS the capability — exactly like a password/credential token — and
-- the caller has no Supabase session), so it does not depend on these RLS policies.
--
-- NOT applied by this file — the founder/lead applies migrations manually.

CREATE TABLE IF NOT EXISTS public.api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name         TEXT,
  prefix       TEXT NOT NULL,                 -- display-only, e.g. 'tsk_live_AbCd'
  hashed_key   TEXT NOT NULL UNIQUE,          -- sha256(plaintext) hex — the ONLY copy
  last4        TEXT NOT NULL,                 -- last 4 chars of the plaintext, display-only
  mode         TEXT NOT NULL CHECK (mode IN ('live', 'test')),
  scopes       TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

-- The hot path: apiKeyAuth looks up an ACTIVE key by its hash on every `/v1` request.
-- Partial index on the non-revoked set keeps that lookup tight and ignores dead keys.
CREATE INDEX IF NOT EXISTS idx_api_keys_hashed_active
  ON public.api_keys (hashed_key)
  WHERE revoked_at IS NULL;

-- Console listings ("my keys") are keyed by account.
CREATE INDEX IF NOT EXISTS idx_api_keys_account
  ON public.api_keys (account_id);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- --- Owner: full control over their own key rows ---------------------------------
DROP POLICY IF EXISTS api_keys_owner_select ON public.api_keys;
CREATE POLICY api_keys_owner_select ON public.api_keys
  FOR SELECT TO authenticated
  USING (account_id = auth.uid());

DROP POLICY IF EXISTS api_keys_owner_insert ON public.api_keys;
CREATE POLICY api_keys_owner_insert ON public.api_keys
  FOR INSERT TO authenticated
  WITH CHECK (account_id = auth.uid());

DROP POLICY IF EXISTS api_keys_owner_update ON public.api_keys;
CREATE POLICY api_keys_owner_update ON public.api_keys
  FOR UPDATE TO authenticated
  USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

DROP POLICY IF EXISTS api_keys_owner_delete ON public.api_keys;
CREATE POLICY api_keys_owner_delete ON public.api_keys
  FOR DELETE TO authenticated
  USING (account_id = auth.uid());

COMMENT ON TABLE public.api_keys IS
  'Verify API per-account keys. tsk_(live|test)_<base62> shown ONCE; only sha256(plaintext) stored (hashed_key UNIQUE). RLS: owner manages own rows (account_id = auth.uid()). apiKeyAuth looks up by hashed_key via service-role (the key is the capability).';

SELECT 'api_keys ready' AS status;
