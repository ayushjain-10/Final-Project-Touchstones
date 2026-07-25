-- 064_compliance_report_snapshots.sql — CC1 Compliance & Adverse-Impact.
-- ============================================================================================
-- A persisted audit record of each four-fifths adverse-impact analysis the employer ran: the
-- per-group counts/rates, the impact ratios, the sample floor, and when it was computed. This is
-- the "we ran this analysis on date X" artifact for an LL-144 / disparate-impact review. It holds
-- ONLY anonymized aggregate counts + rates — never an individual's label, never PII.
--
-- SECURITY: owner-only READ (account_id = auth.uid()); writes are service-role ONLY (the analysis
-- is computed server-side from the segregated labels + outcomes — never client-supplied), so there
-- is intentionally NO insert/update/delete policy for `authenticated`. No anon access.
--
-- NOT applied by this file — the founder/Management API applies migrations.

CREATE TABLE IF NOT EXISTS public.compliance_report_snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_family      TEXT NOT NULL,
  attribute        TEXT NOT NULL,
  selected_outcome TEXT NOT NULL,    -- 'advanced' | 'got_offer' | 'hired'
  groups           JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{value,n,selected,rate,impact_ratio,insufficient}]
  reference_value  TEXT,             -- the highest-rate (reference) group, when computable
  total_n          INT NOT NULL DEFAULT 0,
  groups_total     INT NOT NULL DEFAULT 0,
  min_group_sample INT NOT NULL DEFAULT 0,  -- the floor applied (documented, tunable)
  flagged          BOOLEAN NOT NULL DEFAULT FALSE,      -- any sufficient group impact_ratio < 0.80
  insufficient     BOOLEAN NOT NULL DEFAULT FALSE,      -- not enough data to compute a comparison
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, role_family, attribute, selected_outcome)  -- one latest snapshot per analysis; upsert target
);

CREATE INDEX IF NOT EXISTS idx_crs_account ON public.compliance_report_snapshots (account_id, computed_at DESC);

ALTER TABLE public.compliance_report_snapshots ENABLE ROW LEVEL SECURITY;

-- Owner-only READ. Writes are service-role only (no authenticated write policy on purpose).
DROP POLICY IF EXISTS crs_owner_select ON public.compliance_report_snapshots;
CREATE POLICY crs_owner_select ON public.compliance_report_snapshots
  FOR SELECT TO authenticated USING (account_id = auth.uid());

REVOKE ALL ON public.compliance_report_snapshots FROM anon;

SELECT 'compliance_report_snapshots ready (owner-read, service-role write)' AS status;
