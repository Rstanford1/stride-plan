//! All paths belong to generated temporary synthetic profiles, never Tauri's
//! production resolver. These tests run in the existing Windows Rust workflow.
use super::*;
use std::{fs, path::Path, process::Command};

const SNAPSHOT: &str = "{\"schemaVersion\":4,\"sessions\":[],\"activities\":[],\"journals\":[],\"shoes\":[],\"fitSources\":[],\"fitSourceActivities\":[],\"fitImportBatches\":[],\"settings\":{\"distanceUnit\":\"mi\"},\"importFingerprints\":[]}";
struct Profile(PathBuf);
impl Profile {
    async fn new(normalized: bool) -> Self {
        let path =
            std::env::temp_dir().join(format!("stride-t05-synthetic-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        let profile = Self(path);
        let mut db = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(profile.store().database)
                .create_if_missing(true),
        )
        .await
        .unwrap();
        if normalized {
            sqlx::raw_sql(include_str!("../migrations/0001_initial.sql"))
                .execute(&mut db)
                .await
                .unwrap();
            sqlx::raw_sql(include_str!("../migrations/0002_manual_run_entry.sql"))
                .execute(&mut db)
                .await
                .unwrap();
        } else {
            sqlx::raw_sql("CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL)").execute(&mut db).await.unwrap();
        }
        sqlx::query("INSERT INTO app_state VALUES(1,?,'synthetic-original-time')")
            .bind(SNAPSHOT)
            .execute(&mut db)
            .await
            .unwrap();
        if normalized {
            sqlx::raw_sql("CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT NOT NULL, installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL)").execute(&mut db).await.unwrap();
            for (number, script) in [
                (1, include_str!("../migrations/0001_initial.sql")),
                (2, include_str!("../migrations/0002_manual_run_entry.sql")),
            ] {
                sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(?,'synthetic',1,?,0)").bind(number).bind(Sha384::digest(script.as_bytes()).to_vec()).execute(&mut db).await.unwrap();
            }
        }
        db.close().await.unwrap();
        profile
    }
    fn store(&self) -> Store {
        Store {
            database: self.0.join("synthetic.sqlite"),
            sources: self.0.join("sources"),
            fault: None,
        }
    }
    fn source(&self, hash: &str) -> PathBuf {
        self.store()
            .sources
            .join("plan-sources")
            .join(&hash[..2])
            .join(format!("{hash}.json"))
    }
}
impl Drop for Profile {
    fn drop(&mut self) {
        assert!(
            self.0.starts_with(std::env::temp_dir())
                && self
                    .0
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("stride-t05-synthetic-")
        );
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn bytes() -> Vec<u8> {
    // Include a BOM, CRLF and source-only whitespace deliberately.
    format!(
        "\u{feff}{}\r\n ",
        include_str!("../../src/domain/__fixtures__/training-plan/valid-independent.json")
            .replace('\n', "\r\n")
    )
    .into_bytes()
}
fn request() -> SaveRequest {
    let bytes = bytes();
    SaveRequest {
        contract_version: 1,
        source_hash: hash(&bytes),
        bytes,
        original_file_name: "synthetic.json".into(),
        diagnostics_json: "[]".into(),
        validator_fingerprint: fingerprint(),
        expected_draft_id: None,
        expected_revision: None,
        expected_snapshot: SNAPSHOT.into(),
    }
}
async fn version(store: &Store) -> i64 {
    sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&mut store.connect(true).await.unwrap())
        .await
        .unwrap()
}

#[tokio::test]
async fn additive_migration_exact_source_duplicate_conflict_and_active_snapshot() {
    for normalized in [false, true] {
        let profile = Profile::new(normalized).await;
        let store = profile.store();
        let before = inventory(&mut store.connect(true).await.unwrap())
            .await
            .unwrap();
        let input = profile.0.join("synthetic-input.json");
        fs::write(&input, bytes()).unwrap();
        let saved = store.save(request()).await.unwrap();
        assert_eq!(saved.bytes, fs::read(input).unwrap());
        assert_eq!(
            saved.record.draft_id,
            format!("plan-draft:{}", hash(&bytes()))
        );
        assert_eq!(version(&store).await, 3);
        assert_eq!(
            legacy_inventory(&mut store.connect(true).await.unwrap())
                .await
                .unwrap(),
            before
        );
        assert_eq!(store.save(request()).await.unwrap().record, saved.record);
        let mut changed = request();
        changed.bytes.push(b' ');
        changed.source_hash = hash(&changed.bytes);
        assert_eq!(store.save(changed).await.unwrap_err().code, "conflict");
        let mut stale = request();
        stale.expected_draft_id = Some(saved.record.draft_id.clone());
        stale.expected_revision = Some(2);
        assert_eq!(store.save(stale).await.unwrap_err().code, "conflict");
        assert_eq!(store.read().await.unwrap().unwrap().record, saved.record);
        let copies = fs::read_dir(profile.0.join("t05-safety"))
            .unwrap()
            .collect::<Vec<_>>();
        assert_eq!(copies.len(), 1);
        let mut backup = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(copies[0].as_ref().unwrap().path())
                .read_only(true),
        )
        .await
        .unwrap();
        assert_eq!(inventory(&mut backup).await.unwrap(), before);
    }
}

#[tokio::test]
async fn safety_copy_creation_verification_and_migration_failure_leave_baseline_unchanged() {
    for fault in ["backup_create", "backup_corrupt", "migration"] {
        let profile = Profile::new(true).await;
        let mut store = profile.store();
        let before = fs::read(&store.database).unwrap();
        if fault == "backup_create" {
            fs::write(profile.0.join("t05-safety"), b"not a directory").unwrap();
        } else {
            store.fault = Some(fault);
        }
        assert!(store.save(request()).await.is_err());
        assert_eq!(version(&store).await, 0);
        assert_eq!(fs::read(&store.database).unwrap(), before);
        assert!(store.inspect().await.unwrap().draft.is_none());
    }
}

#[tokio::test]
async fn failed_transaction_rolls_back_all_three_rows_and_retry_reuses_orphan() {
    let profile = Profile::new(false).await;
    let mut store = profile.store();
    store.fault = Some("after_source");
    assert!(store.save(request()).await.is_err());
    assert_eq!(version(&store).await, 3);
    assert!(store.read().await.unwrap().is_none());
    assert_eq!(fs::read(profile.source(&hash(&bytes()))).unwrap(), bytes());
    store.fault = None;
    assert_eq!(store.save(request()).await.unwrap().bytes, bytes());
}

#[tokio::test]
async fn failed_backup_verification_does_not_checkpoint_or_modify_existing_wal() {
    let profile = Profile::new(false).await;
    let mut store = profile.store();
    let mut writer = store.connect(false).await.unwrap();
    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(&mut writer)
        .await
        .unwrap();
    sqlx::query("UPDATE app_state SET updated_at='synthetic-wal-write'")
        .execute(&mut writer)
        .await
        .unwrap();
    let wal = PathBuf::from(format!("{}-wal", store.database.display()));
    let before_main = fs::read(&store.database).unwrap();
    let before_wal = fs::read(&wal).unwrap();
    store.fault = Some("backup_corrupt");
    assert_eq!(store.save(request()).await.unwrap_err().code, "backup");
    assert_eq!(fs::read(&store.database).unwrap(), before_main);
    assert_eq!(fs::read(&wal).unwrap(), before_wal);
    assert_eq!(version(&store).await, 0);
    writer.close().await.unwrap();
}

#[tokio::test]
async fn missing_corrupt_or_hash_mismatched_sources_fail_without_repair() {
    for damage in ["missing", "corrupt", "different-valid"] {
        let profile = Profile::new(false).await;
        let store = profile.store();
        let saved = store.save(request()).await.unwrap();
        let path = profile.source(&saved.record.source_hash);
        match damage {
            "missing" => fs::remove_file(&path).unwrap(),
            "corrupt" => fs::write(&path, b"broken").unwrap(),
            _ => {
                let mut changed = bytes();
                changed.push(b' ');
                fs::write(&path, changed).unwrap();
            }
        }
        assert_eq!(store.read().await.unwrap_err().code, "source");
        assert_eq!(store.export().await.unwrap_err().code, "source");
        assert_eq!(store.save(request()).await.unwrap_err().code, "source");
        if damage == "missing" {
            assert!(!path.exists());
        }
        assert_eq!(
            store.inspect().await.unwrap().snapshot.as_deref(),
            Some(SNAPSHOT)
        );
    }
}

#[tokio::test]
async fn recovery_preserves_every_record_and_exact_bytes_and_rolls_back_failure() {
    let original = Profile::new(false).await;
    let saved = original.store().save(request()).await.unwrap();
    let envelope = serde_json::to_string(&original.store().export().await.unwrap()).unwrap();
    let recovered = Profile::new(false).await;
    let mut store = recovered.store();
    store.fault = Some("after_source");
    assert!(store
        .recover(serde_json::from_str(&envelope).unwrap(), SNAPSHOT)
        .await
        .is_err());
    assert!(store.read().await.unwrap().is_none());
    store.fault = None;
    let restored = store
        .recover(serde_json::from_str(&envelope).unwrap(), SNAPSHOT)
        .await
        .unwrap();
    assert_eq!(restored.record, saved.record);
    assert_eq!(restored.bytes, saved.bytes);
    assert_eq!(
        store
            .recover(serde_json::from_str(&envelope).unwrap(), SNAPSHOT)
            .await
            .unwrap()
            .record,
        saved.record
    );
    let mut tampered: Envelope = serde_json::from_str(&envelope).unwrap();
    tampered.record.original_file_name = "changed.json".into();
    tampered.record_hash = hash(&serde_json::to_vec(&tampered.record).unwrap());
    assert_eq!(
        store.recover(tampered, SNAPSHOT).await.unwrap_err().code,
        "conflict"
    );
    let mut tampered: Envelope = serde_json::from_str(&envelope).unwrap();
    tampered.source_base64 = STANDARD.encode(b"broken");
    assert!(store.recover(tampered, SNAPSHOT).await.is_err());
    assert_eq!(
        store.inspect().await.unwrap().snapshot.as_deref(),
        Some(SNAPSHOT)
    );
}

#[tokio::test]
async fn future_partial_database_and_invalid_transport_fail_closed() {
    for sql in [
        "PRAGMA user_version=4",
        "CREATE TABLE unknown_native(id TEXT)",
        "CREATE TABLE sqliteXfuture(id TEXT)",
        "CREATE TABLE plan_draft_sources(id TEXT)",
        "PRAGMA user_version=3",
    ] {
        let profile = Profile::new(false).await;
        let store = profile.store();
        sqlx::raw_sql(sql)
            .execute(&mut store.connect(false).await.unwrap())
            .await
            .unwrap();
        let before = fs::read(&store.database).unwrap();
        assert!(store.save(request()).await.is_err());
        assert_eq!(fs::read(&store.database).unwrap(), before);
    }
    let profile = Profile::new(false).await;
    let store = profile.store();
    let mut bad = request();
    bad.contract_version = 2;
    assert_eq!(store.save(bad).await.unwrap_err().code, "unsupported");
    let mut bad = request();
    bad.bytes = b"invalid JSON".to_vec();
    assert!(store.save(bad).await.is_err());
    let mut bad = request();
    bad.source_hash = "a".repeat(64);
    assert!(store.save(bad).await.is_err());
    let mut bad = request();
    bad.validator_fingerprint = "a".repeat(64);
    assert!(store.save(bad).await.is_err());
    let mut bad = request();
    bad.diagnostics_json = "[{\"severity\":\"error\"}]".into();
    assert!(store.save(bad).await.is_err());
    assert_eq!(version(&store).await, 0);
}

#[tokio::test]
async fn legacy_replacement_is_atomic_and_never_deletes_draft() {
    let profile = Profile::new(false).await;
    let store = profile.store();
    let next = SNAPSHOT.replace("\"mi\"", "\"km\"");
    store.replace_snapshot(SNAPSHOT, &next).await.unwrap();
    store.replace_snapshot(&next, SNAPSHOT).await.unwrap();
    store.save(request()).await.unwrap();
    assert_eq!(
        store
            .replace_snapshot(SNAPSHOT, &next)
            .await
            .unwrap_err()
            .code,
        "legacy_blocked"
    );
    assert_eq!(
        store.inspect().await.unwrap().snapshot.as_deref(),
        Some(SNAPSHOT)
    );
    assert!(store.read().await.unwrap().is_some());
}

#[tokio::test]
async fn constraints_and_foreign_keys_reject_invalid_native_records() {
    let profile = Profile::new(false).await;
    let store = profile.store();
    store.save(request()).await.unwrap();
    let mut db = store.connect(false).await.unwrap();
    for sql in [
        "UPDATE plan_drafts SET slot=2",
        "UPDATE plan_drafts SET revision=2",
        "UPDATE plan_draft_sources SET source_hash='bad'",
        "DELETE FROM plan_draft_sources",
        "DELETE FROM plan_drafts",
        "UPDATE plan_drafts SET source_id='plan-source:missing'",
    ] {
        assert!(sqlx::query(sql).execute(&mut db).await.is_err(), "{sql}");
    }
}

#[tokio::test]
async fn invalid_ledger_or_populated_unused_tables_block_without_modification() {
    for mutation in [
        "UPDATE _sqlx_migrations SET success=0 WHERE version=2",
        "UPDATE _sqlx_migrations SET checksum=X'00' WHERE version=2",
        "INSERT INTO import_sources VALUES('synthetic','plan','synthetic-time','synthetic-name')",
    ] {
        let profile = Profile::new(true).await;
        let store = profile.store();
        sqlx::raw_sql(mutation)
            .execute(&mut store.connect(false).await.unwrap())
            .await
            .unwrap();
        let before = fs::read(&store.database).unwrap();
        assert!(store.save(request()).await.is_err());
        assert_eq!(fs::read(&store.database).unwrap(), before);
    }
}

#[tokio::test]
async fn duplicate_publish_race_and_legacy_restore_race_are_serialized() {
    let profile = Profile::new(false).await;
    let store = profile.store();
    store.prepare(SNAPSHOT).await.unwrap();
    let (first, second) = tokio::join!(store.save(request()), store.save(request()));
    assert_eq!(first.unwrap().record, second.unwrap().record);
    let replacement = SNAPSHOT.replace("\"mi\"", "\"km\"");
    let (draft, restore) = tokio::join!(
        store.save(request()),
        store.replace_snapshot(SNAPSHOT, &replacement)
    );
    assert!(draft.is_ok());
    assert_eq!(restore.unwrap_err().code, "legacy_blocked");
    assert_eq!(
        store.inspect().await.unwrap().snapshot.as_deref(),
        Some(SNAPSHOT)
    );
}

#[tokio::test]
async fn linked_database_and_source_objects_are_rejected() {
    let profile = Profile::new(false).await;
    let store = profile.store();
    let saved = store.save(request()).await.unwrap();
    let path = profile.source(&saved.record.source_hash);
    fs::hard_link(&path, profile.0.join("synthetic-source-link.json")).unwrap();
    assert_eq!(store.read().await.unwrap_err().code, "source");
    fs::hard_link(
        &store.database,
        profile.0.join("synthetic-database-link.sqlite"),
    )
    .unwrap();
    assert!(store.inspect().await.is_err());
}

#[tokio::test]
async fn optional_json_string_escapes_remain_opaque_source_bytes() {
    let profile = Profile::new(false).await;
    let store = profile.store();
    let mut input = request();
    let mut text = String::from_utf8(input.bytes).unwrap();
    let end = text.rfind('}').unwrap();
    text.insert_str(end, ",\"futureOptional\":\"\\ud800\"");
    input.bytes = text.into_bytes();
    input.source_hash = hash(&input.bytes);
    let expected = input.bytes.clone();
    assert_eq!(store.save(input).await.unwrap().bytes, expected);
    assert_eq!(store.read().await.unwrap().unwrap().bytes, expected);
}

#[test]
fn process_restart_round_trip() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let profile = runtime.block_on(Profile::new(false));
    for phase in ["save", "read"] {
        let result = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "plan_draft_store::tests::restart_worker",
                "--ignored",
                "--nocapture",
            ])
            .env("STRIDE_T05_SYNTHETIC_ROOT", &profile.0)
            .env("STRIDE_T05_SYNTHETIC_PHASE", phase)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stdout)
        );
    }
}
#[tokio::test]
#[ignore = "only spawned with a fixture-owned synthetic profile by process_restart_round_trip"]
async fn restart_worker() {
    let root = PathBuf::from(std::env::var_os("STRIDE_T05_SYNTHETIC_ROOT").unwrap());
    assert!(
        root.starts_with(std::env::temp_dir())
            && root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("stride-t05-synthetic-")
    );
    let store = Store {
        database: root.join("synthetic.sqlite"),
        sources: root.join("sources"),
        fault: None,
    };
    if std::env::var("STRIDE_T05_SYNTHETIC_PHASE").unwrap() == "save" {
        store.save(request()).await.unwrap();
    } else {
        let saved = store.read().await.unwrap().unwrap();
        assert_eq!(saved.bytes, bytes());
        assert_eq!(saved.record.source_hash, hash(&bytes()));
    }
}

#[test]
fn versioned_wire_contracts_reject_arbitrary_paths() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../tests/plan-draft-wire.json")).unwrap();
    let save: SaveRequest = serde_json::from_value(fixture["save"].clone()).unwrap();
    assert_eq!(serde_json::to_value(save).unwrap(), fixture["save"]);
    assert_eq!(
        serde_json::to_value(error("conflict")).unwrap(),
        fixture["error"]
    );
    let value = serde_json::json!({"contractVersion":1,"bytes":[],"originalFileName":"synthetic.json","sourceHash":"a".repeat(64),"diagnosticsJson":"[]","validatorFingerprint":fingerprint(),"expectedDraftId":null,"expectedRevision":null,"expectedSnapshot":SNAPSHOT,"path":"C:\\outside.json"});
    assert!(serde_json::from_value::<SaveRequest>(value).is_err());
    assert!(valid_id("synthetic-version-1"));
    assert!(!valid_id("../escape"));
    assert!(timestamp("2026-11-15T02:00:00.000Z"));
    assert!(!timestamp("unbounded"));
    assert!(!timestamp("2026-02-30T03:00:00.000Z"));
    assert!(!Path::new("synthetic.json").is_absolute());
}
