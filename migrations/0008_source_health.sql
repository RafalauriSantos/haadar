CREATE TABLE IF NOT EXISTS source_health (
  source_id TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_failure_kind TEXT,
  paused_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_health_paused_until
  ON source_health(paused_until);
