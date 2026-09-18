-- Async chat jobs. Long NVIDIA NIM generations run as resumable steps so no
-- single Vercel Hobby invocation (60s) has to hold the whole agent loop.
CREATE TABLE chat_jobs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID NOT NULL REFERENCES sessions(id),
  -- pending = needs a worker; running = a worker holds it right now;
  -- done/failed = terminal.
  status      TEXT NOT NULL DEFAULT 'pending',
  stage       TEXT,                 -- queued | thinking | search_constitution | search_web | writing
  partial     TEXT NOT NULL DEFAULT '',  -- streamed answer text so far (live progress)
  state       JSONB NOT NULL DEFAULT '{}', -- resumable agent-loop state
  result      JSONB,                -- { content, sources } when done
  error       TEXT,
  attempts    INT NOT NULL DEFAULT 0,    -- consecutive failed/crashed worker runs
  heartbeat   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER chat_jobs_updated_at
  BEFORE UPDATE ON chat_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_chat_jobs_session ON chat_jobs(session_id);
