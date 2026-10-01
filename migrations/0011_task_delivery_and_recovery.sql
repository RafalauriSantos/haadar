ALTER TABLE discovery_tasks ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'live'
  CHECK (delivery_mode IN ('live', 'silent'));

CREATE INDEX IF NOT EXISTS idx_tasks_expired_lease
  ON discovery_tasks(status, lease_expires_at, updated_at);
