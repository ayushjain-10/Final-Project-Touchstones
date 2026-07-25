-- 020_integrity_source_enum.sql  (roadmap #6)
-- The trust digest must weight ONLY signals the candidate cannot self-author. A
-- value the subject can write (today they can POST their own bot_verdict:false) is
-- worthless as proof. We constrain submission_integrity_events.source to a two-value
-- domain — 'client_attested' (display-only) vs 'server_observed' (digest-weighted) —
-- and backfill every existing row to 'client_attested'.
--
-- Note: 015_liveness.sql already added a free-text `source` column with provisional
-- values ('client' | 'server:liveness'). This migration normalizes those legacy
-- values into the new enum and only THEN applies the CHECK, so the constraint can be
-- validated against existing data. Expand/contract safe: the column already exists;
-- code that reads `source` keeps working, code that writes it now uses the enum.

-- 1) Normalize legacy/null values written before the enum existed.
--    Anything server-issued (the liveness challenge marker stamped 'server:...') is a
--    server-observed signal; everything else (raw client telemetry, NULL) is
--    client-attested until a server-side path explicitly stamps it 'server_observed'.
UPDATE submission_integrity_events
SET source = CASE
               WHEN source LIKE 'server%' THEN 'server_observed'
               ELSE 'client_attested'
             END
WHERE source IS NULL
   OR source NOT IN ('client_attested', 'server_observed');

-- 2) Default + NOT NULL: new rows are client-attested (display-only) unless a trusted
--    server path elevates them. The append fn (021) sets this explicitly.
ALTER TABLE submission_integrity_events
  ALTER COLUMN source SET DEFAULT 'client_attested';

ALTER TABLE submission_integrity_events
  ALTER COLUMN source SET NOT NULL;

-- 3) Constrain to the two-value domain. NOT VALID first (does not lock-scan the table
--    or block concurrent writers), then VALIDATE — the rows are already normalized in
--    step 1, so validation succeeds. This keeps the migration backward-compatible with
--    currently-running code per the expand/contract rule.
ALTER TABLE submission_integrity_events
  DROP CONSTRAINT IF EXISTS chk_integrity_source;
ALTER TABLE submission_integrity_events
  ADD CONSTRAINT chk_integrity_source
  CHECK (source IN ('client_attested', 'server_observed')) NOT VALID;
ALTER TABLE submission_integrity_events
  VALIDATE CONSTRAINT chk_integrity_source;

COMMENT ON COLUMN submission_integrity_events.source IS
  'Trust attribution: client_attested (subject-authored, display-only) | server_observed (server-bound, the ONLY rows the trust digest weights). See SYSTEM_DESIGN §2b.';

SELECT 'integrity source enum (client_attested|server_observed) ready' AS status;
