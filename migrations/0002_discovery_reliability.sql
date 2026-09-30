CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  round_id TEXT PRIMARY KEY REFERENCES discovery_rounds(id),
  revision TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE discovery_tasks ADD COLUMN portfolio_snapshot_hash TEXT;

CREATE TABLE IF NOT EXISTS task_publications (
  task_id TEXT PRIMARY KEY REFERENCES discovery_tasks(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'published')),
  lease_token TEXT,
  lease_expires_at TEXT,
  publish_attempts INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_publications_claim
  ON task_publications(status, lease_expires_at, created_at);

ALTER TABLE observations ADD COLUMN origin_kind TEXT NOT NULL DEFAULT 'synthetic'
  CHECK (origin_kind IN ('synthetic', 'real'));
ALTER TABLE observations ADD COLUMN canonical_vacancy_id TEXT;

CREATE TABLE IF NOT EXISTS vacancies (
  id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  organization TEXT,
  location TEXT,
  work_model TEXT NOT NULL DEFAULT 'unknown',
  description_summary TEXT,
  published_at TEXT,
  fingerprint TEXT NOT NULL,
  fingerprint_version TEXT NOT NULL,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vacancy_source_identities (
  source_id TEXT NOT NULL,
  source_vacancy_id TEXT NOT NULL,
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id),
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  PRIMARY KEY (source_id, source_vacancy_id)
);

CREATE TABLE IF NOT EXISTS vacancy_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id),
  round_id TEXT REFERENCES discovery_rounds(id),
  task_id TEXT REFERENCES discovery_tasks(id),
  source_id TEXT NOT NULL,
  source_vacancy_id TEXT,
  query_id TEXT NOT NULL,
  observed_url TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  origin_kind TEXT NOT NULL CHECK (origin_kind IN ('synthetic', 'real')),
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (vacancy_id, round_id, query_id, source_id)
);

CREATE TABLE IF NOT EXISTS possible_duplicates (
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id),
  candidate_vacancy_id TEXT NOT NULL REFERENCES vacancies(id),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (vacancy_id, candidate_vacancy_id),
  CHECK (vacancy_id <> candidate_vacancy_id)
);

CREATE INDEX IF NOT EXISTS idx_occurrences_vacancy_observed
  ON vacancy_occurrences(vacancy_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_vacancies_fingerprint
  ON vacancies(fingerprint_version, fingerprint);
