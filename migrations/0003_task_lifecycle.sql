ALTER TABLE discovery_tasks ADD COLUMN lease_token TEXT;
ALTER TABLE discovery_tasks ADD COLUMN lease_expires_at TEXT;
ALTER TABLE discovery_tasks ADD COLUMN queue_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discovery_tasks ADD COLUMN last_error_kind TEXT;
ALTER TABLE discovery_tasks ADD COLUMN terminal_reason TEXT;
ALTER TABLE discovery_tasks ADD COLUMN completed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_claim
  ON discovery_tasks(status, lease_expires_at, updated_at);
