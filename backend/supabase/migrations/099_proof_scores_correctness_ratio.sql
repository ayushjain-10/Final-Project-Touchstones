-- 099_proof_scores_correctness_ratio.sql
-- Additive + nullable + idempotent (043 template). Applied MANUALLY by the founder.
-- Reversible. Inherits proof_scores RLS — no new policy.
--
-- The execution-measured hidden-test pass ratio (0..1) blended into the correctness criterion
-- when AI_SCORE_EXEC_GROUNDING is on. NULL = pure-LLM score (flag off, or no hidden tests / no
-- test_results for this submission). The 0-100 score remains computed in code in
-- proofScoringService.computeScore (the anti-injection invariant is preserved and strengthened:
-- for the one criterion we can execute, the measured value overrules the model).
--
-- Strictly-OPTIONAL: the same ratio is also written into proof_scores.per_criterion evidence, so
-- grounding functions with zero migration. This column exists for analytics + the external eval.

ALTER TABLE public.proof_scores
  ADD COLUMN IF NOT EXISTS correctness_ratio numeric;

COMMENT ON COLUMN public.proof_scores.correctness_ratio IS
  'Execution-measured hidden-test pass ratio (0..1) blended into the correctness criterion when AI_SCORE_EXEC_GROUNDING is on; NULL = pure-LLM score. The 0-100 remains code-computed.';

-- Rollback:
--   ALTER TABLE public.proof_scores DROP COLUMN IF EXISTS correctness_ratio;
