-- ============================================
-- Feature 1: Proof-of-Skill Scored Work-Sample
-- ============================================
-- The verified-talent wedge. A candidate completes a real work sample; we grade
-- it with an LLM against a versioned rubric, compute the 0-100 score IN OUR CODE
-- (never from the model), and write an immutable audit row per decision.
-- Architectural rules: (1) model emits per-criterion points only; (2) scoring is
-- "blind" (no protected attributes in the decision path); (3) version + hash
-- everything that scores.

-- 1) work_samples — the task definition (recruiter-authored)
CREATE TABLE IF NOT EXISTS work_samples (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  job_id           UUID REFERENCES jobs(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  role_family      TEXT,
  prompt_md        TEXT NOT NULL,
  response_type    TEXT NOT NULL DEFAULT 'markdown',     -- markdown | code (code = Phase 2)
  language         TEXT,
  duration_minutes INT  NOT NULL DEFAULT 60,
  rubric           JSONB NOT NULL,                       -- { criteria: [{id, requirement, points_possible, weight, anchors}] }
  rubric_version   INT  NOT NULL DEFAULT 1,
  scoring_strategy TEXT NOT NULL DEFAULT 'weighted_sum', -- sum | avg | min | max | weighted_sum
  prompt_version   INT  NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'draft',        -- draft | published | archived
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_samples_owner ON work_samples(owner_id);

-- 2) work_sample_submissions — candidate's response
CREATE TABLE IF NOT EXISTS work_sample_submissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_sample_id UUID NOT NULL REFERENCES work_samples(id) ON DELETE CASCADE,
  candidate_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  job_id         UUID REFERENCES jobs(id) ON DELETE SET NULL,
  response_text  TEXT,
  response_code  TEXT,
  input_hash     TEXT,                                   -- sha256(response) — tamper-evidence
  started_at     TIMESTAMPTZ,
  deadline_at    TIMESTAMPTZ,                            -- server-enforced
  submitted_at   TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'assigned',       -- assigned | in_progress | submitted | scored | expired
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wss_work_sample ON work_sample_submissions(work_sample_id);
CREATE INDEX IF NOT EXISTS idx_wss_candidate ON work_sample_submissions(candidate_id);

-- 3) proof_scores — the scoring result (immutable, versioned; re-score supersedes, never overwrites)
CREATE TABLE IF NOT EXISTS proof_scores (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       UUID NOT NULL REFERENCES work_sample_submissions(id) ON DELETE CASCADE,
  rubric_version      INT  NOT NULL,
  prompt_version      INT  NOT NULL,
  model_id            TEXT NOT NULL,
  model_version       TEXT NOT NULL,
  scoring_method      TEXT NOT NULL DEFAULT 'llm',        -- llm | rules | human | hybrid
  normalized_score    INT  NOT NULL,                      -- 0-100, COMPUTED IN OUR CODE
  raw_points_awarded  NUMERIC NOT NULL,
  raw_points_possible NUMERIC NOT NULL,
  threshold_applied   INT,
  outcome             TEXT,                               -- advance | reject | review
  per_criterion       JSONB NOT NULL,
  self_consistency_n  INT  NOT NULL DEFAULT 1,
  score_variance      NUMERIC,
  injection_flag      BOOLEAN NOT NULL DEFAULT FALSE,
  human_override      BOOLEAN NOT NULL DEFAULT FALSE,
  human_reviewer_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  override_reason     TEXT,
  superseded_by       UUID REFERENCES proof_scores(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proof_scores_submission ON proof_scores(submission_id);

-- 4) proof_audit_log — immutable per-decision record (EU AI Act Art. 12/86, EEOC). No protected attributes.
CREATE TABLE IF NOT EXISTS proof_audit_log (
  decision_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_score_id     UUID NOT NULL REFERENCES proof_scores(id) ON DELETE CASCADE,
  candidate_id       UUID NOT NULL,
  job_id             UUID,
  work_sample_id     UUID NOT NULL,
  assessment_version INT  NOT NULL,
  event_ts_start     TIMESTAMPTZ NOT NULL,
  event_ts_end       TIMESTAMPTZ NOT NULL,
  model_id           TEXT NOT NULL,
  model_version      TEXT NOT NULL,
  rubric_version     INT  NOT NULL,
  prompt_version     INT  NOT NULL,
  scoring_method     TEXT NOT NULL,
  input_hash         TEXT NOT NULL,
  input_ref          TEXT,
  overall_score      INT  NOT NULL,
  normalized_score   INT  NOT NULL,
  threshold_applied  INT,
  outcome            TEXT,
  per_criterion      JSONB NOT NULL,
  human_reviewer_id  UUID,
  human_override     BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason    TEXT,
  created_by         TEXT NOT NULL DEFAULT 'proofScoringService',
  prev_row_hash      TEXT,
  row_hash           TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proof_audit_score ON proof_audit_log(proof_score_id);

-- Append-only enforcement: no UPDATE or DELETE on the audit log, ever.
CREATE OR REPLACE FUNCTION proof_audit_log_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'proof_audit_log is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_proof_audit_immutable ON proof_audit_log;
CREATE TRIGGER trg_proof_audit_immutable
  BEFORE UPDATE OR DELETE ON proof_audit_log
  FOR EACH ROW EXECUTE FUNCTION proof_audit_log_immutable();

-- 5) submission_integrity_events — soft signals (tab-blur, paste). Advisory only.
CREATE TABLE IF NOT EXISTS submission_integrity_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES work_sample_submissions(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,                            -- tab_blur | focus | paste
  meta          JSONB,
  ts            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_integrity_submission ON submission_integrity_events(submission_id);

-- 6) proof_demographics — SEPARATE, never joined into the scoring path. Service-role only.
CREATE TABLE IF NOT EXISTS proof_demographics (
  candidate_id   UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  sex            TEXT,
  race_ethnicity TEXT,
  declined       BOOLEAN DEFAULT FALSE,
  collected_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ---- RLS ----
ALTER TABLE work_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_sample_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE proof_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_integrity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE proof_demographics ENABLE ROW LEVEL SECURITY;
ALTER TABLE proof_audit_log ENABLE ROW LEVEL SECURITY;

-- Recruiters manage their own work samples
DROP POLICY IF EXISTS ws_owner_all ON work_samples;
CREATE POLICY ws_owner_all ON work_samples FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Candidates see/edit their own submissions; recruiters see submissions to their work samples
DROP POLICY IF EXISTS wss_candidate ON work_sample_submissions;
CREATE POLICY wss_candidate ON work_sample_submissions FOR ALL
  USING (candidate_id = auth.uid()
         OR EXISTS (SELECT 1 FROM work_samples w WHERE w.id = work_sample_submissions.work_sample_id AND w.owner_id = auth.uid()))
  WITH CHECK (candidate_id = auth.uid());

-- Recruiters read scores for their work samples' submissions
DROP POLICY IF EXISTS ps_recruiter ON proof_scores;
CREATE POLICY ps_recruiter ON proof_scores FOR SELECT
  USING (EXISTS (SELECT 1 FROM work_sample_submissions s
                 JOIN work_samples w ON w.id = s.work_sample_id
                 WHERE s.id = proof_scores.submission_id AND (w.owner_id = auth.uid() OR s.candidate_id = auth.uid())));

-- Candidates write/read their own integrity events
DROP POLICY IF EXISTS ie_candidate ON submission_integrity_events;
CREATE POLICY ie_candidate ON submission_integrity_events FOR ALL
  USING (EXISTS (SELECT 1 FROM work_sample_submissions s WHERE s.id = submission_integrity_events.submission_id AND s.candidate_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM work_sample_submissions s WHERE s.id = submission_integrity_events.submission_id AND s.candidate_id = auth.uid()));

-- proof_audit_log + proof_demographics: no end-user policies (service role / audit worker only)
DROP POLICY IF EXISTS demo_self ON proof_demographics;
CREATE POLICY demo_self ON proof_demographics FOR ALL USING (candidate_id = auth.uid()) WITH CHECK (candidate_id = auth.uid());

SELECT 'Feature 1 schema (proof-of-skill) ready' AS status;
