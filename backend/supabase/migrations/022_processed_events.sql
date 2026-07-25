-- 022_processed_events.sql  (SYSTEM_DESIGN §3 — the ONE dedup table)
-- Security's "Stripe replay guard", scale's processed_events, and efficiency's
-- llm_cache were three tables solving one problem: "have I already handled this?".
-- Unify them into a single idempotency ledger keyed by a per-source event key.
--
-- Service-role only: every writer (Stripe webhook handler, scoring worker, Calendly
-- retry handler) runs under supabaseAdmin. There is no end-user read/write path, so
-- RLS is enabled with NO permissive policies — the table is invisible over PostgREST
-- to anon/authenticated, and only the service-role (which bypasses RLS) touches it.

CREATE TABLE IF NOT EXISTS processed_events (
  event_key    TEXT PRIMARY KEY,
  source       TEXT NOT NULL,           -- 'stripe' | 'scoring' | 'calendly'
  result       JSONB,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE processed_events IS
  'The ONE idempotency/dedup ledger (SYSTEM_DESIGN §3). Service-role only.';
COMMENT ON COLUMN processed_events.event_key IS
  'Per-source dedup key. stripe: event.id | scoring: submission_id || '':'' || rubric_version | calendly: hash(type+uri+created_at).';
COMMENT ON COLUMN processed_events.source IS
  'Origin of the key: stripe (replay guard) | scoring (re-score safety rail) | calendly (retry guard).';

-- Service-role only: enable RLS, add NO public policies. anon/authenticated see nothing.
ALTER TABLE processed_events ENABLE ROW LEVEL SECURITY;

SELECT 'processed_events (unified dedup ledger) ready' AS status;
