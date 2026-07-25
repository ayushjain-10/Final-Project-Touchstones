-- 043_proof_scores_explanation.sql — persist the score's headline reasoning.
--
-- proofScoringService computes a holistic `overall_explanation` (the LLM's 2-sentence summary of
-- why the candidate got this score) and returns it on POST /score, but there was NO column to store
-- it — so GET /api/proof/scores/:id and the cached-rescore path returned it EMPTY, and the result
-- card lost its headline reasoning on any refetch. (Per-criterion reasoning/evidence is already
-- persisted in proof_scores.per_criterion; this only adds the overall summary.)
--
-- Additive + nullable + idempotent: safe to apply to a running system. Existing/old code that omits
-- the column simply writes NULL; the new backend code (claude-1) populates it. No data migration.
--
-- NOT applied by this file — the founder/lead applies migrations manually. See the contract doc.

ALTER TABLE public.proof_scores
  ADD COLUMN IF NOT EXISTS overall_explanation TEXT;

COMMENT ON COLUMN public.proof_scores.overall_explanation IS
  'Holistic 2-sentence reasoning for the score (LLM-generated, aggregated across self-consistency samples). Persisted so GET /scores/:id and cached re-scores return the headline reasoning, not just per-criterion detail.';

SELECT 'proof_scores.overall_explanation ready' AS status;
