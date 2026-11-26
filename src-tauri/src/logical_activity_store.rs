//! Atomic publication of a logical-activity revision inside the canonical snapshot.
//! This does not introduce a separate database or physical SQLite migration.
use crate::{
    fit_source_store::FitSourceStorage,
    plan_draft_store::{check_schema, error, guard, integrity, inventory, Result, Store},
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Connection;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivitySaveRequest {
    pub contract_version: u32,
    pub before: String,
    pub after: String,
    pub operation: Option<String>,
}

fn invalid() -> crate::plan_draft_store::DraftError {
    error("invalid")
}
fn array<'a>(value: &'a Value, field: &str) -> Result<&'a Vec<Value>> {
    value
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(invalid)
}
fn string<'a>(value: &'a Value, field: &str) -> Result<&'a str> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(invalid)
}
fn state(snapshot: &Value) -> Result<Value> {
    match snapshot.get("schemaVersion").and_then(Value::as_i64) {
        Some(4 | 5) if snapshot.get("logicalActivities").is_none() => {
            Ok(json!({"activities":[],"commands":[]}))
        }
        Some(7) => snapshot
            .get("logicalActivities")
            .cloned()
            .ok_or_else(invalid),
        _ => Err(invalid()),
    }
}
fn source_key(source: &Value) -> Result<String> {
    match string(source, "kind")? {
        "manual" => Ok(format!("manual:{}", string(source, "sourceId")?)),
        "fit" => Ok(format!(
            "fit:{}:{}",
            string(source, "sourceHash")?,
            string(source, "activityId")?
        )),
        "garmin" => Ok(format!("garmin:{}", string(source, "providerId")?)),
        _ => Err(invalid()),
    }
}
fn garmin_hashes(source: &Value) -> Result<BTreeSet<String>> {
    let mut hashes = BTreeSet::from([string(source, "sourceHash")?.to_owned()]);
    if let Some(related) = source.get("relatedSourceHashes") {
        for hash in related.as_array().ok_or_else(invalid)? {
            hashes.insert(hash.as_str().ok_or_else(invalid)?.to_owned());
        }
    }
    Ok(hashes)
}
fn source_preserved(old: &Value, new: &Value, pending: bool) -> Result<bool> {
    if old["kind"] == "garmin" && new["kind"] == "garmin" {
        let mut old_facts = old.as_object().cloned().ok_or_else(invalid)?;
        let mut new_facts = new.as_object().cloned().ok_or_else(invalid)?;
        old_facts.remove("relatedSourceHashes");
        new_facts.remove("relatedSourceHashes");
        if pending {
            old_facts.remove("sourceHash");
            new_facts.remove("sourceHash");
        }
        return Ok(old_facts == new_facts && garmin_hashes(old)?.is_subset(&garmin_hashes(new)?));
    }
    if pending && old["kind"] == "manual" && new["kind"] == "manual" {
        let mut old_facts = old.as_object().cloned().ok_or_else(invalid)?;
        let mut new_facts = new.as_object().cloned().ok_or_else(invalid)?;
        old_facts.remove("legacyShoeCredit");
        new_facts.remove("legacyShoeCredit");
        return Ok(old_facts == new_facts);
    }
    Ok(old == new)
}
fn indexed<'a>(values: &'a [Value]) -> Result<BTreeMap<&'a str, &'a Value>> {
    let mut map = BTreeMap::new();
    for item in values {
        if map.insert(string(item, "id")?, item).is_some() {
            return Err(invalid());
        }
    }
    Ok(map)
}

