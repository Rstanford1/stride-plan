CREATE TABLE plan_draft_validation_next (
  draft_id TEXT PRIMARY KEY NOT NULL REFERENCES plan_drafts(draft_id) ON DELETE RESTRICT,
  schema_version TEXT NOT NULL CHECK(schema_version IN ('1.1','1.2')),
  validator_version TEXT NOT NULL CHECK((schema_version = '1.1' AND validator_version = 't01-1') OR (schema_version = '1.2' AND validator_version = 't081-1')),
  validator_fingerprint TEXT NOT NULL CHECK(length(validator_fingerprint) = 64 AND validator_fingerprint NOT GLOB '*[^0-9a-f]*'),
  diagnostics_json TEXT NOT NULL CHECK(json_valid(diagnostics_json)),
  diagnostics_hash TEXT NOT NULL CHECK(length(diagnostics_hash) = 64 AND diagnostics_hash NOT GLOB '*[^0-9a-f]*')
);
INSERT INTO plan_draft_validation_next SELECT * FROM plan_draft_validation;
DROP TABLE plan_draft_validation;
ALTER TABLE plan_draft_validation_next RENAME TO plan_draft_validation;
