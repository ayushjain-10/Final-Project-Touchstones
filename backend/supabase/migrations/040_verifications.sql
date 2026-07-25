-- 040_verifications.sql — Verify API Phase 2: the public `/v1/verifications` ingest record.
--
-- THE PRODUCT CORE. A caller POSTs a candidate's work (+ optional events / AI transcript) to
-- `/v1/verifications`; the server reuses the EXISTING engine UNCHANGED (proofScoringService,
-- aiDirectionService, codeExecutionService, the integrity hash-chain) and persists the assembled
-- Verification object into `report`. This table is the account-owned, externally-addressable row;
-- the internal `work_samples` / `work_sample_submissions` it materializes are engine plumbing.
--
-- candidate_id rule (load-bearing, see verify-api-design.md): the opaque external `candidate_ref`
-- is NOT a `profiles.id`. `work_sample_submissions.candidate_id` is `uuid NOT NULL FK profiles(id)`,
-- so the internal submission uses `candidate_id = account_id` (a real profiles row). `candidate_ref`
-- lives ONLY here, on the verifications row — never on the submission. We do NOT mint synthetic
-- auth.users and do NOT make candidate_id nullable.
--
-- Idempotency: an `Idempotency-Key` on POST is claimed via processed_events (ns 'apikey:<acct>:<idem>')
-- BEFORE mutating, AND backstopped by UNIQUE(account_id, idempotency_key) here — a replay returns the
-- prior `report` instead of re-scoring (no double LLM spend).
--
-- SECURITY / RLS (mirrors 016 / 037 / 039 — RLS is the tenant boundary; the console reads via the
-- token-scoped client, never service-role):
--   * Owner (account_id = auth.uid()) has full control over their own verification rows.
--   * No anon / cross-account visibility.
-- The `/v1` request path holds only an API key (no Supabase session): when SUPABASE_JWT_SECRET is set
-- the handler uses a minted RLS-scoped client; until then it uses service-role and MUST `.eq('account_id', …)`
-- on every read (the tenant-isolation test is the safety net).
--
-- NOT applied by this file — the founder/lead applies migrations manually.

CREATE TABLE IF NOT EXISTS public.verifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  api_key_id     UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
  mode           TEXT NOT NULL CHECK (mode IN ('live', 'test')),
  candidate_ref  TEXT,                          -- opaque external id; NOT a profiles.id
  source         TEXT NOT NULL DEFAULT 'api',
  status         TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'needs_review')),
  work_sample_id UUID REFERENCES public.work_samples(id) ON DELETE SET NULL,
  submission_id  UUID REFERENCES public.work_sample_submissions(id) ON DELETE SET NULL,
  idempotency_key TEXT,
  report         JSONB,                         -- the assembled Verification object
  error          JSONB,                         -- { type, message } on failure (never leaks internals)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

-- Console listings ("my verifications") + the GET /v1/verifications/:id account filter.
CREATE INDEX IF NOT EXISTS idx_verifications_account_created
  ON public.verifications (account_id, created_at DESC);

-- Idempotency backstop: at most ONE verification per (account, idempotency_key). Partial so the
-- common no-key path (idempotency_key IS NULL) is never constrained. Mirrors the processed_events
-- claim in the route; both together close the duplicate-ingest / double-spend window.
CREATE UNIQUE INDEX IF NOT EXISTS uq_verifications_account_idem
  ON public.verifications (account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;

-- --- Owner: full control over their own verification rows ---------------------------
DROP POLICY IF EXISTS verifications_owner_select ON public.verifications;
CREATE POLICY verifications_owner_select ON public.verifications
  FOR SELECT TO authenticated
  USING (account_id = auth.uid());

DROP POLICY IF EXISTS verifications_owner_insert ON public.verifications;
CREATE POLICY verifications_owner_insert ON public.verifications
  FOR INSERT TO authenticated
  WITH CHECK (account_id = auth.uid());

DROP POLICY IF EXISTS verifications_owner_update ON public.verifications;
CREATE POLICY verifications_owner_update ON public.verifications
  FOR UPDATE TO authenticated
  USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

DROP POLICY IF EXISTS verifications_owner_delete ON public.verifications;
CREATE POLICY verifications_owner_delete ON public.verifications
  FOR DELETE TO authenticated
  USING (account_id = auth.uid());

COMMENT ON TABLE public.verifications IS
  'Verify API /v1 ingest rows. candidate_ref is opaque (NOT a profiles.id); the internal submission uses candidate_id = account_id. RLS: owner manages own rows (account_id = auth.uid()). UNIQUE(account_id, idempotency_key) WHERE idempotency_key IS NOT NULL backstops Idempotency-Key. report holds the assembled Verification; status mirrors the engine outcome.';

SELECT 'verifications ready' AS status;
