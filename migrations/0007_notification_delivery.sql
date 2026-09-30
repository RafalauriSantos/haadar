CREATE TABLE IF NOT EXISTS notification_deliveries (
  intent_key TEXT PRIMARY KEY REFERENCES alert_intents(idempotency_key),
  state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'sent', 'retryable', 'failed', 'unknown')),
  lease_token TEXT,
  lease_expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  provider_message_id TEXT,
  last_error_kind TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_claim
  ON notification_deliveries(state, next_attempt_at, lease_expires_at);
