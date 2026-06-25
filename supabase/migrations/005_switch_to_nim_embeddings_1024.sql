-- Switch embedding space from OpenAI text-embedding-3-small (1536-dim) to
-- NVIDIA NIM nvidia/nv-embedqa-e5-v5 (1024-dim). The runtime query embedder
-- (lib/embeddings.ts) is changed to the same model so vectors remain comparable.
-- Safe: statute_nodes is empty at the time this runs (data is loaded afterwards).

DROP INDEX IF EXISTS idx_statute_nodes_embedding;

ALTER TABLE statute_nodes
  ALTER COLUMN embedding TYPE vector(1024);

CREATE INDEX idx_statute_nodes_embedding ON statute_nodes
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Recreate the search function with the new vector dimension.
DROP FUNCTION IF EXISTS search_constitution(vector, text[], integer);

CREATE OR REPLACE FUNCTION search_constitution(
  query_embedding  VECTOR(1024),
  filter_tags      TEXT[] DEFAULT NULL,
  match_count      INT DEFAULT 6
)
RETURNS TABLE (
  id          UUID,
  full_ref    TEXT,
  heading     TEXT,
  content     TEXT,
  tags        TEXT[],
  similarity  FLOAT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    id, full_ref, heading, content, tags,
    1 - (embedding <=> query_embedding) AS similarity
  FROM statute_nodes
  WHERE
    embedding IS NOT NULL
    AND (filter_tags IS NULL OR tags && filter_tags)
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
