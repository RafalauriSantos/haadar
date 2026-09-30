CREATE TABLE IF NOT EXISTS decision_records (
  id TEXT PRIMARY KEY,
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id),
  query_id TEXT NOT NULL,
  gate_rule_version TEXT NOT NULL,
  gate_eligible INTEGER NOT NULL CHECK (gate_eligible IN (0, 1)),
  gate_reason TEXT NOT NULL,
  score_rule_version TEXT NOT NULL,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  score_features_json TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('alert', 'discard')),
  decision_rule_version TEXT NOT NULL,
  decision_reason TEXT NOT NULL,
  early_signal_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_intents (
  idempotency_key TEXT PRIMARY KEY,
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id),
  decision_id TEXT NOT NULL REFERENCES decision_records(id),
  channel TEXT NOT NULL,
  destination_key TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('provisional', 'final')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  payload_json TEXT NOT NULL,
  early_signal_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT,
  UNIQUE (vacancy_id, channel, destination_key)
);

CREATE INDEX IF NOT EXISTS idx_decisions_vacancy_created
  ON decision_records(vacancy_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_intents_status_created
  ON alert_intents(status, created_at);