/// Generic saves may not replace records that have become immutable evidence.
pub(crate) fn guard_linked_evidence(before: &Value, after: &Value) -> Result<()> {
    if before["schemaVersion"] != 7 {
        return Ok(());
    }
    let logical = state(before)?;
    let mut all_sources = Vec::new();
    for activity in array(&logical, "activities")? {
        let current = array(activity, "versions")?.last().ok_or_else(invalid)?;
        all_sources.extend(array(current, "sources")?);
    }
    if let Some(pending) = logical.get("pending").and_then(Value::as_array) {
        for item in pending {
            all_sources.extend(array(&item["command"], "sources")?);
        }
    }
    for source in all_sources {
        let references: Vec<(&str, &str)> = match string(source, "kind")? {
            "manual" => vec![("journals", string(source, "sourceId")?)],
            "fit" => vec![
                ("fitSources", string(source, "sourceId")?),
                ("fitSourceActivities", string(source, "activityId")?),
                ("activities", string(source, "activityId")?),
            ],
            "garmin" => Vec::new(),
            _ => return Err(invalid()),
        };
        for (collection, id) in references {
            let previous = before
                .get(collection)
                .and_then(Value::as_array)
                .and_then(|items| items.iter().find(|item| item["id"] == id));
            if let Some(previous) = previous {
                let current = after
                    .get(collection)
                    .and_then(Value::as_array)
                    .and_then(|items| items.iter().find(|item| item["id"] == id))
                    .ok_or_else(invalid)?;
                if current != previous {
                    return Err(invalid());
                }
            }
        }
    }
    Ok(())
}

/// Enforce append-only history and reject any changes outside this command.
fn validate_transition(before: &Value, after: &Value) -> Result<Value> {
    if after["schemaVersion"] != 7 {
        return Err(invalid());
    }
    let old_state = state(before)?;
    let new_state = state(after)?;
    let mut base_before = before.as_object().cloned().ok_or_else(invalid)?;
    let mut base_after = after.as_object().cloned().ok_or_else(invalid)?;
    base_before.remove("schemaVersion");
    base_after.remove("schemaVersion");
    base_before.remove("logicalActivities");
    base_after.remove("logicalActivities");
    if base_before != base_after {
        return Err(invalid());
    }
    let old_commands = array(&old_state, "commands")?;
    let new_commands = array(&new_state, "commands")?;
    if new_commands.len() != old_commands.len() + 1 || !new_commands.starts_with(old_commands) {
        return Err(invalid());
    }
    let commands = indexed(new_commands)?;
    let command = new_commands.last().ok_or_else(invalid)?;
    let command_id = string(command, "id")?;
    let old_pending = old_state
        .get("pending")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let new_pending = new_state
        .get("pending")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let retained: Vec<Value> = old_pending
        .iter()
        .filter(|item| item["id"] != command_id)
        .cloned()
        .collect();
    if retained != new_pending {
        return Err(invalid());
    }
    string(command, "fingerprint")?;
    let receipt = command.get("receipt").ok_or_else(invalid)?;
    if string(receipt, "commandId")? != command_id {
        return Err(invalid());
    }
    let activity_id = string(receipt, "logicalActivityId")?;
    let event_id = string(receipt, "confirmationEventId")?;
    let confirmed_at = string(receipt, "confirmedAt")?;
    let revision = receipt
        .get("committedRevision")
        .and_then(Value::as_u64)
        .filter(|r| *r > 0)
        .ok_or_else(invalid)?;
    let old = indexed(array(&old_state, "activities")?)?;
    let new = indexed(array(&new_state, "activities")?)?;
    if old.keys().any(|id| !new.contains_key(id)) || new.len() > old.len() + 1 {
        return Err(invalid());
    }
    if let Some(pending) = old_pending.iter().find(|item| item["id"] == command_id) {
        let incoming = array(&pending["command"], "sources")?;
        let activity = new.get(activity_id).ok_or_else(invalid)?;
        let current = array(activity, "versions")?.last().ok_or_else(invalid)?;
        let sources = array(current, "sources")?;
        for old_source in incoming {
            let key = source_key(old_source)?;
            let current_source = sources
                .iter()
                .find(|source| source_key(source).is_ok_and(|current_key| current_key == key))
                .ok_or_else(invalid)?;
            if !source_preserved(old_source, current_source, true)? {
                return Err(invalid());
            }
        }
    }
    let mut sources = BTreeSet::new();
    let mut events = BTreeSet::new();
    for (id, item) in &new {
        if item["confirmationState"] != "confirmed" {
            return Err(invalid());
        }
        let initial = item.get("confirmed").ok_or_else(invalid)?;
        if string(initial, "logicalActivityId")? != *id
            || !events.insert(string(initial, "confirmationEventId")?)
        {
            return Err(invalid());
        }
        let versions = array(item, "versions")?;
        if versions.is_empty() {
            return Err(invalid());
        }
        let initial_command = string(initial, "commandId")?;
        if commands.get(initial_command).and_then(|c| c.get("receipt")) != Some(initial) {
            return Err(invalid());
        }
        let mut prior_sources = BTreeMap::new();
        for (i, version) in versions.iter().enumerate() {
            if version["revision"].as_u64() != Some(i as u64 + 1) {
                return Err(invalid());
            }
            let mut current_sources = BTreeMap::new();
            for source in array(version, "sources")? {
                if current_sources
                    .insert(source_key(source)?, source)
                    .is_some()
                {
                    return Err(invalid());
                }
            }
            if current_sources.is_empty()
                || prior_sources.iter().any(|(key, value)| {
                    current_sources.get(key).is_none_or(|current| {
                        !source_preserved(value, current, false).unwrap_or(false)
                    })
                })
            {
                return Err(invalid());
            }
            prior_sources = current_sources;
        }
        for key in prior_sources.keys() {
            if !sources.insert(key.clone()) {
                return Err(invalid());
            }
        }
        if *id == activity_id {
            if string(initial, "confirmationEventId")? != event_id
                || string(initial, "confirmedAt")? != confirmed_at
                || revision != versions.len() as u64
            {
                return Err(invalid());
            }
            if let Some(previous) = old.get(id) {
                let old_versions = array(previous, "versions")?;
                let mut old_item = previous.as_object().cloned().ok_or_else(invalid)?;
                let mut new_item = item.as_object().cloned().ok_or_else(invalid)?;
                old_item.remove("versions");
                new_item.remove("versions");
                if old_item != new_item
                    || versions.len() != old_versions.len() + 1
                    || !versions.starts_with(old_versions)
                {
                    return Err(invalid());
                }
            } else if versions.len() != 1 || initial != receipt {
                return Err(invalid());
            }
        } else if old.get(id).copied() != Some(*item) {
            return Err(invalid());
        }
    }
    if !new.contains_key(activity_id) {
        return Err(invalid());
    }
    Ok(receipt.clone())
}

