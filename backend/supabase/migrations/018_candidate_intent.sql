-- 018_candidate_intent.sql
-- The intent layer — the first-party "who wants a job today" signal that scrapers
-- (Gem/hireEZ) cannot buy. Adds intent signals to candidate_submissions, a computed
-- intent_score, an opt-in `discoverable` flag for the cross-recruiter pool, and a
-- PII-safe pool_search() RPC.
--
-- Privacy design: the pool is exposed ONLY through a SECURITY DEFINER function that
-- returns masked, non-PII columns (no email/phone; name -> "First L."). RLS on the
-- base table is unchanged, so a recruiter cannot read another recruiter's rows
-- directly via REST — contact reveal is a separate (paid) action, not this search.

-- ---------------------------------------------------------------------------
-- 1. Intent signal columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.candidate_submissions
  ADD COLUMN IF NOT EXISTS availability        text    DEFAULT 'unknown',  -- open_now | open_casual | not_looking | unknown
  ADD COLUMN IF NOT EXISTS target_seniority    text,                       -- junior | mid | senior | staff | lead
  ADD COLUMN IF NOT EXISTS remote_preference   text,                       -- remote | hybrid | onsite | flexible
  ADD COLUMN IF NOT EXISTS desired_comp_min    integer,
  ADD COLUMN IF NOT EXISTS discoverable        boolean DEFAULT false,      -- candidate opt-in to the recruiter pool
  ADD COLUMN IF NOT EXISTS intent_score        integer DEFAULT 0,          -- 0-100, computed from signals
  ADD COLUMN IF NOT EXISTS intent_signals      jsonb   DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS intent_updated_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_active_at       timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Backfill existing rows so the pool is usable immediately.
--    last_active_at <- best available activity timestamp.
--    discoverable  <- consented candidates (reversible opt-out anytime).
--    intent_score  <- same weighting the JS intentService uses (availability 40 /
--                     recency 35 / completeness 25), so SQL backfill == app writes.
-- ---------------------------------------------------------------------------
UPDATE public.candidate_submissions
SET last_active_at = COALESCE(last_active_at, last_pipeline_activity, updated_at, created_at);

UPDATE public.candidate_submissions
SET discoverable = true
WHERE consent_given = true AND discoverable = false;

UPDATE public.candidate_submissions
SET intent_score = LEAST(100, GREATEST(0,
      CASE COALESCE(availability, 'unknown')
        WHEN 'open_now' THEN 40 WHEN 'open_casual' THEN 22 WHEN 'not_looking' THEN 0 ELSE 10 END
    + CASE
        WHEN COALESCE(last_active_at, updated_at, created_at) > now() - interval '2 days'  THEN 35
        WHEN COALESCE(last_active_at, updated_at, created_at) > now() - interval '7 days'  THEN 25
        WHEN COALESCE(last_active_at, updated_at, created_at) > now() - interval '14 days' THEN 15
        WHEN COALESCE(last_active_at, updated_at, created_at) > now() - interval '30 days' THEN 7
        ELSE 2 END
    + CASE WHEN resume_text IS NOT NULL AND length(resume_text) > 50 THEN 10 ELSE 0 END
    + CASE WHEN array_length(skills, 1) >= 3 THEN 8 ELSE 0 END
    + CASE WHEN desired_roles IS NOT NULL AND length(desired_roles) > 0 THEN 4 ELSE 0 END
    + CASE WHEN domain IS NOT NULL AND length(domain) > 0 THEN 3 ELSE 0 END
    )),
    intent_updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. Indexes for pool search (filter by discoverable, sort by intent).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cs_pool_discoverable
  ON public.candidate_submissions (discoverable, intent_score DESC)
  WHERE discoverable = true;
CREATE INDEX IF NOT EXISTS idx_cs_availability ON public.candidate_submissions (availability);

-- ---------------------------------------------------------------------------
-- 4. PII-safe pool search. SECURITY DEFINER so it can read across recruiters,
--    but it returns ONLY masked/non-PII columns. search_path pinned. Execute
--    granted to authenticated (recruiters) + service_role; revoked from public/anon.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pool_search(
  p_query      text    DEFAULT NULL,
  p_seniority  text    DEFAULT NULL,
  p_location   text    DEFAULT NULL,
  p_remote     text    DEFAULT NULL,
  p_min_intent integer DEFAULT 0,
  p_open_now   boolean DEFAULT false,
  p_limit      integer DEFAULT 50
)
RETURNS TABLE (
  id                uuid,
  display_name      text,
  location          text,
  desired_roles     text,
  domain            text,
  skills            text[],
  target_seniority  text,
  remote_preference text,
  availability      text,
  intent_score      integer,
  last_active_at    timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    cs.id,
    -- Mask to "First L." — full contact reveal is a separate (paid) action.
    COALESCE(NULLIF(split_part(cs.full_name, ' ', 1), ''), 'Candidate')
      || CASE WHEN position(' ' IN COALESCE(cs.full_name, '')) > 0
              THEN ' ' || left(split_part(cs.full_name, ' ', 2), 1) || '.'
              ELSE '' END AS display_name,
    cs.location, cs.desired_roles, cs.domain, cs.skills,
    cs.target_seniority, cs.remote_preference, cs.availability,
    cs.intent_score, cs.last_active_at
  FROM public.candidate_submissions cs
  WHERE cs.discoverable = true
    AND cs.intent_score >= COALESCE(p_min_intent, 0)
    AND (NOT COALESCE(p_open_now, false) OR cs.availability = 'open_now')
    AND (p_seniority IS NULL OR cs.target_seniority = p_seniority)
    AND (p_location  IS NULL OR cs.location ILIKE '%' || p_location || '%')
    AND (p_remote    IS NULL OR cs.remote_preference = p_remote OR cs.remote_preference = 'flexible')
    AND (p_query IS NULL OR
         cs.desired_roles ILIKE '%' || p_query || '%' OR
         cs.domain        ILIKE '%' || p_query || '%' OR
         cs.summary       ILIKE '%' || p_query || '%' OR
         EXISTS (SELECT 1 FROM unnest(cs.skills) sk WHERE sk ILIKE '%' || p_query || '%'))
  ORDER BY cs.intent_score DESC, cs.last_active_at DESC NULLS LAST
  LIMIT LEAST(COALESCE(p_limit, 50), 200);
$$;

REVOKE ALL    ON FUNCTION public.pool_search(text,text,text,text,integer,boolean,integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pool_search(text,text,text,text,integer,boolean,integer) TO authenticated, service_role;
