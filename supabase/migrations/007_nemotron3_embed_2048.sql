-- Switch embedding space from NVIDIA NIM nvidia/nv-embedqa-e5-v5 (1024-dim) to
-- nvidia/nemotron-3-embed-1b (2048-dim). nv-embedqa-e5-v5 is no longer available
-- on the current NIM account (410 Gone); nemotron-3-embed-1b is.
-- The runtime query embedder (lib/embeddings.ts) and ETL
-- (etl/constitution/embed.py) use the same model so vectors remain comparable.
--
-- NOTE: pgvector cannot index columns over 2000 dimensions (ivfflat or hnsw),
-- so the ANN index is dropped and NOT recreated. At ~464 statute nodes a
-- sequential scan is trivially fast; re-add an index only if the table grows
-- by orders of magnitude.

DROP INDEX IF EXISTS idx_statute_nodes_embedding;

ALTER TABLE statute_nodes
  ALTER COLUMN embedding TYPE vector(2048);

-- Recreate the search function with the new vector dimension.
DROP FUNCTION IF EXISTS search_constitution(vector, text[], integer);

CREATE OR REPLACE FUNCTION search_constitution(
  query_embedding  VECTOR(2048),
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

