//! T05 only: additive schema, one immutable draft, no active-plan projection.
#[cfg(all(test, windows))]
#[path = "plan_draft_tests.rs"]
mod tests;
use crate::fit_source_store::FitSourceStorage;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256, Sha384};
use sqlx::{sqlite::SqliteConnectOptions, Connection, Row, SqliteConnection};
use std::{collections::BTreeMap, path::PathBuf, time::Duration};

pub const DDL: &str = include_str!("../migrations/0003_plan_draft.sql");
const SOURCE_LIMIT: usize = 8 * 1024 * 1024;
const REPORT_LIMIT: usize = 1024 * 1024;
pub type Result<T> = std::result::Result<T, DraftError>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftError {
    pub contract_version: u32,
    pub code: &'static str,
    pub message: &'static str,
}
pub fn error(code: &'static str) -> DraftError {
    let message = match code {
        "unsupported" => "Unsupported draft, validator or database version. No data was replaced.",
        "conflict" => "A different draft or revision is already saved. Nothing was overwritten.",
        "invalid" => "The draft request or recovery data is invalid.",
        "corrupt" => "Saved draft records or original source failed verification.",
        "source" => "The original plan source is missing, corrupt or inaccessible.",
        "backup" => "The pre-migration safety copy could not be verified. Migration stopped.",
        "legacy_blocked" => "Legacy restore and reset are blocked while a native draft exists. Export draft recovery first; this build cannot replace the draft.",
        _ => "Draft storage could not complete the operation. Retry is safe.",
    };
    DraftError {
        contract_version: 1,
        code,
        message,
    }
}
impl From<sqlx::Error> for DraftError {
    fn from(_: sqlx::Error) -> Self {
        error("storage")
    }
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn fingerprint() -> String {
    hash(
        format!(
            "{}\n---\n{}",
            include_str!("../../schemas/training-plan/1.1.schema.json"),
            include_str!("../../src/domain/training-plan-validation.ts")
        )
        .as_bytes(),
    )
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Record {
    pub source_id: String,
    pub source_hash: String,
    pub byte_length: i64,
    pub original_file_name: String,
    pub imported_at: String,
    pub draft_id: String,
    pub plan_id: String,
    pub version_id: String,
    pub parent_version_id: Option<String>,
    pub revision: i64,
    pub state: String,
    pub created_at: String,
    pub schema_version: String,
    pub validator_version: String,
    pub validator_fingerprint: String,
    pub diagnostics_json: String,
    pub diagnostics_hash: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope {
    pub contract_version: u32,
    pub kind: String,
    pub record: Record,
    pub record_hash: String,
    pub source_base64: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub contract_version: u32,
    pub snapshot: Option<String>,
    pub draft: Option<Record>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Saved {
    pub contract_version: u32,
    pub record: Record,
    pub bytes: Vec<u8>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveRequest {
    pub contract_version: u32,
    pub bytes: Vec<u8>,
    pub original_file_name: String,
    pub source_hash: String,
    pub diagnostics_json: String,
    pub validator_fingerprint: String,
    pub expected_draft_id: Option<String>,
    pub expected_revision: Option<i64>,
    pub expected_snapshot: String,
}

pub struct Store {
    pub database: PathBuf,
    pub sources: PathBuf,
    #[cfg(test)]
    pub fault: Option<&'static str>,
}
impl Store {
    async fn connect(&self, readonly: bool) -> Result<SqliteConnection> {
        let options = SqliteConnectOptions::new()
            .filename(&self.database)
            .create_if_missing(false)
            .read_only(readonly)
            .foreign_keys(true)
            .busy_timeout(Duration::from_secs(5));
        // Do not change journal mode on the existing database before its backup.
        Ok(SqliteConnection::connect_with(&options).await?)
    }
    pub async fn inspect(&self) -> Result<Inspection> {
        if !self.database.try_exists().map_err(|_| error("storage"))? {
            return Ok(Inspection {
                contract_version: 1,
                snapshot: None,
                draft: None,
            });
        }
        let _guards = guard(&self.database, false)?;
        let mut db = self.connect(true).await?;
        // Keep schema/version reads consistent with a concurrent migration.
        sqlx::query("BEGIN").execute(&mut db).await?;
        check_schema(&mut db).await?;
        let exists: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE name='app_state'")
                .fetch_one(&mut db)
                .await?;
        if exists == 0 {
            return Ok(Inspection {
                contract_version: 1,
                snapshot: None,
                draft: None,
            });
        }
        let snapshot = sqlx::query_scalar("SELECT payload FROM app_state WHERE id=1")
            .fetch_optional(&mut db)
            .await?;
        let draft = read_record(&mut db).await?;
        sqlx::query("COMMIT").execute(&mut db).await?;
        Ok(Inspection {
            contract_version: 1,
            snapshot,
            draft,
        })
    }
    async fn prepare(&self, expected: &str) -> Result<()> {
        let _guards = guard(&self.database, false)?;
        // Opening a writable SQLite connection can recover/checkpoint journals.
        // Keep the source read-only until its safety copy has been verified.
        let mut db = self.connect(true).await?;
        let version = check_schema(&mut db).await?;
        let raw: String = sqlx::query_scalar("SELECT payload FROM app_state WHERE id=1")
            .fetch_one(&mut db)
            .await?;
        if raw != expected {
            return Err(error("conflict"));
        }
        let value: serde_json::Value = serde_json::from_str(&raw).map_err(|_| error("corrupt"))?;
        if value["schemaVersion"] != 4 {
            return Err(error("unsupported"));
        }
        if version == 3 {
            return Ok(());
        }
        let before = inventory(&mut db).await?;
        let directory = self
            .database
            .parent()
            .ok_or_else(|| error("backup"))?
            .join("t05-safety");
        std::fs::create_dir_all(&directory).map_err(|_| error("backup"))?;
        let copy = directory.join(format!("before-t05-{}.sqlite", uuid::Uuid::new_v4()));
        let _copy_guards = guard(&copy, true).map_err(|_| error("backup"))?;
        sqlx::query("VACUUM INTO ?")
            .bind(copy.to_str().ok_or_else(|| error("backup"))?)
            .execute(&mut db)
            .await
            .map_err(|_| error("backup"))?;
        #[cfg(test)]
        if self.fault == Some("backup_corrupt") {
            std::fs::write(&copy, b"synthetic corrupt safety copy").map_err(|_| error("backup"))?;
        }
        let _verified_copy_guards = guard(&copy, false).map_err(|_| error("backup"))?;
        std::fs::OpenOptions::new()
            .write(true)
            .open(&copy)
            .and_then(|f| f.sync_all())
            .map_err(|_| error("backup"))?;
        let mut backup = SqliteConnection::connect_with(
            &SqliteConnectOptions::new().filename(&copy).read_only(true),
        )
        .await
        .map_err(|_| error("backup"))?;
        integrity(&mut backup).await.map_err(|_| error("backup"))?;
        if inventory(&mut backup).await.map_err(|_| error("backup"))? != before {
            return Err(error("backup"));
        }
        backup.close().await.map_err(|_| error("backup"))?;
        db.close().await?;
        let mut db = self.connect(false).await?;
        sqlx::query("PRAGMA synchronous=FULL")
            .execute(&mut db)
            .await?;
        let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
        if check_schema(&mut tx).await? != 0 || inventory(&mut tx).await? != before {
            return Err(error("conflict"));
        }
        execute_ddl(&mut tx, DDL).await?;
        sqlx::query("PRAGMA user_version=3")
            .execute(&mut *tx)
            .await?;
        #[cfg(test)]
        if self.fault == Some("migration") {
            return Err(error("storage"));
        }
        integrity(&mut tx).await?;
        if legacy_inventory(&mut tx).await? != before {
            return Err(error("corrupt"));
        }
        tx.commit().await?;
        db.close().await?;
        let mut reopened = self.connect(true).await?;
        check_schema(&mut reopened).await?;
        if legacy_inventory(&mut reopened).await? != before {
            return Err(error("corrupt"));
        }
        Ok(())
    }
    pub async fn read(&self) -> Result<Option<Saved>> {
        let inspection = self.inspect().await?;
        match inspection.draft {
            None => Ok(None),
            Some(record) => {
                let bytes = FitSourceStorage::plan(self.sources.clone())
                    .read(&record.source_hash)
                    .map_err(|_| error("source"))?;
                verify_record(&record, &bytes)?;
                Ok(Some(Saved {
                    contract_version: 1,
                    record,
                    bytes,
                }))
            }
        }
    }
    pub async fn save(&self, request: SaveRequest) -> Result<Saved> {
        if request.contract_version != 1 {
            return Err(error("unsupported"));
        }
        if request.expected_draft_id.is_some() != request.expected_revision.is_some() {
            return Err(error("invalid"));
        }
        let value = source_value(&request.bytes)?;
        if request.source_hash != hash(&request.bytes)
            || request.validator_fingerprint != fingerprint()
        {
            return Err(error("invalid"));
        }
        verify_report(&request.diagnostics_json)?;
        let mut record = Record {
            source_id: format!("plan-source:{}", request.source_hash),
            source_hash: request.source_hash,
            byte_length: request.bytes.len() as i64,
            original_file_name: request.original_file_name,
            imported_at: String::new(),
            draft_id: String::new(),
            plan_id: value.manifest.plan_id,
            version_id: value.manifest.version_id,
            parent_version_id: value.manifest.parent_version_id,
            revision: 1,
            state: "draft".into(),
            created_at: String::new(),
            schema_version: "1.1".into(),
            validator_version: "t01-1".into(),
            validator_fingerprint: request.validator_fingerprint,
            diagnostics_hash: hash(request.diagnostics_json.as_bytes()),
            diagnostics_json: request.diagnostics_json,
        };
        record.draft_id = format!("plan-draft:{}", record.source_hash);
        self.prepare(&request.expected_snapshot).await?;
        let mut db = self.connect(false).await?;
        let now: String = sqlx::query_scalar("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')")
            .fetch_one(&mut db)
            .await?;
        record.imported_at = now.clone();
        record.created_at = now;
        self.publish(
            record,
            request.bytes,
            request.expected_draft_id,
            request.expected_revision,
            false,
        )
        .await
    }
    async fn publish(
        &self,
        record: Record,
        bytes: Vec<u8>,
        expected_id: Option<String>,
        expected_revision: Option<i64>,
        recovery: bool,
    ) -> Result<Saved> {
        verify_record(&record, &bytes)?;
        if let Some(existing) = self.read().await? {
            if existing.record.source_hash != record.source_hash
                || expected_id
                    .as_ref()
                    .is_some_and(|id| id != &existing.record.draft_id)
                || expected_revision.is_some_and(|r| r != existing.record.revision)
                || (recovery && existing.record != record)
            {
                return Err(error("conflict"));
            }
            if existing.bytes != bytes {
                return Err(error("corrupt"));
            }
            return Ok(existing);
        }
        // Finalize immutable bytes before starting the SQL transaction. A failed
        // commit may retain this verified orphan but can never expose a half draft.
        FitSourceStorage::plan(self.sources.clone())
            .store(&record.source_hash, &bytes)
            .map_err(|_| error("source"))?;
        let _guards = guard(&self.database, false)?;
        let mut db = self.connect(false).await?;
        sqlx::query("PRAGMA synchronous=FULL")
            .execute(&mut db)
            .await?;
        let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
        check_schema(&mut tx).await?;
        if let Some(existing) = read_record(&mut tx).await? {
            if existing.source_hash != record.source_hash
                || expected_id
                    .as_ref()
                    .is_some_and(|id| id != &existing.draft_id)
                || expected_revision.is_some_and(|r| r != existing.revision)
                || (recovery && existing != record)
            {
                return Err(error("conflict"));
            }
            let saved = FitSourceStorage::plan(self.sources.clone())
                .read(&existing.source_hash)
                .map_err(|_| error("source"))?;
            if saved != bytes {
                return Err(error("corrupt"));
            }
            tx.commit().await?;
            return self.read().await?.ok_or_else(|| error("corrupt"));
        }
        if expected_id.is_some() || expected_revision.is_some() {
            return Err(error("conflict"));
        }
        sqlx::query("INSERT INTO plan_draft_sources VALUES(?,?,?,?,?)")
            .bind(&record.source_id)
            .bind(&record.source_hash)
            .bind(record.byte_length)
            .bind(&record.original_file_name)
            .bind(&record.imported_at)
            .execute(&mut *tx)
            .await?;
        #[cfg(test)]
        if self.fault == Some("after_source") {
            return Err(error("storage"));
        }
        sqlx::query("INSERT INTO plan_drafts VALUES(1,?,?,?,?,?,1,'draft',?)")
            .bind(&record.draft_id)
            .bind(&record.source_id)
            .bind(&record.plan_id)
            .bind(&record.version_id)
            .bind(&record.parent_version_id)
            .bind(&record.created_at)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO plan_draft_validation VALUES(?,'1.1',?,?,?,?)")
            .bind(&record.draft_id)
            .bind(&record.validator_version)
            .bind(&record.validator_fingerprint)
            .bind(&record.diagnostics_json)
            .bind(&record.diagnostics_hash)
            .execute(&mut *tx)
            .await?;
        integrity(&mut tx).await?;
        if read_record(&mut tx).await?.as_ref() != Some(&record) {
            return Err(error("corrupt"));
        }
        tx.commit().await?;
        let result = self.read().await?.ok_or_else(|| error("corrupt"))?;
        if result.record != record || result.bytes != bytes {
            return Err(error("corrupt"));
        }
        Ok(result)
    }
    pub async fn export(&self) -> Result<Envelope> {
        let saved = self.read().await?.ok_or_else(|| error("invalid"))?;
        Ok(Envelope {
            contract_version: 1,
            kind: "stride-plan-draft-recovery".into(),
            record_hash: hash(&serde_json::to_vec(&saved.record).map_err(|_| error("corrupt"))?),
            record: saved.record,
            source_base64: STANDARD.encode(saved.bytes),
        })
    }
    pub async fn recover(&self, envelope: Envelope, expected_snapshot: &str) -> Result<Saved> {
        if envelope.contract_version != 1 || envelope.kind != "stride-plan-draft-recovery" {
            return Err(error("unsupported"));
        }
        if envelope.record_hash
            != hash(&serde_json::to_vec(&envelope.record).map_err(|_| error("invalid"))?)
        {
            return Err(error("corrupt"));
        }
        if envelope.source_base64.len() > SOURCE_LIMIT.div_ceil(3) * 4 {
            return Err(error("invalid"));
        }
        let bytes = STANDARD
            .decode(envelope.source_base64)
            .map_err(|_| error("invalid"))?;
        verify_record(&envelope.record, &bytes)?;
        self.prepare(expected_snapshot).await?;
        self.publish(envelope.record, bytes, None, None, true).await
    }
    // Only the legacy snapshot is replaceable. The native draft check and CAS
    // share a write lock with draft publication, closing the restore/save race.
    pub async fn replace_snapshot(&self, before: &str, after: &str) -> Result<()> {
        let _guards = guard(&self.database, false)?;
        let mut db = self.connect(false).await?;
        let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
        check_schema(&mut tx).await?;
        if read_record(&mut tx).await?.is_some() {
            return Err(error("legacy_blocked"));
        }
        let changed = sqlx::query("UPDATE app_state SET payload=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1 AND payload=?").bind(after).bind(before).execute(&mut *tx).await?;
        if changed.rows_affected() != 1 {
            return Err(error("conflict"));
        }
        tx.commit().await?;
        Ok(())
    }
}

fn source_value(bytes: &[u8]) -> Result<crate::fit_source_store::PlanSourceHeader> {
    if bytes.is_empty() || bytes.len() > SOURCE_LIMIT {
        return Err(error("invalid"));
    }
    crate::fit_source_store::plan_source_header(bytes).map_err(|e| {
        error(
            if e.code == crate::fit_source_store::ErrorCode::UnsupportedVersion {
                "unsupported"
            } else {
                "invalid"
            },
        )
    })
}
fn verify_report(report: &str) -> Result<()> {
    if report.len() > REPORT_LIMIT {
        return Err(error("invalid"));
    }
    let values: Vec<serde_json::Value> =
        serde_json::from_str(report).map_err(|_| error("invalid"))?;
    if values.iter().any(|x| {
        x["severity"] != "warning"
            || !x["code"].is_string()
            || !x["path"].is_string()
            || !x["message"].is_string()
    }) {
        return Err(error("invalid"));
    }
    Ok(())
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
}
fn timestamp(value: &str) -> bool {
    // Generated timestamps use SQLite's fixed UTC form. Recovery cannot smuggle
    // arbitrary metadata through time fields; calendar validity is checked below.
    let b = value.as_bytes();
    if !(b.len() == 24
        && [4, 7, 10, 13, 16, 19, 23]
            .into_iter()
            .zip(b"--T::.Z")
            .all(|(i, c)| b[i] == *c)
        && b.iter()
            .enumerate()
            .all(|(i, c)| [4, 7, 10, 13, 16, 19, 23].contains(&i) || c.is_ascii_digit()))
    {
        return false;
    }
    let number = |range: std::ops::Range<usize>| value[range].parse::<u32>().unwrap_or(u32::MAX);
    let year = number(0..4);
    let month = number(5..7);
    let day = number(8..10);
    let days = match month {
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => 0,
    };
    year > 0
        && day > 0
        && day <= days
        && number(11..13) < 24
        && number(14..16) < 60
        && number(17..19) < 60
}
fn verify_record(record: &Record, bytes: &[u8]) -> Result<()> {
    let value = source_value(bytes)?;
    if record.source_hash != hash(bytes)
        || record.byte_length != bytes.len() as i64
        || record.source_id != format!("plan-source:{}", record.source_hash)
        || record.draft_id != format!("plan-draft:{}", record.source_hash)
        || record.plan_id != value.manifest.plan_id
        || record.version_id != value.manifest.version_id
        || record.parent_version_id != value.manifest.parent_version_id
        || !valid_id(&record.plan_id)
        || !valid_id(&record.version_id)
        || record
            .parent_version_id
            .as_ref()
            .is_some_and(|id| !valid_id(id))
        || record.revision != 1
        || record.state != "draft"
        || record.schema_version != "1.1"
        || record.original_file_name.is_empty()
        || record.original_file_name.chars().count() > 255
        || record
            .original_file_name
            .chars()
            .any(|c| c.is_control() || "/\\:".contains(c))
        || !timestamp(&record.created_at)
        || !timestamp(&record.imported_at)
        || record.validator_version != "t01-1"
        || record.validator_fingerprint != fingerprint()
        || record.diagnostics_hash != hash(record.diagnostics_json.as_bytes())
    {
        return Err(error("corrupt"));
    }
    verify_report(&record.diagnostics_json)
}
async fn integrity(db: &mut SqliteConnection) -> Result<()> {
    let checks: Vec<String> = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_all(&mut *db)
        .await?;
    if checks != ["ok"]
        || !sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(db)
            .await?
            .is_empty()
    {
        return Err(error("corrupt"));
    }
    Ok(())
}
// Only shipped DDL is accepted. Statement-by-statement queries avoid SQLx
// RawSql's non-Send stream across Tauri's async command boundary, while the
// caller's single native transaction still owns every migration statement.
async fn execute_ddl(db: &mut SqliteConnection, script: &'static str) -> Result<()> {
    for statement in script.split(';').map(str::trim).filter(|s| !s.is_empty()) {
        sqlx::query(statement).execute(&mut *db).await?;
    }
    Ok(())
}
const LEGACY: &[&str] = &[
    "app_state",
    "snapshot_recovery",
    "_sqlx_migrations",
    "planned_sessions",
    "session_revisions",
    "activities",
    "activity_laps",
    "journal_entries",
    "import_sources",
    "shoes",
];
const NEW: &[&str] = &["plan_draft_sources", "plan_drafts", "plan_draft_validation"];
async fn schema(db: &mut SqliteConnection) -> Result<BTreeMap<String, String>> {
    Ok(sqlx::query("SELECT name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND sql IS NOT NULL ORDER BY name").fetch_all(db).await?.iter().map(|r| (r.get("name"),r.get("sql"))).collect())
}
async fn check_schema(db: &mut SqliteConnection) -> Result<i64> {
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&mut *db)
        .await?;
    if ![0, 3].contains(&version) {
        return Err(error("unsupported"));
    }
    let objects = schema(db).await?;
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'",
    )
    .fetch_all(&mut *db)
    .await?;
    for name in objects.keys() {
        if !LEGACY.contains(&name.as_str()) && !(version == 3 && NEW.contains(&name.as_str())) {
            return Err(error("unsupported"));
        }
    }
    if tables.is_empty() && version == 0 {
        return Ok(0);
    }
    if !tables.iter().any(|x| x == "app_state") {
        return Err(error("corrupt"));
    }
    let mut expected = SqliteConnection::connect("sqlite::memory:").await?;
    execute_ddl(
        &mut expected,
        include_str!("../migrations/0001_initial.sql"),
    )
    .await?;
    if tables.iter().any(|x| x == "shoes") {
        execute_ddl(
            &mut expected,
            include_str!("../migrations/0002_manual_run_entry.sql"),
        )
        .await?;
    }
    sqlx::query("CREATE TABLE snapshot_recovery (id TEXT PRIMARY KEY, purpose TEXT NOT NULL, payload TEXT NOT NULL)").execute(&mut expected).await?;
    sqlx::query("CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT NOT NULL, installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL)").execute(&mut expected).await?;
    let expected_objects = schema(&mut expected).await?;
    let canonical = |s: &str| {
        s.chars()
            .filter(|c| !c.is_whitespace())
            .collect::<String>()
            .to_lowercase()
            .replace("ifnotexists", "")
    };
    for (name, definition) in &objects {
        if LEGACY.contains(&name.as_str())
            && expected_objects
                .get(name)
                .is_none_or(|sql| canonical(sql) != canonical(definition))
        {
            return Err(error("unsupported"));
        }
    }
    for name in &tables {
        if LEGACY.contains(&name.as_str())
            && !["app_state", "snapshot_recovery", "_sqlx_migrations"].contains(&name.as_str())
        {
            let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM \"{name}\""))
                .fetch_one(&mut *db)
                .await?;
            if count != 0 {
                return Err(error("unsupported"));
            }
        }
    }
    if tables.iter().any(|x| x == "_sqlx_migrations") {
        let mut highest = 0;
        for row in
            sqlx::query("SELECT version,success,checksum FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&mut *db)
                .await?
        {
            let number: i64 = row.try_get("version")?;
            if number != highest + 1 {
                return Err(error("unsupported"));
            }
            highest = number;
            let script = match number {
                1 => include_str!("../migrations/0001_initial.sql"),
                2 => include_str!("../migrations/0002_manual_run_entry.sql"),
                _ => return Err(error("unsupported")),
            };
            if !row.try_get::<bool, _>("success")?
                || row.try_get::<Vec<u8>, _>("checksum")?
                    != Sha384::digest(script.as_bytes()).as_slice()
            {
                return Err(error("unsupported"));
            }
        }
        if highest > 0
            && [
                "planned_sessions",
                "session_revisions",
                "activities",
                "activity_laps",
                "journal_entries",
                "import_sources",
            ]
            .iter()
            .any(|name| !tables.iter().any(|t| t == name))
        {
            return Err(error("unsupported"));
        }
        if highest == 2 && !tables.iter().any(|x| x == "shoes") {
            return Err(error("unsupported"));
        }
        if highest == 1 && tables.iter().any(|x| x == "shoes") {
            return Err(error("unsupported"));
        }
    }
    if version == 3 {
        for statement in DDL.split(';').map(str::trim).filter(|s| !s.is_empty()) {
            let name = statement
                .split_whitespace()
                .nth(2)
                .ok_or_else(|| error("corrupt"))?;
            if objects.get(name).map(String::as_str) != Some(statement) {
                return Err(error("unsupported"));
            }
        }
    }
    integrity(db).await?;
    Ok(version)
}
async fn inventory(db: &mut SqliteConnection) -> Result<BTreeMap<String, Vec<String>>> {
    inventory_inner(db, false).await
}
async fn legacy_inventory(db: &mut SqliteConnection) -> Result<BTreeMap<String, Vec<String>>> {
    inventory_inner(db, true).await
}
async fn inventory_inner(
    db: &mut SqliteConnection,
    legacy_only: bool,
) -> Result<BTreeMap<String, Vec<String>>> {
    let mut result = BTreeMap::new();
    for (name, definition) in schema(db).await? {
        if legacy_only && NEW.contains(&name.as_str()) {
            continue;
        }
        if !LEGACY.contains(&name.as_str()) {
            return Err(error("unsupported"));
        }
        let columns = sqlx::query(&format!("PRAGMA table_info(\"{name}\")"))
            .fetch_all(&mut *db)
            .await?;
        let expression = columns
            .iter()
            .map(|r| {
                let column: String = r.get("name");
                format!("quote(\"{}\")", column.replace('"', "\"\""))
            })
            .collect::<Vec<_>>()
            .join(" || '|' || ");
        let mut rows: Vec<String> =
            sqlx::query_scalar(&format!("SELECT {expression} FROM \"{name}\""))
                .fetch_all(&mut *db)
                .await?;
        rows.sort();
        rows.insert(0, definition);
        result.insert(name, rows);
    }
    Ok(result)
}
async fn read_record(db: &mut SqliteConnection) -> Result<Option<Record>> {
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&mut *db)
        .await?;
    if version == 0 {
        return Ok(None);
    }
    let counts: (i64,i64,i64) = sqlx::query_as("SELECT (SELECT count(*) FROM plan_draft_sources),(SELECT count(*) FROM plan_drafts),(SELECT count(*) FROM plan_draft_validation)").fetch_one(&mut *db).await?;
    if counts == (0, 0, 0) {
        return Ok(None);
    }
    if counts != (1, 1, 1) {
        return Err(error("corrupt"));
    }
    let r = sqlx::query("SELECT s.*,d.*,v.* FROM plan_draft_sources s JOIN plan_drafts d USING(source_id) JOIN plan_draft_validation v USING(draft_id)").fetch_one(db).await?;
    Ok(Some(Record {
        source_id: r.try_get("source_id")?,
        source_hash: r.try_get("source_hash")?,
        byte_length: r.try_get("byte_length")?,
        original_file_name: r.try_get("original_file_name")?,
        imported_at: r.try_get("imported_at")?,
        draft_id: r.try_get("draft_id")?,
        plan_id: r.try_get("plan_id")?,
        version_id: r.try_get("version_id")?,
        parent_version_id: r.try_get("parent_version_id")?,
        revision: r.try_get("revision")?,
        state: r.try_get("state")?,
        created_at: r.try_get("created_at")?,
        schema_version: r.try_get("schema_version")?,
        validator_version: r.try_get("validator_version")?,
        validator_fingerprint: r.try_get("validator_fingerprint")?,
        diagnostics_json: r.try_get("diagnostics_json")?,
        diagnostics_hash: r.try_get("diagnostics_hash")?,
    }))
}

// Database paths are native-selected. Deny reparse/link substitution for the
// entire operation, using the same Windows handle policy as the source store.
#[cfg(windows)]
fn guard(path: &std::path::Path, missing_leaf: bool) -> Result<Vec<std::fs::File>> {
    use std::{
        fs::OpenOptions,
        os::windows::{
            fs::{MetadataExt, OpenOptionsExt},
            io::AsRawHandle,
        },
        path::Component,
    };
    use windows_sys::Win32::Storage::FileSystem::*;
    if !path.is_absolute() {
        return Err(error("storage"));
    }
    let mut current = PathBuf::new();
    let mut guards = Vec::new();
    for component in path.components() {
        match component {
            Component::Prefix(p) => {
                current.push(p.as_os_str());
                continue;
            }
            Component::RootDir | Component::Normal(_) => current.push(component.as_os_str()),
            _ => return Err(error("storage")),
        }
        let leaf = current == path;
        let file = match OpenOptions::new()
            .access_mode(FILE_READ_ATTRIBUTES)
            .share_mode(FILE_SHARE_READ | if leaf { FILE_SHARE_WRITE } else { 0 })
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(&current)
        {
            Ok(f) => f,
            Err(e) if leaf && missing_leaf && e.kind() == std::io::ErrorKind::NotFound => break,
            Err(_) => return Err(error("storage")),
        };
        let meta = file.metadata().map_err(|_| error("storage"))?;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || (!leaf && !meta.is_dir())
            || (leaf && !meta.is_file())
        {
            return Err(error("storage"));
        }
        if leaf {
            let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
            // SAFETY: the live handle and writable output have correct types.
            if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0
                || info.nNumberOfLinks != 1
            {
                return Err(error("storage"));
            }
        }
        guards.push(file);
    }
    Ok(guards)
}
#[cfg(not(windows))]
fn guard(_: &std::path::Path, _: bool) -> Result<Vec<std::fs::File>> {
    Err(error("unsupported"))
}
