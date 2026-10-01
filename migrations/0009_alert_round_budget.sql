CREATE TABLE IF NOT EXISTS alert_round_budget (
  round_id TEXT PRIMARY KEY REFERENCES discovery_rounds(id),
  admitted_count INTEGER NOT NULL DEFAULT 0,
  limit_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
