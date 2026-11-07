PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS planned_sessions (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  week INTEGER NOT NULL,
  original_date TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  original_distance_miles REAL NOT NULL CHECK (original_distance_miles >= 0),
  planned_distance_miles REAL NOT NULL CHECK (planned_distance_miles >= 0),
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  guidance TEXT NOT NULL DEFAULT '',
  flexible INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  outcome_note TEXT,
  replacement_description TEXT
);

CREATE TABLE IF NOT EXISTS session_revisions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES planned_sessions(id) ON DELETE CASCADE,
  changed_at TEXT NOT NULL,
  field TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  source_hash TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  distance_miles REAL NOT NULL CHECK (distance_miles >= 0),
  duration_seconds INTEGER,
  average_hr INTEGER,
  role TEXT NOT NULL,
  planned_session_id TEXT REFERENCES planned_sessions(id),
  bundle_id TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_laps (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  distance_miles REAL NOT NULL,
  duration_seconds INTEGER NOT NULL,
  average_hr INTEGER,
  role TEXT NOT NULL DEFAULT 'other'
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES planned_sessions(id),
  date TEXT NOT NULL,
  actual_distance_miles REAL,
  duration_seconds INTEGER,
  average_hr INTEGER,
  rpe INTEGER CHECK (rpe BETWEEN 1 AND 10),
  sleep TEXT,
  soreness TEXT,
  soreness_location TEXT,
  note TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_sources (
  fingerprint TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  source_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
