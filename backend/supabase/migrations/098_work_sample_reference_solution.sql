-- 098_work_sample_reference_solution.sql
-- Additive + nullable + idempotent (043 template). Applied MANUALLY by the founder.
-- Reversible. Inherits work_samples RLS (ws_owner_all, owner_id = auth.uid()) from 011 —
-- no new policy, no new table.
--
-- A VALIDATED reference solution used to execution-ground a screen's hidden tests: we run it
-- through codeExecutionService.runCases and keep only the cases it passes. This is distinct from
-- work_samples.baseline (035), which is a deliberately-WEAK one-shot agent attempt used to show
-- the human-vs-agent delta — NOT a canonical solution.
--
-- Shape: { content: string, language: 'python'|'javascript', entry_fn: string, validated_at: ts }

ALTER TABLE public.work_samples
  ADD COLUMN IF NOT EXISTS reference_solution jsonb;

COMMENT ON COLUMN public.work_samples.reference_solution IS
  '{content, language, entry_fn, validated_at} validated reference used to execution-ground hidden tests; distinct from work_samples.baseline (a deliberately-weak one-shot agent attempt). Work-product only.';

-- Rollback:
--   ALTER TABLE public.work_samples DROP COLUMN IF EXISTS reference_solution;
