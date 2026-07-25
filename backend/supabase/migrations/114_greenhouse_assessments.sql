-- 114_greenhouse_assessments.sql -- Greenhouse Assessments (Take-Home Test) partner integration.
--
-- Greenhouse calls four partner-hosted endpoints on us (list_tests / send_test / test_status /
-- request_errors, mounted at /integrations/greenhouse) and we PATCH the per-assessment completion
-- url back to app.greenhouse.io when the screen is scored. Feature flag
-- GREENHOUSE_ASSESSMENTS_ENABLED (OFF by default) gates the whole surface.
--
-- Account-scoped tables (account_id == profiles.id == auth.uid(), the same tenancy root the
-- Verify API, Ashby (076) and Greenhouse v3 (101) integrations use):
--   greenhouse_assessments      -- one row per sent test; the row id IS the partner_interview_id
--                                  we return to Greenhouse and that Greenhouse echoes back on
--                                  test_status. Mirrors ashby_assessments (076).
--   greenhouse_oauth_connections -- per-tenant Harvest v3 Partner OAuth tokens (authorization-code
--                                  grant with ROTATING refresh tokens; both tokens encrypted).
--
-- SECURITY / RLS: both tables are RLS deny-all to authenticated/anon (ENABLE RLS with NO policies).
-- The inbound partner endpoints run via the SERVICE-ROLE client AFTER apiKeyAuth has resolved the
-- tenant from the presented org API key (the key is the capability, exactly like /v1 and Ashby).
-- OAuth tokens must never reach a browser; all access goes through backend services.

-- 1) mapping table: one row per sent test; row id IS the partner_interview_id
CREATE TABLE IF NOT EXISTS public.greenhouse_assessments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- = partner_interview_id
  account_id            UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assessment_type_id    UUID,            -- assessment_templates.id (= partner_test_id)
  work_sample_id        UUID REFERENCES public.work_samples(id) ON DELETE SET NULL,
  submission_id         UUID REFERENCES public.work_sample_submissions(id) ON DELETE SET NULL,
  candidate_id          UUID,            -- our profiles id for the candidate
  candidate_email       TEXT,
  gh_candidate_id       BIGINT,          -- parsed from greenhouse_profile_url (best-effort)
  gh_application_id     BIGINT,          -- parsed from greenhouse_profile_url (best-effort)
  gh_take_home_test_id  TEXT,            -- trailing id of the completion url (idempotency key)
  completion_patch_url  TEXT,            -- validated https://app.greenhouse.io/... only
  sent_by               TEXT,            -- email of the Greenhouse user who sent the test
  status                TEXT NOT NULL DEFAULT 'sent'
                          CHECK (status IN ('sent', 'complete', 'expired', 'error')),
  partner_score         NUMERIC,         -- 0..100, persisted at completion so test_status can
  result_metadata       JSONB,           -- always answer (Greenhouse may poll at any time)
  last_error            TEXT,            -- last request_errors payload / PATCH failure (truncated)
  last_patched_at       TIMESTAMPTZ,     -- when the completion PATCH last succeeded
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency: a retried send_test carries the same completion url, so the trailing
-- take_home_test id is the natural retry key. Partial unique: rows without it fall back to
-- (account, test, email) dedupe in the service.
CREATE UNIQUE INDEX IF NOT EXISTS greenhouse_assessments_take_home_uniq
  ON public.greenhouse_assessments (account_id, gh_take_home_test_id)
  WHERE gh_take_home_test_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS greenhouse_assessments_account_idx
  ON public.greenhouse_assessments (account_id);
CREATE INDEX IF NOT EXISTS greenhouse_assessments_submission_idx
  ON public.greenhouse_assessments (submission_id);

ALTER TABLE public.greenhouse_assessments ENABLE ROW LEVEL SECURITY;
-- DENY-ALL to authenticated/anon: ENABLE RLS with NO policies = nothing visible outside the
-- service role. Partner endpoints and the completion hook are the only readers/writers.

COMMENT ON TABLE public.greenhouse_assessments IS
  'Greenhouse Assessments partner: maps a Greenhouse-sent take-home test (id = partner_interview_id) to a Touchstones work_sample_submission. RLS deny-all; partner endpoints write via service-role after apiKeyAuth resolves the tenant.';

-- 2) per-tenant Harvest v3 Partner OAuth connection (ONE partner client in backend env,
--    per-tenant rotating refresh tokens obtained via the customer consent redirect)
CREATE TABLE IF NOT EXISTS public.greenhouse_oauth_connections (
  account_id         UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  access_token_enc   TEXT,              -- cryptoVault "v1:" token; access token lives ~1h
  refresh_token_enc  TEXT,              -- cryptoVault "v1:" token; ROTATES on every refresh, ~24h life
  access_expires_at  TIMESTAMPTZ,       -- parsed from the token response expires_at (ISO8601)
  scopes             TEXT,              -- space-separated granted scopes
  status             TEXT NOT NULL DEFAULT 'connected'
                       CHECK (status IN ('connected', 'needs_reauth')),
  last_refreshed_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.greenhouse_oauth_connections ENABLE ROW LEVEL SECURITY;
-- DENY-ALL to authenticated/anon (no policies): tokens must never reach a browser. The settings
-- route returns only { connected, scopes, status, last_refreshed_at }.

COMMENT ON TABLE public.greenhouse_oauth_connections IS
  'Per-account Greenhouse Harvest v3 Partner OAuth tokens (authorization-code grant, rotating refresh). Both tokens AES-256-GCM encrypted (cryptoVault). RLS deny-all; managed only by greenhouseOAuthService via service-role.';

-- 3) the per-org Assessment API key we mint for the customer to hand to Greenhouse. api_keys stores
--    only the sha256 hash, but the completion PATCH must PRESENT the same key later, so the raw key
--    is kept cryptoVault-encrypted here (and shown to the customer exactly once at mint).
ALTER TABLE public.greenhouse_integration_settings
  ADD COLUMN IF NOT EXISTS assessment_api_key_enc TEXT;
ALTER TABLE public.greenhouse_integration_settings
  ADD COLUMN IF NOT EXISTS assessment_api_key_id UUID;  -- api_keys.id, for revocation on rotate/delete

COMMENT ON COLUMN public.greenhouse_integration_settings.assessment_api_key_enc IS
  'Raw Greenhouse Assessment API org key, cryptoVault-encrypted. Needed to authenticate the outbound completion PATCH to app.greenhouse.io. Never returned to a client.';

SELECT 'greenhouse_assessments + greenhouse_oauth_connections ready' AS status;

-- down:
--   DROP TABLE IF EXISTS public.greenhouse_oauth_connections;
--   DROP TABLE IF EXISTS public.greenhouse_assessments;
--   ALTER TABLE public.greenhouse_integration_settings DROP COLUMN IF EXISTS assessment_api_key_enc;
--   ALTER TABLE public.greenhouse_integration_settings DROP COLUMN IF EXISTS assessment_api_key_id;
