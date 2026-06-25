-- Indian Constitution, structured hierarchically.
-- Part → Article → Clause. Each leaf node is independently embeddable and citable.
CREATE TABLE statute_nodes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  act          TEXT NOT NULL DEFAULT 'constitution',
  part         TEXT,                  -- 'III', 'IV', 'XII' etc.
  section_num  TEXT,                  -- Article number: '21', '300A', '14'
  clause       TEXT,                  -- Sub-clause: '1', '1a', '2' etc.
  heading      TEXT NOT NULL,
  full_ref     TEXT NOT NULL UNIQUE,  -- Cite-ready: 'Article 21, Constitution of India'
  content      TEXT NOT NULL,
  embedding    VECTOR(1536),
  tags         TEXT[] DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_statute_nodes_act       ON statute_nodes(act);
CREATE INDEX idx_statute_nodes_tags      ON statute_nodes USING GIN(tags);
CREATE INDEX idx_statute_nodes_embedding ON statute_nodes
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);