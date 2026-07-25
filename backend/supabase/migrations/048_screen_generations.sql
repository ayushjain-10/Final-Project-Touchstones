-- 048_screen_generations.sql — "Author with AI" generation log (CC2 / S2).
--
-- A lightweight, append-only log of AI screen generations for analytics + abuse
-- control. We store only a HASH of the input (not the raw JD/snippet) plus the
-- generated draft. The saved screen still lives in `work_samples` (no change there);
-- this table is purely the generation audit/analytics trail.
--
-- RLS: owner manages own rows (account_id = auth.uid()), matching the api_keys /
-- work_samples convention. The route writes via the user's RLS-scoped client.
--
-- NOT applied by this file — the founder/lead applies migrations manually via the
-- Supabase Management API.

CREATE TABLE IF NOT EXISTS public.screen_generations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  input_kind  TEXT NOT NULL CHECK (input_kind IN ('jd', 'repo', 'snippet')),
  input_hash  TEXT NOT NULL,            -- sha256(raw input) hex — raw text is never stored
  output      JSONB,                    -- the generated draft work-sample
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "My recent generations", newest first.
CREATE INDEX IF NOT EXISTS idx_screen_generations_account
  ON public.screen_generations (account_id, created_at DESC);

-- Coarse abuse/dedupe signal: same account regenerating the same input.
CREATE INDEX IF NOT EXISTS idx_screen_generations_input_hash
  ON public.screen_generations (account_id, input_hash);

ALTER TABLE public.screen_generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS screen_generations_owner_select ON public.screen_generations;
CREATE POLICY screen_generations_owner_select ON public.screen_generations
  FOR SELECT TO authenticated
  USING (account_id = auth.uid());

DROP POLICY IF EXISTS screen_generations_owner_insert ON public.screen_generations;
CREATE POLICY screen_generations_owner_insert ON public.screen_generations
  FOR INSERT TO authenticated
  WITH CHECK (account_id = auth.uid());

COMMENT ON TABLE public.screen_generations IS
  'Author-with-AI generation log (CC2/S2). Stores sha256(input) + generated draft for analytics/abuse-control. Saved screens live in work_samples. RLS: owner-only (account_id = auth.uid()).';
