-- 076_ashby_assessments.sql — Ashby Assessments Partner integration.
--
-- (075 was taken by 075_workspace_outcomes_member_select; Ashby starts at 076.)
--
-- Two account-scoped tables (account_id == profiles.id == auth.uid(), the same /v1 tenancy root the
-- Verify API uses — there is NO separate org table):
--   ashby_assessments          — one row per Ashby-started assessment, mapping it to a Touchstones
--                                 work_sample_submission. The row id IS the assessment_id we return
--                                 to Ashby and that Ashby echoes back on assessment.update/cancel.
--   ashby_integration_settings — the customer's OUTBOUND Ashby API key, AES-256-GCM encrypted at rest.
--
-- SECURITY / RLS (mirrors 039 conventions — RLS is the tenant boundary). The inbound partner
-- endpoints (Ashby -> us) run via the SERVICE-ROLE client AFTER apiKeyAuth has resolved the tenant
-- from the presented Touchstones key (the key is the capability, exactly like /v1), so the partner
-- writes do not depend on these policies. The console (token-scoped client) only needs to READ.

-- ── mapping table ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ashby_assessments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- = assessment_id returned to Ashby
  account_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assessment_type_id   UUID NOT NULL,                                -- the chosen assessment_templates.id
  work_sample_id       UUID REFERENCES public.work_samples(id) ON DELETE SET NULL,
  submission_id        UUID REFERENCES public.work_sample_submissions(id) ON DELETE SET NULL,
  candidate_id         UUID,                                         -- our profiles id for the candidate
  candidate_email      TEXT,
  ashby_candidate_id   TEXT,
  ashby_application_id TEXT,
  ashby_job_id         TEXT,
  status               TEXT NOT NULL DEFAULT 'started'
                         CHECK (status IN ('started', 'in_progress', 'complete', 'cancelled')),
  last_reported_ms     BIGINT,                                       -- monotonic guard for update timestamps
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency: a retried assessment.start for the same Ashby application + assessment type must
-- return the SAME assessment, never create a second assignment. application.ashby_id is the stable
-- Ashby identifier for a candidate-in-a-stage.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ashby_assessments_app_type
  ON public.ashby_assessments (account_id, ashby_application_id, assessment_type_id)
  WHERE ashby_application_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ashby_assessments_account ON public.ashby_assessments (account_id);
CREATE INDEX IF NOT EXISTS idx_ashby_assessments_submission ON public.ashby_assessments (submission_id);

ALTER TABLE public.ashby_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ashby_assessments_owner_select ON public.ashby_assessments;
CREATE POLICY ashby_assessments_owner_select ON public.ashby_assessments
  FOR SELECT TO authenticated
  USING (account_id = auth.uid());

COMMENT ON TABLE public.ashby_assessments IS
  'Ashby Assessments partner: maps an Ashby-started assessment (id = assessment_id returned to Ashby) to a Touchstones work_sample_submission. RLS: owner reads own (account_id = auth.uid()); partner endpoints write via service-role after apiKeyAuth resolves the tenant.';

-- ── per-account encrypted outbound Ashby API key ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ashby_integration_settings (
  account_id     UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  api_key_enc    TEXT,            -- cryptoVault "v1:" token (AES-256-GCM). NEVER returned to a client.
  api_key_last4  TEXT,            -- display hint only (last 4 chars)
  partner_id     TEXT,            -- our Ashby partner id (for assessment.addCompletedToCandidate), optional
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ashby_integration_settings ENABLE ROW LEVEL SECURITY;
-- DENY-ALL to authenticated/anon: the encrypted key must never reach a browser via the RLS-scoped
-- client. ENABLE RLS with NO policies = nothing visible to authenticated/anon. All reads/writes go
-- through the backend settings route using the SERVICE-ROLE client, gated by the signed-in user's
-- id (service-role bypasses RLS). The route NEVER returns api_key_enc — only { configured, last4 }.

COMMENT ON TABLE public.ashby_integration_settings IS
  'Per-account OUTBOUND Ashby API key, AES-256-GCM encrypted (cryptoVault). RLS deny-all to authenticated; managed only via the backend settings route (service-role, gated by auth.uid()). api_key_enc is never returned to a client.';

SELECT 'ashby_assessments + ashby_integration_settings ready' AS status;
