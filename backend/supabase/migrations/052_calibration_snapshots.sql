-- 052_calibration_snapshots.sql — materialized calibration for the Benchmarks surface
-- (CC3 / Feature: Calibrated Score + Benchmarks).
-- ---------------------------------------------------------------------------------------
-- The outcome flywheel (migration 029 + /api/outcomes) collects the labels nobody else
-- has — did-they-advance / get-an-offer / get-hired / stay-90-days — joined back to the
-- proof score. This table CACHES the per-role calibration DERIVED from those labels so the
-- /api/benchmarks reads stay cheap: a score distribution, outcome-rate bands, and
-- percentiles, "refreshed on a schedule or on demand".
--
-- SOURCE OF TRUTH is the live aggregate in services/calibrationService.js (pure SQL counts
-- + a thin JS layer). A snapshot is ALWAYS recompute-able from that — never authoritative —
-- so a stale/absent snapshot degrades gracefully to a live recompute, it never lies.
--
-- PRIVACY: a snapshot holds ONLY anonymized counts + rates — no candidate rows, no PII,
-- never another tenant's rows. A 'global' snapshot (account_id IS NULL) is the cross-account
-- anonymized fallback shown ONLY as aggregate counts when a single account's per-role sample
-- is too small to be honest on its own.

CREATE TABLE IF NOT EXISTS calibration_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         TEXT NOT NULL DEFAULT 'account',                  -- 'account' | 'global'
  account_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,   -- NULL only for the global anonymized aggregate
  role_family   TEXT NOT NULL DEFAULT '*',                        -- '*' = "all roles" within this scope
  sample_size   INT  NOT NULL DEFAULT 0,                          -- # of scored+labeled submissions behind this snapshot
  buckets       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- per score band: [{bucket,n,advanced_rate,offer_rate,hire_rate,retention_90d_rate}]
  outcome_rates JSONB NOT NULL DEFAULT '{}'::jsonb,   -- overall: {n,advanced_rate,offer_rate,hire_rate,retention_90d_rate}
  distribution  JSONB NOT NULL DEFAULT '[]'::jsonb,   -- histogram: [{lo,hi,label,n}] (10-pt bins, 0-100)
  percentiles   JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {p10,p25,p50,p75,p90,min,max,mean}
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- account rows always carry a real account_id + role_family, so a plain composite UNIQUE
  -- deduplicates them and backs supabase-js upsert(onConflict). The single global row per
  -- role_family (account_id IS NULL) is kept unique by delete-then-insert in refreshSnapshots,
  -- so this never depends on NULLS-NOT-DISTINCT (works on every Postgres version Supabase ships).
  UNIQUE (scope, account_id, role_family)
);

ALTER TABLE calibration_snapshots ENABLE ROW LEVEL SECURITY;

-- Read: an account sees its OWN account-scoped snapshots; every authenticated user may read
-- the GLOBAL anonymized aggregate (counts/rates only — no rows, no PII). Writes are
-- service-role only (calibrationService runs through supabaseAdmin), so there is intentionally
-- no INSERT/UPDATE/DELETE policy for `authenticated`.
DROP POLICY IF EXISTS cs_read ON calibration_snapshots;
CREATE POLICY cs_read ON calibration_snapshots FOR SELECT TO authenticated
  USING (account_id = auth.uid() OR (scope = 'global' AND role_family = '*'));

SELECT 'calibration_snapshots ready' AS status;
