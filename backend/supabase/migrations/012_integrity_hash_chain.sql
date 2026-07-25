-- 012: Hash-chained integrity signal log (foundation for pillar-2 proof-of-human)
-- Upgrades submission_integrity_events (created in 011) into a tamper-evident,
-- append-only, per-submission hash CHAIN. Every proof-of-human signal —
-- tab-hidden, paste, typed-vs-pasted, bot verdict, and later liveness/antispoof/
-- keystroke traces — appends here. The head row_hash is the submission's
-- signable trust digest, reused later to mint a portable verified credential.

ALTER TABLE submission_integrity_events
  ADD COLUMN IF NOT EXISTS seq        INT,
  ADD COLUMN IF NOT EXISTS category   TEXT,        -- proctoring | automation | provenance | liveness | antispoof | keystroke
  ADD COLUMN IF NOT EXISTS client_ts  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS server_ts  TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS prev_hash  TEXT,
  ADD COLUMN IF NOT EXISTS row_hash   TEXT;

CREATE INDEX IF NOT EXISTS idx_integrity_chain ON submission_integrity_events(submission_id, seq);

-- Append-only: integrity signals are evidence; never updated or deleted.
CREATE OR REPLACE FUNCTION submission_integrity_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'submission_integrity_events is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_integrity_immutable ON submission_integrity_events;
CREATE TRIGGER trg_integrity_immutable
  BEFORE UPDATE OR DELETE ON submission_integrity_events
  FOR EACH ROW EXECUTE FUNCTION submission_integrity_immutable();

SELECT 'integrity hash-chain ready' AS status;
