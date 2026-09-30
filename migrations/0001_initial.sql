CREATE TABLE IF NOT EXISTS discovery_rounds (
  id TEXT PRIMARY KEY,
  round_slot TEXT NOT NULL UNIQUE,
  scheduled_at TEXT NOT NULL,
  portfolio_revision TEXT NOT NULL,
  budget_state TEXT NOT NULL CHECK (budget_state IN ('NORMAL', 'CONSERVATIVE', 'ESSENTIAL', 'EMERGENCY')),
  status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'completed', 'partial', 'deferred')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_tasks (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES discovery_rounds(id),
  query_id TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'retryable', 'terminal')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  source_vacancy_id TEXT,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  organization TEXT,
  location TEXT,
  work_model TEXT NOT NULL DEFAULT 'unknown',
  description_summary TEXT,
  published_at TEXT,
  observed_at TEXT NOT NULL,
  query_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  persisted_at TEXT NOT NULL,
  UNIQUE (source_id, source_vacancy_id),
  UNIQUE (canonical_url),
  UNIQUE (fingerprint)
);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL REFERENCES observations(id),
  rule_version TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operational_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  round_id TEXT,
  task_id TEXT,
  query_id TEXT,
  adapter_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  created_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  usage_day TEXT NOT NULL,
  service TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_round_status ON discovery_tasks(round_id, status);
CREATE INDEX IF NOT EXISTS idx_observations_source_observed ON observations(source_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_events_created ON operational_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_day_service ON usage_ledger(usage_day, service);
