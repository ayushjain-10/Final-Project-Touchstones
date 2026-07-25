-- ============================================================================
-- 014_pgvector.sql — Semantic candidate matching via pgvector
-- ============================================================================
-- Enables the `vector` extension and adds an embedding column on
-- candidate_submissions plus a cosine-distance semantic-search RPC.
--
-- Dimensionality: 1536 (matches OpenAI text-embedding-3-small and the local
-- hashing-bag fallback in embeddingService.js; Voyage voyage-3 is requested with
-- output_dimension=1536). Keep this in sync with EMBEDDING_DIM in embeddingService.js.
--
-- This is ADDITIVE and OPTIONAL: existing matching is untouched. Rows have a NULL
-- embedding until embeddingService backfills them.
-- ============================================================================

-- 1. Extension (Supabase ships pgvector; this is a no-op if already enabled).
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Embedding column on candidate_submissions.
ALTER TABLE candidate_submissions
    ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Track which model produced the embedding (provider/version), so a future
-- re-embed can target only stale rows.
ALTER TABLE candidate_submissions
    ADD COLUMN IF NOT EXISTS embedding_model TEXT;

ALTER TABLE candidate_submissions
    ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;

-- 3. ANN index for cosine distance. ivfflat needs ANALYZE/data to be effective;
--    safe to create on an empty/low-row table (lists kept modest).
CREATE INDEX IF NOT EXISTS idx_candidate_submissions_embedding
    ON candidate_submissions
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- 4. Semantic search RPC. SECURITY INVOKER so RLS still applies (callers only
--    see rows they own / are shared). Returns rows ordered by cosine similarity.
--    `query_embedding` is passed as a 1536-d float array from the app.
CREATE OR REPLACE FUNCTION match_candidate_submissions(
    query_embedding vector(1536),
    match_count INT DEFAULT 10,
    similarity_threshold FLOAT DEFAULT 0.0
)
RETURNS TABLE (
    id UUID,
    full_name TEXT,
    email TEXT,
    desired_roles TEXT,
    skills TEXT[],
    summary TEXT,
    similarity FLOAT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    SELECT
        cs.id,
        cs.full_name,
        cs.email,
        cs.desired_roles,
        cs.skills,
        cs.summary,
        1 - (cs.embedding <=> query_embedding) AS similarity
    FROM candidate_submissions cs
    WHERE cs.embedding IS NOT NULL
      AND 1 - (cs.embedding <=> query_embedding) >= similarity_threshold
    ORDER BY cs.embedding <=> query_embedding
    LIMIT match_count;
$$;
