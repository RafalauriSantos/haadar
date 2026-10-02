CREATE TABLE source_canary_samples (
  task_id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  round_id TEXT NOT NULL,
  observed_count INTEGER NOT NULL CHECK (observed_count >= 0),
  observed_at TEXT NOT NULL
);

CREATE INDEX idx_source_canary_baseline
  ON source_canary_samples(source_key, observed_at DESC, task_id DESC);

CREATE INDEX idx_source_canary_retention
  ON source_canary_samples(observed_at, task_id);
