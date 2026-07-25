-- 101_greenhouse_v3_integration.sql — Greenhouse Harvest v3 note write-back integration.
--
-- Greenhouse sunsets Harvest v1/v2 on 2026-08-31; v3 is required. v3 uses a client-credentials
-- OAuth flow (POST https://auth.greenhouse.io/token, Basic client_id:client_secret) and attaches
-- notes to a candidate_id (v1 attached to an application_id via an On-Behalf-Of header — gone in v3).
--
-- One account-scoped table (account_id == profiles.id == auth.uid(), the same tenancy root the
-- Verify API and the Ashby integration use — there is NO separate org table):
--   greenhouse_integration_settings — the customer's Harvest v3 credential (client_id +
--                                     AES-256-GCM-encrypted client_secret) plus optional defaults.
--
-- SECURITY / RLS (mirrors 076_ashby_assessments.ashby_integration_settings exactly): RLS deny-all
-- to authenticated/anon so the encrypted secret can never reach a browser via the RLS-scoped client.
-- All reads/writes go through the backend settings route using the SERVICE-ROLE client, gated by the
-- signed-in user's id (service-role bypasses RLS). The route NEVER returns client_secret_enc.

CREATE TABLE IF NOT EXISTS public.greenhouse_integration_settings (
  account_id         UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id          TEXT,            -- Harvest v3 credential client_id (Basic-auth username at /token)
  client_secret_enc  TEXT,            -- cryptoVault "v1:" token (AES-256-GCM). NEVER returned to a client.
  default_user_id    TEXT,            -- optional Greenhouse user_id to attribute notes to (body.user_id)
  default_visibility TEXT,            -- optional default note visibility ('admin_only'|'private'|'public')
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.greenhouse_integration_settings ENABLE ROW LEVEL SECURITY;
-- DENY-ALL to authenticated/anon: ENABLE RLS with NO policies = nothing visible to authenticated/anon.
-- The encrypted secret must never reach a browser via the RLS-scoped client. All access goes through
-- the backend settings route using the SERVICE-ROLE client, gated by the signed-in user's id.

COMMENT ON TABLE public.greenhouse_integration_settings IS
  'Per-account Greenhouse Harvest v3 credential: client_id + AES-256-GCM-encrypted client_secret (cryptoVault). RLS deny-all to authenticated; managed only via the backend settings route (service-role, gated by auth.uid()). client_secret_enc is never returned to a client.';

SELECT 'greenhouse_integration_settings ready' AS status;

-- down: DROP TABLE IF EXISTS public.greenhouse_integration_settings;
