CREATE TABLE IF NOT EXISTS shoes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mileage_miles REAL NOT NULL DEFAULT 0 CHECK (mileage_miles >= 0),
  is_default INTEGER NOT NULL DEFAULT 0,
  retired INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE journal_entries ADD COLUMN time_entry_mode TEXT;
ALTER TABLE journal_entries ADD COLUMN pace_seconds_per_unit INTEGER;
ALTER TABLE journal_entries ADD COLUMN pace_unit TEXT;
ALTER TABLE journal_entries ADD COLUMN sleep_entry_mode TEXT;
ALTER TABLE journal_entries ADD COLUMN sleep_score INTEGER;
ALTER TABLE journal_entries ADD COLUMN sleep_duration_minutes INTEGER;
ALTER TABLE journal_entries ADD COLUMN shoe_id TEXT REFERENCES shoes(id);
ALTER TABLE journal_entries ADD COLUMN created_at TEXT;
