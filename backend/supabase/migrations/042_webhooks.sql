-- 042_webhooks.sql — Verify API Phase 3: OUTBOUND signed webhooks.
--
-- An account registers HTTPS endpoint(s) from the developer console to be notified when a
-- verification reaches a terminal state. The /v1 ingest path (and, when the scoring queue is on,
-- the worker) fires `verification.completed` / `verification.needs_review` / `verification.failed`
-- to every active endpoint subscribed to that event. Delivery is SIGNED (HMAC-SHA256 over
-- `${timestamp}.${body}`, header `Touchstones-Signature: t=<ts>,v1=<hex>`, exactly the Stripe
-- scheme) so the receiver can verify authenticity. This is the INVERSE of routes/webhooks.js,
-- which RECEIVES inbound webhooks (Calendly/Stripe/Google) — different direction, different table.
--
-- Two tables:
--   webhook_endpoints   — the account-owned destinations + per-endpoint signing secret.
--   webhook_deliveries  — the append-only attempt log (one row per (endpoint, event), retried
--                         with exponential backoff by the in-process drain worker).
--
-- signing_secret is `whsec_<base62>` and is stored in plaintext because the SERVER must hold it
-- to sign outbound payloads (it is a shared secret with the receiver, not a credential the caller
-- presents to us — unlike api_keys, which we only ever sha256). It is owner-readable via RLS so
-- the console can display it for receiver-side verification; rotation issues a fresh secret.
--
-- SECURITY / RLS (mirrors 039 / 040 — RLS is the tenant boundary; the console reads via the
-- token-scoped client, never service-role):
--   * webhook_endpoints  — owner (account_id = auth.uid()) has full control over their own rows.
--   * webhook_deliveries — owner may SELECT their own delivery log ONLY. Inserts/updates are made
--     by the delivery worker via the service-role client (no owner write policy — the log is
--     server-authored, append-only from the account's perspective).
--   * No anon / cross-account visibility on either table.
--
-- NOT applied by this file — the founder/lead applies migrations manually.

-- ── webhook_endpoints ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,                         -- HTTPS only (enforced in app)
  description     TEXT,
  signing_secret  TEXT NOT NULL,                         -- whsec_<base62>; server-held shared secret
  enabled_events  TEXT[] NOT NULL DEFAULT '{}',          -- e.g. {verification.completed,verification.needs_review}
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'disabled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_delivery_at TIMESTAMPTZ,
  disabled_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_account
  ON public.webhook_endpoints (account_id, created_at DESC);

-- Active-endpoint lookup at dispatch time (account scoped).
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_account_active
  ON public.webhook_endpoints (account_id)
  WHERE status = 'active';

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_endpoints_owner_select ON public.webhook_endpoints;
CREATE POLICY webhook_endpoints_owner_select ON public.webhook_endpoints
  FOR SELECT TO authenticated
  USING (account_id = auth.uid());

DROP POLICY IF EXISTS webhook_endpoints_owner_insert ON public.webhook_endpoints;
CREATE POLICY webhook_endpoints_owner_insert ON public.webhook_endpoints
  FOR INSERT TO authenticated
  WITH CHECK (account_id = auth.uid());

DROP POLICY IF EXISTS webhook_endpoints_owner_update ON public.webhook_endpoints;
CREATE POLICY webhook_endpoints_owner_update ON public.webhook_endpoints
  FOR UPDATE TO authenticated
  USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

DROP POLICY IF EXISTS webhook_endpoints_owner_delete ON public.webhook_endpoints;
CREATE POLICY webhook_endpoints_owner_delete ON public.webhook_endpoints
  FOR DELETE TO authenticated
  USING (account_id = auth.uid());

COMMENT ON TABLE public.webhook_endpoints IS
  'Verify API outbound webhook destinations. signing_secret (whsec_*) is server-held to sign payloads (Touchstones-Signature: t=<ts>,v1=<hmacsha256>). RLS: owner manages own rows (account_id = auth.uid()).';

-- ── webhook_deliveries ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint_id     UUID REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  verification_id UUID REFERENCES public.verifications(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB,                                 -- the exact body we signed + sent
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'success', 'failed')),
  attempts        INT NOT NULL DEFAULT 0,
  response_status INT,
  response_body   TEXT,                                  -- truncated receiver response (debug)
  error           TEXT,                                  -- last transport/error message (truncated)
  next_attempt_at TIMESTAMPTZ,                           -- backoff schedule for the drain worker
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ
);

-- Owner delivery-log listing (developer console "recent deliveries").
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_account_created
  ON public.webhook_deliveries (account_id, created_at DESC);

-- Retry drain: failed rows that are due for another attempt.
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry
  ON public.webhook_deliveries (next_attempt_at)
  WHERE status = 'failed';

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Owner may READ their own delivery log only; writes are server-authored (service-role).
DROP POLICY IF EXISTS webhook_deliveries_owner_select ON public.webhook_deliveries;
CREATE POLICY webhook_deliveries_owner_select ON public.webhook_deliveries
  FOR SELECT TO authenticated
  USING (account_id = auth.uid());

COMMENT ON TABLE public.webhook_deliveries IS
  'Append-only outbound webhook attempt log (one row per endpoint+event, retried with exponential backoff by the in-process drain worker). RLS: owner SELECT only; inserts/updates by the delivery worker via service-role.';

SELECT 'webhooks ready' AS status;
