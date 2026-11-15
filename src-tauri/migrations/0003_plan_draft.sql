CREATE TABLE plan_draft_sources (
  source_id TEXT PRIMARY KEY NOT NULL CHECK(source_id = 'plan-source:' || source_hash),
  source_hash TEXT NOT NULL UNIQUE CHECK(length(source_hash) = 64 AND source_hash NOT GLOB '*[^0-9a-f]*'),
  byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 8388608),
  original_file_name TEXT NOT NULL CHECK(length(original_file_name) BETWEEN 1 AND 255),
  imported_at TEXT NOT NULL
);
CREATE TABLE plan_drafts (
  slot INTEGER PRIMARY KEY CHECK(slot = 1),
  draft_id TEXT NOT NULL UNIQUE CHECK(draft_id = 'plan-draft:' || substr(source_id,13)),
  source_id TEXT NOT NULL UNIQUE REFERENCES plan_draft_sources(source_id) ON DELETE RESTRICT,
  plan_id TEXT NOT NULL CHECK(length(plan_id) BETWEEN 1 AND 128 AND plan_id NOT GLOB '*[^A-Za-z0-9._:-]*' AND substr(plan_id,1,1) GLOB '[A-Za-z0-9]'),
  version_id TEXT NOT NULL CHECK(length(version_id) BETWEEN 1 AND 128 AND version_id NOT GLOB '*[^A-Za-z0-9._:-]*' AND substr(version_id,1,1) GLOB '[A-Za-z0-9]'),
  parent_version_id TEXT CHECK(parent_version_id IS NULL OR (length(parent_version_id) BETWEEN 1 AND 128 AND parent_version_id NOT GLOB '*[^A-Za-z0-9._:-]*' AND substr(parent_version_id,1,1) GLOB '[A-Za-z0-9]')),
  revision INTEGER NOT NULL CHECK(revision = 1),
  state TEXT NOT NULL CHECK(state = 'draft'),
  created_at TEXT NOT NULL,
  UNIQUE(plan_id, version_id)
);
CREATE TABLE plan_draft_validation (
  draft_id TEXT PRIMARY KEY NOT NULL REFERENCES plan_drafts(draft_id) ON DELETE RESTRICT,
  schema_version TEXT NOT NULL CHECK(schema_version = '1.1'),
  validator_version TEXT NOT NULL CHECK(validator_version = 't01-1'),
  validator_fingerprint TEXT NOT NULL CHECK(length(validator_fingerprint) = 64 AND validator_fingerprint NOT GLOB '*[^0-9a-f]*'),
  diagnostics_json TEXT NOT NULL CHECK(json_valid(diagnostics_json)),
  diagnostics_hash TEXT NOT NULL CHECK(length(diagnostics_hash) = 64 AND diagnostics_hash NOT GLOB '*[^0-9a-f]*')
);
