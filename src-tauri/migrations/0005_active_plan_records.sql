-- The native activation command applies this only after a verified safety copy.
-- Source bytes, identity mappings, activation decisions and move events are
-- immutable records. app_state remains the sole editable schedule.
CREATE TABLE active_plan_records (
  sequence INTEGER PRIMARY KEY,
  record_id TEXT NOT NULL UNIQUE,
  record_kind TEXT NOT NULL CHECK (record_kind IN ('activation', 'schedule')),
  source_hash TEXT NOT NULL CHECK (
    length(source_hash) = 64 AND source_hash NOT GLOB '*[^0-9a-f]*'
  ),
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
  recorded_at TEXT NOT NULL
);

CREATE TRIGGER active_plan_records_no_update
BEFORE UPDATE ON active_plan_records
BEGIN
  SELECT RAISE(ABORT, 'active plan records are immutable');
END;

CREATE TRIGGER active_plan_records_no_delete
BEFORE DELETE ON active_plan_records
BEGIN
  SELECT RAISE(ABORT, 'active plan records are immutable');
END;
