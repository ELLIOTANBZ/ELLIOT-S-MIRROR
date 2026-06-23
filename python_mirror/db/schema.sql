PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('CSE', 'TL', 'Supervisor', 'Admin')),
  record_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id TEXT NOT NULL,
  upload_date TEXT NOT NULL,
  total_score REAL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  record_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(officer_id, upload_date),
  FOREIGN KEY(officer_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_officer_date ON audit_records(officer_id, upload_date);

CREATE TABLE IF NOT EXISTS ess_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id TEXT NOT NULL,
  upload_date TEXT NOT NULL,
  rating REAL,
  feedback TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  record_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(officer_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ess_officer_date ON ess_records(officer_id, upload_date);

CREATE TABLE IF NOT EXISTS interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id TEXT NOT NULL,
  upload_date TEXT NOT NULL,
  case_id TEXT,
  member_query TEXT,
  officer_response TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  record_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(officer_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_interactions_officer_date ON interactions(officer_id, upload_date);

CREATE TABLE IF NOT EXISTS competency_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id TEXT NOT NULL,
  competency_name TEXT NOT NULL,
  level TEXT NOT NULL,
  justification TEXT NOT NULL,
  supervisor_name TEXT NOT NULL,
  record_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(officer_id, competency_name)
);

CREATE TABLE IF NOT EXISTS ai_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS local_pending_changes (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('CREATE', 'UPDATE', 'DELETE', 'IMPORT')),
  payload_json TEXT NOT NULL,
  base_record_version INTEGER,
  status TEXT NOT NULL DEFAULT 'Pending',
  submitted_by TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS career_profiles (
  officer_id TEXT PRIMARY KEY,
  current_role TEXT NOT NULL,
  target_role TEXT NOT NULL,
  role_start_date TEXT,
  responsibilities_json TEXT NOT NULL DEFAULT '[]',
  target_responsibilities_json TEXT NOT NULL DEFAULT '[]',
  expected_tenure_years REAL NOT NULL DEFAULT 2,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(officer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS readiness_settings (
  role TEXT PRIMARY KEY,
  core_weight REAL NOT NULL DEFAULT 0.25,
  functional_weight REAL NOT NULL DEFAULT 0.15,
  correspondence_weight REAL NOT NULL DEFAULT 0.15,
  performance_weight REAL NOT NULL DEFAULT 0.15,
  tenure_weight REAL NOT NULL DEFAULT 0.10,
  development_weight REAL NOT NULL DEFAULT 0.10,
  application_weight REAL NOT NULL DEFAULT 0.10,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS readiness_thresholds (
  stage TEXT NOT NULL,
  metric TEXT NOT NULL,
  display_name TEXT NOT NULL,
  minimum_value REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'score',
  sequence INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(stage, metric)
);

CREATE TABLE IF NOT EXISTS training_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  training_type TEXT NOT NULL DEFAULT 'Optional',
  description TEXT NOT NULL DEFAULT '',
  assigned_by TEXT NOT NULL DEFAULT 'CPF Board',
  status TEXT NOT NULL CHECK(status IN ('Pending', 'In Progress', 'Completed')),
  assigned_date TEXT,
  completed_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(officer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS training_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_date TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  product_type TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '',
  course_url TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  training_type TEXT NOT NULL DEFAULT 'Optional',
  description TEXT NOT NULL DEFAULT '',
  learning_outcomes TEXT NOT NULL DEFAULT '',
  who_should_attend TEXT NOT NULL DEFAULT '',
  competency_gap TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(officer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS organisation_relationships (
  officer_id TEXT PRIMARY KEY,
  manager_id TEXT,
  team_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(officer_id) REFERENCES users(id),
  FOREIGN KEY(manager_id) REFERENCES users(id)
);
