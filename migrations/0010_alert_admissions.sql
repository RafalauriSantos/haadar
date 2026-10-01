CREATE TABLE IF NOT EXISTS alert_round_admissions (
  round_id TEXT NOT NULL REFERENCES discovery_rounds(id),
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id),
  channel TEXT NOT NULL,
  destination_key TEXT NOT NULL,
  intent_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (round_id, vacancy_id, channel, destination_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_round_admissions_round
  ON alert_round_admissions(round_id, created_at);
