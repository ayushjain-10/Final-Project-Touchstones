-- 028_direct_ai_replay.sql — "Direct the AI" (the headline 2026-native signal).
-- We capture HOW a candidate prompts AI during a work sample and whether they catch
-- the AI's mistakes, then score it as a dimension. The transcript is append-only and
-- owner-scoped; the direction score is computed IN CODE from model-emitted points
-- (same anti-injection invariant as proof scoring).

-- ── The AI-interaction transcript (the "replay") ──
CREATE TABLE IF NOT EXISTS ai_interactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES work_sample_submissions(id) ON DELETE CASCADE,
  seq           INT  NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content       TEXT NOT NULL,
  -- optional: did the candidate accept/edit/reject what the AI produced
  disposition   TEXT CHECK (disposition IN ('accepted','edited','rejected') OR disposition IS NULL),
  client_ts     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (submission_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_submission ON ai_interactions(submission_id, seq);
ALTER TABLE ai_interactions ENABLE ROW LEVEL SECURITY;

-- The candidate owning the submission appends their own transcript.
DROP POLICY IF EXISTS ai_int_candidate_insert ON ai_interactions;
CREATE POLICY ai_int_candidate_insert ON ai_interactions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM work_sample_submissions s
    WHERE s.id = submission_id AND s.candidate_id = auth.uid()
  ));

-- Candidate reads their own; recruiter reads via work-sample ownership (the replay UI).
DROP POLICY IF EXISTS ai_int_read ON ai_interactions;
CREATE POLICY ai_int_read ON ai_interactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM work_sample_submissions s
            WHERE s.id = submission_id AND s.candidate_id = auth.uid())
    OR EXISTS (SELECT 1 FROM work_sample_submissions s
               JOIN work_samples w ON w.id = s.work_sample_id
               WHERE s.id = submission_id AND w.owner_id = auth.uid())
  );

-- ── The direction score (computed in code from model-emitted points) ──
CREATE TABLE IF NOT EXISTS ai_direction_scores (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id      UUID NOT NULL REFERENCES work_sample_submissions(id) ON DELETE CASCADE,
  prompt_quality     INT,   -- 0..100 how specific/iterative the prompting was
  error_catching     INT,   -- 0..100 did they detect/correct the AI's mistakes
  verification_rigor INT,   -- 0..100 did they verify outputs vs. blindly accept
  direction_score    INT,   -- 0..100 computed-in-code weighted blend
  interaction_count  INT,
  per_dimension      JSONB, -- evidence + points per dimension (model output, validated)
  reasoning          TEXT,
  model_id           TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_direction_submission ON ai_direction_scores(submission_id);
ALTER TABLE ai_direction_scores ENABLE ROW LEVEL SECURITY;

-- Read by the recruiter (work-sample owner) or the candidate; written by the server
-- (service-role) — the route enforces the ownership gate before scoring.
DROP POLICY IF EXISTS ai_dir_read ON ai_direction_scores;
CREATE POLICY ai_dir_read ON ai_direction_scores
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM work_sample_submissions s
            WHERE s.id = submission_id AND s.candidate_id = auth.uid())
    OR EXISTS (SELECT 1 FROM work_sample_submissions s
               JOIN work_samples w ON w.id = s.work_sample_id
               WHERE s.id = submission_id AND w.owner_id = auth.uid())
  );

COMMENT ON TABLE ai_interactions IS 'Direct-the-AI replay: append-only transcript of the candidate''s AI usage during a work sample.';
COMMENT ON TABLE ai_direction_scores IS 'AI-direction score (prompt quality + error-catching), computed in code from model-emitted points.';

SELECT 'direct_ai_replay ready' AS status;
