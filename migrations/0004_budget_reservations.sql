CREATE TABLE IF NOT EXISTS budget_reservations (
  round_id TEXT PRIMARY KEY,
  usage_day TEXT NOT NULL,
  workers_requests INTEGER NOT NULL,
  queue_operations INTEGER NOT NULL,
  d1_rows_read INTEGER NOT NULL,
  d1_rows_written INTEGER NOT NULL,
  workflow_steps INTEGER NOT NULL,
  ai_neurons INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'consumed', 'released')),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_budget_reservations_day_status
  ON budget_reservations(usage_day, status);

ALTER TABLE usage_ledger ADD COLUMN measurement_kind TEXT NOT NULL DEFAULT 'measured'
  CHECK (measurement_kind IN ('measured', 'estimated'));
