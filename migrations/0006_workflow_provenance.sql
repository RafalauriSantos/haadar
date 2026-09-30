CREATE TABLE IF NOT EXISTS enrichment_runs (
  instance_id TEXT PRIMARY KEY,
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id),
  decision_id TEXT NOT NULL REFERENCES decision_records(id),
  status TEXT NOT NULL CHECK (status IN ('completed', 'fallback')),
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  fallback_reason TEXT,
  output_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
