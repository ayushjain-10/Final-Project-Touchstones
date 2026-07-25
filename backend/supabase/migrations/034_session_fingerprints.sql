-- 034_session_fingerprints.sql
-- Cross-session correlation layer (NON-BIOMETRIC). One coarse, hashed
-- session-context row per submission so the recruiter REVIEW signal can spot when
-- the SAME recruiter's submissions from DIFFERENT candidates share a device/network
-- context (one-person-many-identities / collusion). This is advisory only — it
-- never auto-rejects, never accuses, and stores NO raw IP and NO biometrics.
--
-- What we store (all coarse / hashed, server-observed):
--   ip_hash         sha256(salt + client IP)   — equality only, IP not recoverable
--   ip_prefix       first 3 octets (/24)        — coarse network proximity, or NULL
--   ua_hash         sha256(user-agent)          — equality only, UA not recoverable
--   accept_language + tz_offset                 — locale/timezone context
-- The salt (SESSION_FINGERPRINT_SALT) lives only in app env, so even with table
-- access an attacker cannot dictionary-reverse the ip_hash to a raw address.
--
-- Conventions mirrored: 011 (work_sample_submissions ownership join — candidate-self
-- OR work_sample owner), 016/030 (RLS enabled, SECURITY DEFINER + pinned search_path).
-- Writes are service-role only (the backend upserts via supabaseAdmin); there is NO
-- candidate read and NO candidate write policy.

CREATE TABLE IF NOT EXISTS session_fingerprints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID NOT NULL REFERENCES work_sample_submissions(id) ON DELETE CASCADE,
  ip_hash         TEXT,                       -- sha256(salt + client IP); NEVER the raw IP
  ip_prefix       TEXT,                       -- first 3 octets (/24), or NULL when unknown / IPv6
  ua_hash         TEXT,                       -- sha256(user-agent)
  accept_language TEXT,
  tz_offset       INT,                        -- minutes offset from UTC, candidate-reported
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (submission_id)                      -- one fingerprint per submission (first event wins)
);

-- Correlation lookups scan by these hashes across a recruiter's submissions.
CREATE INDEX IF NOT EXISTS idx_session_fp_ip_hash   ON session_fingerprints(ip_hash);
CREATE INDEX IF NOT EXISTS idx_session_fp_ip_prefix ON session_fingerprints(ip_prefix);
CREATE INDEX IF NOT EXISTS idx_session_fp_ua_hash   ON session_fingerprints(ua_hash);

-- ---- RLS ----
-- Enabled with a SINGLE owner-SELECT policy: only the recruiter who owns the
-- submission's work_sample may read a fingerprint row (EXISTS join through
-- work_sample_submissions -> work_samples.owner_id = auth.uid()). There is NO
-- candidate-read policy and NO INSERT/UPDATE/DELETE policy — the backend writes
-- exclusively through the service-role client (supabaseAdmin), which bypasses RLS.
ALTER TABLE session_fingerprints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sf_owner_select ON session_fingerprints;
CREATE POLICY sf_owner_select ON session_fingerprints
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM work_sample_submissions s
      JOIN work_samples w ON w.id = s.work_sample_id
      WHERE s.id = session_fingerprints.submission_id
        AND w.owner_id = auth.uid()
    )
  );

SELECT 'Feature: session_fingerprints (cross-session correlation) ready' AS status;