fn validate_deferred_transition(before: &Value, after: &Value) -> Result<Value> {
    if after["schemaVersion"] != 7 {
        return Err(invalid());
    }
    let old_state = state(before)?;
    let new_state = state(after)?;
    let mut old_base = before.as_object().cloned().ok_or_else(invalid)?;
    let mut new_base = after.as_object().cloned().ok_or_else(invalid)?;
    old_base.remove("schemaVersion");
    new_base.remove("schemaVersion");
    old_base.remove("logicalActivities");
    new_base.remove("logicalActivities");
    if old_base != new_base
        || old_state["activities"] != new_state["activities"]
        || old_state["commands"] != new_state["commands"]
    {
        return Err(invalid());
    }
    let old_pending = old_state
        .get("pending")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let new_pending = new_state
        .get("pending")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if new_pending.len() != old_pending.len() + 1 || !new_pending.starts_with(&old_pending) {
        return Err(invalid());
    }
    let item = new_pending.last().ok_or_else(invalid)?;
    let id = string(item, "id")?;
    string(item, "createdAt")?;
    let command = item.get("command").ok_or_else(invalid)?;
    if string(command, "commandId")? != id
        || old_pending.iter().any(|old| old["id"] == id)
        || array(&old_state, "commands")?
            .iter()
            .any(|old| old["id"] == id)
    {
        return Err(invalid());
    }
    if array(command, "sources")?.is_empty() {
        return Err(invalid());
    }
    Ok(item.clone())
}

