-- 025_proof_consent.sql  (roadmap #16 — schema only, behavioral-only MVP)
-- Build the legal schema BEFORE the first raw biometric signal is ever capturable.
-- At MVP we ship behavioral-only (tab focus, paste, typed-vs-pasted) so the whole
-- BIPA/GDPR Art.9/LL-144/EU AI Act surface is AVOIDED, not mitigated. But the consent
-- ledger has to exist first so that the day a `face` or `keystroke` modality could turn
-- on, per-modality, withdrawable, versioned consent is already enforceable.
--
-- One row per (candidate, modality) consent grant; withdrawal is recorded by stamping
-- withdrawn_at (the row is retained as evidence of when consent existed — append-style,
-- not deleted). The insert fn that captures any biometric modality must check for a
-- current (granted, not withdrawn) row here, not just app code (SYSTEM_DESIGN §3).
--
-- NOTE: proof_scores already carries human_reviewer_id (the adverse-override reviewer,
-- 011_proof_work_samples), so we intentionally do NOT add another here — no duplication.

CREATE TABLE IF NOT EXISTS proof_consent (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  modality        TEXT NOT NULL CHECK (modality IN ('behavioral','face','keystroke')),
  consent_version TEXT NOT NULL,
  granted_at      TIMESTAMPTZ DEFAULT NOW(),
  withdrawn_at    TIMESTAMPTZ,                 -- NULL = active consent
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proof_consent_candidate ON proof_consent(candidate_id);

-- updated_at trigger — same convention as every other mutable table.
DROP TRIGGER IF EXISTS update_proof_consent_updated_at ON proof_consent;
CREATE TRIGGER update_proof_consent_updated_at
  BEFORE UPDATE ON proof_consent
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE proof_consent IS
  'Per-modality, withdrawable, versioned consent ledger (SYSTEM_DESIGN §4/§3). MVP is behavioral-only; face/keystroke never enabled until enforced against a granted row here.';

-- ---- RLS: a candidate manages ONLY their own consent rows ----
ALTER TABLE proof_consent ENABLE ROW LEVEL SECURITY;

-- Read own consent (so a candidate can see/confirm what they have granted/withdrawn).
DROP POLICY IF EXISTS consent_self_select ON proof_consent;
CREATE POLICY consent_self_select ON proof_consent
  FOR SELECT
  TO authenticated
  USING (candidate_id = auth.uid());

-- Grant (insert) own consent.
DROP POLICY IF EXISTS consent_self_insert ON proof_consent;
CREATE POLICY consent_self_insert ON proof_consent
  FOR INSERT
  TO authenticated
  WITH CHECK (candidate_id = auth.uid());

-- Withdraw own consent (UPDATE, e.g. set withdrawn_at). Both USING and WITH CHECK pin
-- the row to the subject so a candidate can only ever touch their own consent.
DROP POLICY IF EXISTS consent_self_withdraw ON proof_consent;
CREATE POLICY consent_self_withdraw ON proof_consent
  FOR UPDATE
  TO authenticated
  USING (candidate_id = auth.uid())
  WITH CHECK (candidate_id = auth.uid());

-- No DELETE policy: consent history is evidence (withdrawal = stamp withdrawn_at, not
-- delete). Service-role can still read/aggregate by bypassing RLS.

SELECT 'proof_consent (per-modality consent ledger) ready' AS status;
