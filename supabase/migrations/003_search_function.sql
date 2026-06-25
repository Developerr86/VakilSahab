-- Hybrid search: semantic similarity + optional tag filter
-- Called by the search_constitution agent tool at runtime
CREATE OR REPLACE FUNCTION search_constitution(
  query_embedding  VECTOR(1536),
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