impl Store {
    fn verify_activity_sources(&self, snapshot: &Value, receipt: &Value) -> Result<()> {
        let logical = state(snapshot)?;
        let activity_id = string(receipt, "logicalActivityId")?;
        let activity = array(&logical, "activities")?
            .iter()
            .find(|item| item["id"] == activity_id)
            .ok_or_else(invalid)?;
        let current = array(activity, "versions")?.last().ok_or_else(invalid)?;
        self.verify_sources(snapshot, array(current, "sources")?, true)
    }
    fn verify_sources(
        &self,
        snapshot: &Value,
        sources: &[Value],
        require_attribution: bool,
    ) -> Result<()> {
        let storage = FitSourceStorage::new(self.sources.clone());
        for source in sources {
            match string(source, "kind")? {
                "manual" => {
                    let original = source.get("original").ok_or_else(invalid)?;
                    if string(original, "id")? != string(source, "sourceId")? {
                        return Err(invalid());
                    }
                    string(original, "date")?;
                    string(original, "updatedAt")?;
                    if let Some(journals) = snapshot.get("journals").and_then(Value::as_array) {
                        if let Some(existing) =
                            journals.iter().find(|entry| entry["id"] == original["id"])
                        {
                            if existing != original {
                                return Err(invalid());
                            }
                            if require_attribution {
                                if let Some(shoe) = existing.get("shoeId").and_then(Value::as_str) {
                                    let attribution =
                                        source.get("legacyShoeCredit").ok_or_else(invalid)?;
                                    if !attribution.is_null() {
                                        if string(attribution, "shoeId")? != shoe
                                            || attribution["distanceMiles"]
                                                != existing["actualDistanceMiles"]
                                        {
                                            return Err(invalid());
                                        }
                                        let miles = attribution["distanceMiles"]
                                            .as_f64()
                                            .filter(|value| *value >= 0.0)
                                            .ok_or_else(invalid)?;
                                        let balance = array(snapshot, "shoes")?
                                            .iter()
                                            .find(|item| item["id"] == shoe)
                                            .and_then(|item| item["mileageMiles"].as_f64())
                                            .ok_or_else(invalid)?;
                                        if balance < miles {
                                            return Err(invalid());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                "fit" => {
                    let hash = string(source, "sourceHash")?;
                    let source_id = string(source, "sourceId")?;
                    let activity_id = string(source, "activityId")?;
                    let original = array(snapshot, "fitSources")?
                        .iter()
                        .find(|item| {
                            item["id"] == source_id
                                && item["sourceHash"] == hash
                                && item["preservationStatus"] == "verified"
                        })
                        .ok_or_else(invalid)?;
                    let recording = array(snapshot, "fitSourceActivities")?
                        .iter()
                        .find(|item| item["id"] == activity_id && item["sourceId"] == source_id)
                        .ok_or_else(invalid)?;
                    if source["occurredAt"] != recording["occurredAt"]
                        || (source["localDate"] != Value::Null
                            && source["localDate"] != recording["localDate"])
                    {
                        return Err(invalid());
                    }
                    let bytes = storage.read(hash).map_err(|_| error("source"))?;
                    if original["byteLength"].as_u64() != Some(bytes.len() as u64) {
                        return Err(error("source"));
                    }
                }
                "garmin" => {
                    let provider_id = string(source, "providerId")?;
                    let primary_hash = string(source, "sourceHash")?;
                    storage
                        .verify_garmin_receipt(provider_id, primary_hash)
                        .map_err(|_| error("source"))?;
                    let mut declared = match source.get("relatedSourceHashes") {
                        Some(value) => value
                            .as_array()
                            .ok_or_else(invalid)?
                            .iter()
                            .map(|item| item.as_str().map(str::to_owned).ok_or_else(invalid))
                            .collect::<Result<Vec<_>>>()?,
                        None => vec![primary_hash.to_owned()],
                    };
                    let count = declared.len();
                    declared.sort();
                    declared.dedup();
                    if declared.len() != count
                        || !declared.contains(&primary_hash.to_owned())
                        || storage
                            .garmin_source_hashes(provider_id)
                            .map_err(|_| error("source"))?
                            != declared
                    {
                        return Err(error("source"));
                    }
                }
                _ => return Err(invalid()),
            }
        }
        Ok(())
    }
    async fn backup_before_activity_upgrade(&self, expected: &str) -> Result<()> {
        let _guards = guard(&self.database, false)?;
        let mut source = self.connect(true).await?;
        check_schema(&mut source).await?;
        let current: String = sqlx::query_scalar("SELECT payload FROM app_state WHERE id=1")
            .fetch_one(&mut source)
            .await?;
        // A retry after a lost acknowledgement is handled inside the transaction.
        if current != expected {
            return Ok(());
        }
        let before = inventory(&mut source).await?;
        let directory = self
            .database
            .parent()
            .ok_or_else(|| error("backup"))?
            .join("activity-safety");
        std::fs::create_dir_all(&directory).map_err(|_| error("backup"))?;
        let path = directory.join(format!("before-activity-{}.sqlite", uuid::Uuid::new_v4()));
        let _copy_guard = guard(&path, true).map_err(|_| error("backup"))?;
        sqlx::query("VACUUM INTO ?")
            .bind(path.to_str().ok_or_else(|| error("backup"))?)
            .execute(&mut source)
            .await
            .map_err(|_| error("backup"))?;
        let _verified_guard = guard(&path, false).map_err(|_| error("backup"))?;
        std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .and_then(|file| file.sync_all())
            .map_err(|_| error("backup"))?;
        let mut copy = sqlx::SqliteConnection::connect_with(
            &sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&path)
                .read_only(true),
        )
        .await
        .map_err(|_| error("backup"))?;
        integrity(&mut copy).await.map_err(|_| error("backup"))?;
        if inventory(&mut copy).await.map_err(|_| error("backup"))? != before {
            return Err(error("backup"));
        }
        let copied: String = sqlx::query_scalar("SELECT payload FROM app_state WHERE id=1")
            .fetch_one(&mut copy)
            .await
            .map_err(|_| error("backup"))?;
        if copied != expected {
            return Err(error("backup"));
        }
        copy.close().await.map_err(|_| error("backup"))?;
        source.close().await?;
        Ok(())
    }
    /// Returns a receipt only after FULL-synchronous SQLite commit. An identical
    /// command retry returns its already committed receipt even after later edits.
    pub async fn save_logical_activity(&self, request: ActivitySaveRequest) -> Result<Value> {
        if request.contract_version != 1
            || request.before.len() > 32 * 1024 * 1024
            || request.after.len() > 32 * 1024 * 1024
        {
            return Err(invalid());
        }
        let before: Value = serde_json::from_str(&request.before).map_err(|_| invalid())?;
        let after: Value = serde_json::from_str(&request.after).map_err(|_| invalid())?;
        let deferred = match request.operation.as_deref() {
            None | Some("confirm") => false,
            Some("defer") => true,
            _ => return Err(invalid()),
        };
        let result = if deferred {
            validate_deferred_transition(&before, &after)?
        } else {
            validate_transition(&before, &after)?
        };
        let command = if deferred {
            result.clone()
        } else {
            array(&state(&after)?, "commands")?
                .last()
                .cloned()
                .ok_or_else(invalid)?
        };
        if before["schemaVersion"] != 7 {
            self.backup_before_activity_upgrade(&request.before).await?;
        }
        let _guards = guard(&self.database, false)?;
        let mut db = self.connect(false).await?;
        sqlx::query("PRAGMA synchronous=FULL")
            .execute(&mut db)
            .await?;
        let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
        check_schema(&mut tx).await?;
        let current: String = sqlx::query_scalar("SELECT payload FROM app_state WHERE id=1")
            .fetch_one(&mut *tx)
            .await?;
        if current != request.before {
            let snapshot: Value = serde_json::from_str(&current).map_err(|_| error("corrupt"))?;
            let current_state = state(&snapshot)?;
            let entries = if deferred {
                current_state
                    .get("pending")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
            } else {
                array(&current_state, "commands")?.clone()
            };
            if let Some(existing) = entries.iter().find(|entry| entry["id"] == command["id"]) {
                if existing != &command {
                    return Err(invalid());
                }
                return Ok(if deferred {
                    json!({"status":"review-later","commandId":existing["id"]})
                } else {
                    existing["receipt"].clone()
                });
            }
            return Err(error("conflict"));
        }
        if deferred {
            self.verify_sources(&after, array(&result["command"], "sources")?, false)?;
        } else {
            self.verify_activity_sources(&after, &result)?;
        }
        let changed = sqlx::query("UPDATE app_state SET payload=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1 AND payload=?")
            .bind(&request.after).bind(&request.before).execute(&mut *tx).await?;
        if changed.rows_affected() != 1 {
            return Err(error("conflict"));
        }
        #[cfg(test)]
        if self.fault == Some("activity_before_commit") {
            return Err(error("storage"));
        }
        tx.commit().await?;
        Ok(if deferred {
            json!({"status":"review-later","commandId":result["id"]})
        } else {
            result
        })
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use sqlx::sqlite::SqliteConnectOptions;
    use std::{fs, path::PathBuf};

    struct Profile(PathBuf);
    impl Profile {
        async fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("stride-d3-synthetic-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            let profile = Self(path);
            let mut db = sqlx::SqliteConnection::connect_with(
                &SqliteConnectOptions::new()
                    .filename(profile.store(None).database)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
            sqlx::query("CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL)").execute(&mut db).await.unwrap();
            sqlx::query("INSERT INTO app_state VALUES(1,?,'synthetic')")
                .bind(Self::before().to_string())
                .execute(&mut db)
                .await
                .unwrap();
            db.close().await.unwrap();
            profile
        }
        fn store(&self, fault: Option<&'static str>) -> Store {
            Store {
                database: self.0.join("synthetic.sqlite"),
                sources: self.0.join("sources"),
                fault,
            }
        }
        fn before() -> Value {
            json!({"schemaVersion":4,"history":"synthetic"})
        }
        fn after() -> Value {
            let receipt = json!({"commandId":"cmd","logicalActivityId":"activity","committedRevision":1,"confirmationEventId":"event","confirmedAt":"2026-11-24T12:00:00Z"});
            json!({"schemaVersion":7,"history":"synthetic","logicalActivities":{"activities":[{"id":"activity","confirmationState":"confirmed","confirmed":receipt,"versions":[{"revision":1,"sources":[{"kind":"manual","sourceId":"manual","original":{"id":"manual","date":"2026-11-24","updatedAt":"2026-11-24T12:00:00Z"}}]}]}],"commands":[{"id":"cmd","fingerprint":"synthetic","receipt":receipt}]}})
        }
        fn request() -> ActivitySaveRequest {
            ActivitySaveRequest {
                contract_version: 1,
                before: Self::before().to_string(),
                after: Self::after().to_string(),
                operation: None,
            }
        }
    }
    impl Drop for Profile {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[tokio::test]
    async fn commits_then_retries_identically_after_reopen() {
        let profile = Profile::new().await;
        let receipt = profile
            .store(None)
            .save_logical_activity(Profile::request())
            .await
            .unwrap();
        assert_eq!(receipt["commandId"], "cmd");
        let retry = profile
            .store(None)
            .save_logical_activity(Profile::request())
            .await
            .unwrap();
        assert_eq!(retry, receipt);
        let backup = fs::read_dir(profile.0.join("activity-safety"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let mut recovered = sqlx::SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(&backup)
                .read_only(true),
        )
        .await
        .unwrap();
        let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_one(&mut recovered)
            .await
            .unwrap();
        assert_eq!(integrity, "ok");
        let saved_before: String = sqlx::query_scalar("SELECT payload FROM app_state WHERE id=1")
            .fetch_one(&mut recovered)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&saved_before).unwrap(),
            Profile::before()
        );
        recovered.close().await.unwrap();
        let mut db = profile.store(None).connect(true).await.unwrap();
        let persisted: String = sqlx::query_scalar("SELECT payload FROM app_state WHERE id=1")
            .fetch_one(&mut db)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&persisted).unwrap(),
            Profile::after()
        );
    }
    #[tokio::test]
    async fn fails_without_acknowledgement_or_published_data() {
        let profile = Profile::new().await;
        assert!(profile
            .store(Some("activity_before_commit"))
            .save_logical_activity(Profile::request())
            .await
            .is_err());
        let mut db = profile.store(None).connect(true).await.unwrap();
        let persisted: String = sqlx::query_scalar("SELECT payload FROM app_state WHERE id=1")
            .fetch_one(&mut db)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&persisted).unwrap(),
            Profile::before()
        );
    }
    #[tokio::test]
    async fn review_later_is_durable_and_does_not_create_confirmed_credit() {
        let profile = Profile::new().await;
        let before = Profile::before();
        let mut deferred = before.clone();
        deferred["schemaVersion"] = json!(7);
        let source = Profile::after()["logicalActivities"]["activities"][0]["versions"][0]
            ["sources"][0]
            .clone();
        deferred["logicalActivities"] = json!({"activities":[],"commands":[],"pending":[{"id":"cmd","createdAt":"2026-11-24T12:00:00Z","command":{"commandId":"cmd","sources":[source]}}]});
        let request = || ActivitySaveRequest {
            contract_version: 1,
            before: before.to_string(),
            after: deferred.to_string(),
            operation: Some("defer".into()),
        };
        assert_eq!(
            profile
                .store(None)
                .save_logical_activity(request())
                .await
                .unwrap()["status"],
            "review-later"
        );
        assert_eq!(
            profile
                .store(None)
                .save_logical_activity(request())
                .await
                .unwrap()["status"],
            "review-later"
        );
        let mut db = profile.store(None).connect(true).await.unwrap();
        let raw: String = sqlx::query_scalar("SELECT payload FROM app_state WHERE id=1")
            .fetch_one(&mut db)
            .await
            .unwrap();
        let stored: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(stored["logicalActivities"]["activities"], json!([]));
        assert_eq!(
            stored["logicalActivities"]["pending"][0]["command"]["sources"][0],
            source
        );
        db.close().await.unwrap();
        let confirm = ActivitySaveRequest {
            contract_version: 1,
            before: deferred.to_string(),
            after: Profile::after().to_string(),
            operation: None,
        };
        assert!(profile
            .store(None)
            .save_logical_activity(confirm)
            .await
            .is_ok());
    }
    #[tokio::test]
    async fn ordinary_saves_cannot_overwrite_committed_activity_history() {
        let profile = Profile::new().await;
        profile
            .store(None)
            .save_logical_activity(Profile::request())
            .await
            .unwrap();
        let before = Profile::after();
        let mut after = before.clone();
        after["history"] = json!("ordinary edit");
        profile
            .store(None)
            .save_active(crate::active_plan_store::SaveRequest {
                contract_version: 1,
                before: before.to_string(),
                after: after.to_string(),
            })
            .await
            .unwrap();
        let mut stale = after.clone();
        stale["logicalActivities"] = json!({"activities":[],"commands":[]});
        assert!(profile
            .store(None)
            .save_active(crate::active_plan_store::SaveRequest {
                contract_version: 1,
                before: after.to_string(),
                after: stale.to_string()
            })
            .await
            .is_err());
        let mut db = profile.store(None).connect(true).await.unwrap();
        let raw: String = sqlx::query_scalar("SELECT payload FROM app_state WHERE id=1")
            .fetch_one(&mut db)
            .await
            .unwrap();
        assert_eq!(serde_json::from_str::<Value>(&raw).unwrap(), after);
        db.close().await.unwrap();
        let backup = profile.0.join("synthetic-complete-backup.sqlite");
        let mut writable = profile.store(None).connect(false).await.unwrap();
        sqlx::query("VACUUM INTO ?")
            .bind(backup.to_str().unwrap())
            .execute(&mut writable)
            .await
            .unwrap();
        writable.close().await.unwrap();
        let recovered = profile.0.join("synthetic-recovered.sqlite");
        fs::copy(&backup, &recovered).unwrap();
        let mut recovered_db = sqlx::SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(&recovered)
                .read_only(true),
        )
        .await
        .unwrap();
        let recovered_raw: String = sqlx::query_scalar("SELECT payload FROM app_state WHERE id=1")
            .fetch_one(&mut recovered_db)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&recovered_raw).unwrap(),
            after
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("PRAGMA integrity_check")
                .fetch_one(&mut recovered_db)
                .await
                .unwrap(),
            "ok"
        );
        recovered_db.close().await.unwrap();
    }
    #[tokio::test]
    async fn accepts_only_verified_original_fit_and_garmin_receipts() {
        for kind in ["fit", "garmin"] {
            let profile = Profile::new().await;
            fs::create_dir(profile.0.join("sources")).unwrap();
            let bytes = b"\x0c\x20\x00\x00\x00\x00\x00\x00.FITsynthetic\x00\xff";
            let hash = crate::plan_draft_store::hash(bytes);
            let storage = FitSourceStorage::new(profile.0.join("sources"));
            storage.store(&hash, bytes).unwrap();
            if kind == "garmin" {
                storage.store_garmin_receipt("123", &hash).unwrap();
            }
            let source_id = format!("fit-source:{hash}");
            let mut before = Profile::before();
            before["fitSources"] = json!([{ "id": source_id, "sourceHash":hash, "byteLength":bytes.len(), "preservationStatus":"verified" }]);
            before["fitSourceActivities"] = json!([{ "id":"recording", "sourceId":source_id, "occurredAt":"2026-11-24T10:00:00Z" }]);
            let mut after = before.clone();
            after["schemaVersion"] = json!(7);
            after["logicalActivities"] = Profile::after()["logicalActivities"].clone();
            after["logicalActivities"]["activities"][0]["versions"][0]["sources"] = if kind == "fit"
            {
                json!([{ "kind":"fit", "sourceId":source_id, "sourceHash":hash, "activityId":"recording", "occurredAt":"2026-11-24T10:00:00Z", "localDate":null }])
            } else {
                json!([{ "kind":"garmin", "providerId":"123", "sourceHash":hash }])
            };
            let mut db = profile.store(None).connect(false).await.unwrap();
            sqlx::query("UPDATE app_state SET payload=? WHERE id=1")
                .bind(before.to_string())
                .execute(&mut db)
                .await
                .unwrap();
            db.close().await.unwrap();
            let request = ActivitySaveRequest {
                contract_version: 1,
                before: before.to_string(),
                after: after.to_string(),
                operation: None,
            };
            assert!(profile
                .store(None)
                .save_logical_activity(request)
                .await
                .is_ok());
        }
    }
    #[tokio::test]
    async fn refuses_to_omit_an_older_receipt_for_the_same_garmin_identity() {
        let profile = Profile::new().await;
        fs::create_dir(profile.0.join("sources")).unwrap();
        let first = b"\x0c\x20\x00\x00\x00\x00\x00\x00.FITsynthetic\x00\xff".to_vec();
        let mut second = first.clone();
        second.push(42);
        let first_hash = crate::plan_draft_store::hash(&first);
        let second_hash = crate::plan_draft_store::hash(&second);
        let storage = FitSourceStorage::new(profile.0.join("sources"));
        storage.store(&first_hash, &first).unwrap();
        storage.store(&second_hash, &second).unwrap();
        storage.store_garmin_receipt("123", &first_hash).unwrap();
        storage.store_garmin_receipt("123", &second_hash).unwrap();
        let before = Profile::before();
        let mut after = Profile::after();
        after["logicalActivities"]["activities"][0]["versions"][0]["sources"] =
            json!([{ "kind":"garmin", "providerId":"123", "sourceHash":first_hash }]);
        let request = |value: &Value| ActivitySaveRequest {
            contract_version: 1,
            before: before.to_string(),
            after: value.to_string(),
            operation: None,
        };
        assert!(profile
            .store(None)
            .save_logical_activity(request(&after))
            .await
            .is_err());
        let mut hashes = vec![first_hash, second_hash];
        hashes.sort();
        after["logicalActivities"]["activities"][0]["versions"][0]["sources"][0]
            ["relatedSourceHashes"] = json!(hashes);
        assert!(profile
            .store(None)
            .save_logical_activity(request(&after))
            .await
            .is_ok());
    }
    #[test]
    fn rejects_unrelated_edits_and_reused_source_identities() {
        let before = Profile::before();
        let mut after = Profile::after();
        after["history"] = json!("changed");
        assert!(validate_transition(&before, &after).is_err());
        after = Profile::after();
        after["logicalActivities"]["activities"][0]["versions"][0]["sources"]
            .as_array_mut()
            .unwrap()
            .push(json!({"kind":"manual","sourceId":"manual"}));
        assert!(validate_transition(&before, &after).is_err());
    }
    #[test]
    fn ordinary_save_cannot_remove_or_rewrite_a_linked_manual_source() {
        let mut before = Profile::after();
        before["journals"] =
            json!([{ "id":"manual", "date":"2026-11-24", "updatedAt":"2026-11-24T12:00:00Z" }]);
        let mut changed = before.clone();
        changed["journals"][0]["note"] = json!("changed");
        assert!(guard_linked_evidence(&before, &changed).is_err());
        changed["journals"] = json!([]);
        assert!(guard_linked_evidence(&before, &changed).is_err());
        assert!(guard_linked_evidence(&before, &before).is_ok());
    }
}
