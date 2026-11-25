//! The active schedule is app_state. These immutable rows retain the validated
//! source and an audit of activation and source-backed schedule changes.
use crate::plan_draft_store::{
    check_schema, error, execute_active_ddl, execute_ddl, guard, hash, integrity, inventory,
    migration_inventory, source_value, DraftError, Result, Store, VERSION_DDL,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Connection, Row};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationRequest {
    pub contract_version: u32,
    pub activation_id: String,
    pub before: String,
    pub after: String,
    pub source_bytes: Vec<u8>,
    pub source_hash: String,
    pub validator_fingerprint: String,
    pub effective_date: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveRequest {
    pub contract_version: u32,
    pub before: String,
    pub after: String,
}

fn same_source_identity(before: &Value, after: &Value) -> bool {
    [
        "id",
        "sourceKey",
        "sourceSessionId",
        "sourceDayId",
        "sourcePlanId",
        "sourceVersionId",
        "originalDate",
        "originalDistanceMiles",
        "originalDistance",
        "originalDuration",
        "plannedDuration",
        "week",
    ]
    .iter()
    .all(|key| before.get(*key) == after.get(*key))
}

fn source_for_session<'a>(
    sources: &'a std::collections::BTreeMap<String, Value>,
    session: &Value,
) -> Result<(&'a Value, &'a Value, &'a Value)> {
    let scheduled_id = id(session)?;
    let activation_id = scheduled_id
        .strip_prefix("active:")
        .and_then(|s| s.split_once(":session:"))
        .map(|x| x.0)
        .ok_or_else(invalid)?;
    let plan = sources.get(activation_id).ok_or_else(invalid)?;
    for week in items(plan, "weeks")? {
        for day in items(week, "days")? {
            if day["id"] != session["sourceDayId"] {
                continue;
            }
            for source_session in items(day, "sessions")? {
                if source_session["id"] == session["sourceSessionId"] {
                    return Ok((week, day, source_session));
                }
            }
        }
    }
    Err(invalid())
}

fn guard_save(
    before: &Value,
    after: &Value,
    sources: &std::collections::BTreeMap<String, Value>,
    effective_dates: &std::collections::BTreeMap<String, String>,
) -> Result<Vec<Value>> {
    crate::logical_activity_store::guard_linked_evidence(before, after)?;
    let versions_match = (before["schemaVersion"] == 5 && after["schemaVersion"] == 5)
        || (before["schemaVersion"] == 7
            && after["schemaVersion"] == 7
            && before
                .get("logicalActivities")
                .is_some_and(Value::is_object)
            && before.get("logicalActivities") == after.get("logicalActivities"));
    if !versions_match {
        return Err(error("unsupported"));
    }
    let old_days = indexed(before, "days")?;
    let new_days = indexed(after, "days")?;
    for (key, old) in &old_days {
        if new_days.get(key) != Some(old) {
            return Err(invalid());
        }
    }
    for (key, _) in &new_days {
        if !old_days.contains_key(key) {
            return Err(invalid());
        }
    }
    let old_sessions = indexed(before, "sessions")?;
    let new_sessions = indexed(after, "sessions")?;
    let mut moves = Vec::new();
    for (key, old) in &old_sessions {
        let new = new_sessions.get(key).ok_or_else(invalid)?;
        if old.get("sourceSessionId").is_none() {
            if new.get("sourceSessionId").is_some() {
                return Err(invalid());
            }
            continue;
        }
        if old.get("retiredAt") != new.get("retiredAt") || !same_source_identity(old, new) {
            return Err(invalid());
        }
        let old_revisions = items(old, "revisions")?;
        let new_revisions = items(new, "revisions")?;
        if !new_revisions.starts_with(old_revisions) {
            return Err(invalid());
        }
        let appended = &new_revisions[old_revisions.len()..];
        let old_object = old.as_object().ok_or_else(invalid)?;
        let new_object = new.as_object().ok_or_else(invalid)?;
        for field in old_object.keys().chain(new_object.keys()) {
            if ["revisions", "plannedDistance", "status"].contains(&field.as_str()) {
                continue;
            }
            if old.get(field) == new.get(field) {
                continue;
            }
            let from = old.get(field).unwrap_or(&Value::Null);
            let to = new.get(field).unwrap_or(&Value::Null);
            if !appended.iter().any(|revision| {
                revision["field"] == *field && revision["from"] == *from && revision["to"] == *to
            }) {
                return Err(invalid());
            }
        }
        if old["status"] != new["status"]
            && !appended.iter().any(|r| {
                r["field"] == "status" && r["from"] == old["status"] && r["to"] == new["status"]
            })
            && !(new["status"] == "moved" && old["scheduledDate"] != new["scheduledDate"])
        {
            return Err(invalid());
        }
        if old.get("plannedDistance") != new.get("plannedDistance") {
            let expected = if new["plannedDistanceMiles"].is_null() {
                None
            } else {
                Some(json!({"kind":"exact","value":new["plannedDistanceMiles"],"unit":"mi"}))
            };
            if old["plannedDistanceMiles"] == new["plannedDistanceMiles"]
                || new.get("plannedDistance") != expected.as_ref()
            {
                return Err(invalid());
            }
        }
        let (week, day, source) = source_for_session(sources, new)?;
        if new["sourcePlanId"]
            != sources
                .get(
                    key.strip_prefix("active:")
                        .and_then(|s| s.split_once(":session:"))
                        .map(|x| x.0)
                        .ok_or_else(invalid)?,
                )
                .ok_or_else(invalid)?["manifest"]["planId"]
            || new["sourceVersionId"]
                != sources
                    .get(
                        key.strip_prefix("active:")
                            .and_then(|s| s.split_once(":session:"))
                            .map(|x| x.0)
                            .ok_or_else(invalid)?,
                    )
                    .ok_or_else(invalid)?["manifest"]["versionId"]
        {
            return Err(invalid());
        }
        let date = string(new, "scheduledDate")?;
        let activation_id = key
            .strip_prefix("active:")
            .and_then(|s| s.split_once(":session:"))
            .map(|x| x.0)
            .ok_or_else(invalid)?;
        if date
            < effective_dates
                .get(activation_id)
                .ok_or_else(invalid)?
                .as_str()
        {
            return Err(error("conflict"));
        }
        let policy = source.get("schedulingPolicy").and_then(Value::as_str);
        if policy == Some("fixed-date") && date != string(day, "date")? {
            return Err(error("conflict"));
        }
        if policy == Some("movable-within-week")
            && (date < string(week, "startDate")? || date > string(week, "endDate")?)
        {
            return Err(error("conflict"));
        }
        if source["role"] == "double" && new.get("retiredAt").is_none() {
            let primary = string(source, "primarySessionId")?;
            let primary_id = format!(
                "active:{}:session:{}",
                key.strip_prefix("active:")
                    .and_then(|s| s.split_once(":session:"))
                    .map(|x| x.0)
                    .ok_or_else(invalid)?,
                primary
            );
            let primary_session = new_sessions.get(&primary_id).ok_or_else(invalid)?;
            if primary_session["scheduledDate"] != new["scheduledDate"] {
                return Err(error("conflict"));
            }
        }
        if old["scheduledDate"] != new["scheduledDate"] {
            if !new_revisions[old_revisions.len()..].iter().any(|r| {
                r["field"] == "scheduledDate"
                    && r["from"] == old["scheduledDate"]
                    && r["to"] == new["scheduledDate"]
            }) {
                return Err(invalid());
            }
            moves.push(
                json!({"sessionId":key,"from":old["scheduledDate"],"to":new["scheduledDate"]}),
            );
        }
    }
    for (key, new) in &new_sessions {
        if !old_sessions.contains_key(key) && new.get("sourceSessionId").is_some() {
            return Err(invalid());
        }
    }
    // A logged result or source association may be edited, but never detached
    // from its historical session by a generic app_state save.
    for key in ["activities", "journals"] {
        let old = indexed(before, key)?;
        let new = indexed(after, key)?;
        for (record_id, record) in old {
            if record.get(if key == "activities" {
                "plannedSessionId"
            } else {
                "sessionId"
            }) != new
                .get(&record_id)
                .ok_or_else(invalid)?
                .get(if key == "activities" {
                    "plannedSessionId"
                } else {
                    "sessionId"
                })
            {
                return Err(invalid());
            }
        }
    }
    Ok(moves)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveInspection {
    pub contract_version: u32,
    pub activation_id: Option<String>,
    pub effective_date: Option<String>,
    pub source_bytes: Option<Vec<u8>>,
    pub source_hash: Option<String>,
}

fn invalid() -> DraftError {
    error("invalid")
}
fn value(raw: &str) -> Result<Value> {
    serde_json::from_str(raw).map_err(|_| invalid())
}
fn source_json(bytes: &[u8]) -> Result<Value> {
    let text = std::str::from_utf8(bytes).map_err(|_| error("corrupt"))?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| error("corrupt"))
}
fn items<'a>(v: &'a Value, key: &str) -> Result<&'a [Value]> {
    v.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or_else(invalid)
}
fn id<'a>(v: &'a Value) -> Result<&'a str> {
    v.get("id").and_then(Value::as_str).ok_or_else(invalid)
}
fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v.get(key).and_then(Value::as_str).ok_or_else(invalid)
}
fn indexed<'a>(v: &'a Value, key: &str) -> Result<std::collections::BTreeMap<String, &'a Value>> {
    let mut map = std::collections::BTreeMap::new();
    for item in items(v, key)? {
        if map.insert(id(item)?.to_owned(), item).is_some() {
            return Err(invalid());
        }
    }
    Ok(map)
}
fn source_sessions(
    source: &Value,
    effective: &str,
) -> Result<Vec<(String, String, String, String, Value, i64)>> {
    let mut result = Vec::new();
    for week in items(source, "weeks")? {
        for day in items(week, "days")? {
            let date = string(day, "date")?;
            if date < effective {
                continue;
            }
            let week_number = week["number"].as_i64().ok_or_else(invalid)?;
            result.push((
                id(day)?.into(),
                date.into(),
                string(day, "kind")?.into(),
                String::new(),
                Value::Null,
                week_number,
            ));
            for session in items(day, "sessions")? {
                result.push((
                    id(day)?.into(),
                    date.into(),
                    string(day, "kind")?.into(),
                    id(session)?.into(),
                    session.clone(),
                    week_number,
                ));
            }
        }
    }
    Ok(result)
}
fn source_eligible(source: &Value) -> Result<()> {
    for week in items(source, "weeks")? {
        for day in items(week, "days")? {
            let sessions = items(day, "sessions")?;
            for session in sessions {
                if session["role"] == "unspecified" || session["runType"] == "unspecified" {
                    return Err(invalid());
                }
                if source["schemaVersion"] == "1.2"
                    && !["fixed-date", "movable-within-week"]
                        .contains(&session["schedulingPolicy"].as_str().unwrap_or(""))
                {
                    return Err(invalid());
                }
                if session["role"] == "double" {
                    let primary = string(session, "primarySessionId")?;
                    if !sessions
                        .iter()
                        .any(|item| item["id"] == primary && item["role"] == "main")
                    {
                        return Err(invalid());
                    }
                }
            }
        }
    }
    Ok(())
}
fn source_quantity(source: &Value) -> Result<Option<Value>> {
    if source.is_null() {
        return Ok(None);
    }
    let unit = string(source, "unit")?;
    if let Some(value) = source.get("value") {
        return Ok(Some(json!({"kind":"exact","value":value,"unit":unit})));
    }
    if source.get("min").is_some() && source.get("max").is_some() {
        return Ok(Some(
            json!({"kind":"range","min":source["min"],"max":source["max"],"unit":unit}),
        ));
    }
    Err(invalid())
}
fn source_miles(source: &Value) -> Result<Option<f64>> {
    let Some(value) = source.get("value").and_then(Value::as_f64) else {
        return Ok(None);
    };
    let factor = match string(source, "unit")? {
        "mi" => 1.0,
        "km" => 1.609344,
        "m" => 1609.344,
        _ => return Err(invalid()),
    };
    Ok(Some(value / factor))
}
fn matching_miles(actual: &Value, expected: Option<f64>) -> bool {
    match (actual.as_f64(), expected) {
        (None, None) => actual.is_null(),
        (Some(a), Some(b)) => (a - b).abs() <= 1e-9,
        _ => false,
    }
}
fn validate_activation(request: &ActivationRequest) -> Result<(Value, Value, Value)> {
    if request.contract_version != 1
        || request.activation_id.is_empty()
        || request.source_hash != hash(&request.source_bytes)
        || request.effective_date.len() != 10
        || request.after.len() > 32 * 1024 * 1024
        || request.before.len() > 32 * 1024 * 1024
    {
        return Err(invalid());
    }
    let source_header = source_value(&request.source_bytes)?;
    let expected_fingerprint =
        crate::plan_draft_store::version_fingerprint(&source_header.schema_version, false);
    if request.validator_fingerprint != expected_fingerprint {
        return Err(error("unsupported"));
    }
    let source = source_json(&request.source_bytes)?;
    source_eligible(&source)?;
    let before = value(&request.before)?;
    let after = value(&request.after)?;
    if ![4, 5, 7].contains(&before["schemaVersion"].as_i64().unwrap_or(-1))
        || (before["schemaVersion"] == 7 && after["schemaVersion"] != 7)
        || (before["schemaVersion"] != 7 && after["schemaVersion"] != 5)
    {
        return Err(invalid());
    }
    if request.effective_date < string(&source["calendar"], "startDate")?.to_owned()
        || request.effective_date > string(&source["calendar"], "endDate")?.to_owned()
    {
        return Err(invalid());
    }
    // Activation may only add new source-backed days/sessions and retire the
    // current/future schedule. Every old result and association stays intact.
    for key in [
        "activities",
        "journals",
        "settings",
        "importFingerprints",
        "shoes",
        "fitSources",
        "fitSourceActivities",
        "fitImportBatches",
        "logicalActivities",
    ] {
        if before[key] != after[key] {
            return Err(invalid());
        }
    }
    let previous = indexed(&before, "sessions")?;
    let next = indexed(&after, "sessions")?;
    for (key, old) in &previous {
        let new = next.get(key).ok_or_else(invalid)?;
        let mut expected = (*old).clone();
        if before["schemaVersion"] == 4
            || (before["schemaVersion"] == 7 && before.get("days").is_none())
        {
            expected.as_object_mut().ok_or_else(invalid)?.insert(
                "originalDistance".into(),
                json!({"kind":"exact","value":old["originalDistanceMiles"],"unit":"mi"}),
            );
            expected.as_object_mut().ok_or_else(invalid)?.insert(
                "plannedDistance".into(),
                json!({"kind":"exact","value":old["plannedDistanceMiles"],"unit":"mi"}),
            );
        }
        let date = string(old, "scheduledDate")?;
        if old.get("retiredAt").is_none() && date >= request.effective_date.as_str() {
            if !items(old, "revisions")?.is_empty()
                || old["status"] != "planned"
                || items(&before, "activities")?
                    .iter()
                    .any(|a| a["plannedSessionId"] == *key)
                || items(&before, "journals")?
                    .iter()
                    .any(|j| j["sessionId"] == *key)
                || before
                    .get("logicalActivities")
                    .and_then(|state| state["activities"].as_array())
                    .is_some_and(|activities| {
                        activities.iter().any(|activity| {
                            activity["versions"]
                                .as_array()
                                .and_then(|versions| versions.last())
                                .is_some_and(|version| version["plannedSessionId"] == *key)
                        })
                    })
            {
                return Err(error("conflict"));
            }
            let retired = new
                .get("retiredAt")
                .and_then(Value::as_str)
                .ok_or_else(invalid)?;
            if retired.is_empty() {
                return Err(invalid());
            }
            expected
                .as_object_mut()
                .ok_or_else(invalid)?
                .insert("retiredAt".into(), json!(retired));
        }
        if expected != **new {
            return Err(invalid());
        }
    }
    let before_days = if before.get("days").is_some() {
        indexed(&before, "days")?
    } else {
        Default::default()
    };
    let after_days = indexed(&after, "days")?;
    for (key, old) in &before_days {
        let new = after_days.get(key).ok_or_else(invalid)?;
        let mut expected = (*old).clone();
        if old.get("retiredAt").is_none()
            && string(old, "originalDate")? >= request.effective_date.as_str()
        {
            let retired = new
                .get("retiredAt")
                .and_then(Value::as_str)
                .ok_or_else(invalid)?;
            expected
                .as_object_mut()
                .ok_or_else(invalid)?
                .insert("retiredAt".into(), json!(retired));
        }
        if expected != **new {
            return Err(invalid());
        }
    }
    let expected_source = source_sessions(&source, &request.effective_date)?;
    let new_sessions: Vec<_> = next
        .iter()
        .filter(|(key, _)| !previous.contains_key(*key))
        .collect();
    let new_days: Vec<_> = after_days
        .iter()
        .filter(|(key, _)| !before_days.contains_key(*key))
        .collect();
    if new_sessions.len() != expected_source.iter().filter(|x| !x.3.is_empty()).count()
        || new_days.len() != expected_source.iter().filter(|x| x.3.is_empty()).count()
    {
        return Err(invalid());
    }
    for (source_day, date, kind, source_session, original, week_number) in expected_source {
        let day_id = format!("active:{}:day:{}", request.activation_id, source_day);
        let day = after_days.get(&day_id).ok_or_else(invalid)?;
        if day["sourceDayId"] != source_day
            || day["sourcePlanId"] != source_header.manifest.plan_id
            || day["sourceVersionId"] != source_header.manifest.version_id
            || day["originalDate"] != date
            || day["kind"] != kind
            || day.get("retiredAt").is_some()
        {
            return Err(invalid());
        }
        if source_session.is_empty() {
            continue;
        }
        let session_id = format!(
            "active:{}:session:{}",
            request.activation_id, source_session
        );
        let session = next.get(&session_id).ok_or_else(invalid)?;
        let distance = source_quantity(&original["distance"])?;
        let duration = source_quantity(&original["duration"])?;
        let miles = source_miles(&original["distance"])?;
        let coach_text = items(&original, "coachText")?
            .iter()
            .map(|x| x.as_str().ok_or_else(invalid))
            .collect::<Result<Vec<_>>>()?
            .join("\n");
        if session["sourceSessionId"] != source_session
            || session["sourceDayId"] != source_day
            || session["sourcePlanId"] != source_header.manifest.plan_id
            || session["sourceVersionId"] != source_header.manifest.version_id
            || session["originalDate"] != date
            || session["scheduledDate"] != date
            || session["title"] != original["title"]
            || session["kind"] != original["runType"]
            || session["sourceKey"]
                != format!(
                    "plan:{}:{}:{}",
                    source_header.manifest.plan_id,
                    source_header.manifest.version_id,
                    source_session
                )
            || session["week"] != week_number
            || session["flexible"] != (original["completionClass"] == "flexible")
            || session["instructions"] != coach_text
            || session.get("originalDistance") != distance.as_ref()
            || session.get("plannedDistance") != distance.as_ref()
            || session.get("originalDuration") != duration.as_ref()
            || session.get("plannedDuration") != duration.as_ref()
            || !matching_miles(&session["originalDistanceMiles"], miles)
            || !matching_miles(&session["plannedDistanceMiles"], miles)
            || session["status"] != "planned"
            || !items(session, "revisions")?.is_empty()
            || session.get("retiredAt").is_some()
        {
            return Err(invalid());
        }
    }
    Ok((before, after, source))
}

impl Store {
    pub async fn save_active(&self, request: SaveRequest) -> Result<()> {
        if request.contract_version != 1
            || request.before.len() > 32 * 1024 * 1024
            || request.after.len() > 32 * 1024 * 1024
        {
            return Err(invalid());
        }
        let _guards = guard(&self.database, false)?;
        let mut db = self.connect(false).await?;
        sqlx::query("PRAGMA synchronous=FULL")
            .execute(&mut db)
            .await?;
        let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
        let db_version = check_schema(&mut tx).await?;
        let current: String = sqlx::query_scalar("SELECT payload FROM app_state WHERE id=1")
            .fetch_one(&mut *tx)
            .await?;
        if current != request.before {
            return Err(error("conflict"));
        }
        let before = value(&request.before)?;
        let after = value(&request.after)?;
        if db_version != 5 {
            if ![0, 3, 4].contains(&db_version)
                || before["schemaVersion"] != 7
                || after["schemaVersion"] != 7
                || !before
                    .get("logicalActivities")
                    .is_some_and(Value::is_object)
                || before.get("logicalActivities") != after.get("logicalActivities")
                || before.get("days").is_some()
                || after.get("days").is_some()
            {
                return Err(error("unsupported"));
            }
            crate::logical_activity_store::guard_linked_evidence(&before, &after)?;
            let changed = sqlx::query("UPDATE app_state SET payload=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1 AND payload=?")
                .bind(&request.after).bind(&request.before).execute(&mut *tx).await?;
            if changed.rows_affected() != 1 {
                return Err(error("conflict"));
            }
            tx.commit().await?;
            return Ok(());
        }
        let mut sources = std::collections::BTreeMap::new();
        let mut effective_dates = std::collections::BTreeMap::new();
        let rows = sqlx::query("SELECT record_id,source_hash,payload FROM active_plan_records WHERE record_kind='activation' ORDER BY sequence").fetch_all(&mut *tx).await?;
        if rows.is_empty() {
            return Err(error("corrupt"));
        }
        for row in rows {
            let record_id: String = row.try_get("record_id")?;
            let source_hash: String = row.try_get("source_hash")?;
            let payload: Value = serde_json::from_str(&row.try_get::<String, _>("payload")?)
                .map_err(|_| error("corrupt"))?;
            let bytes = STANDARD
                .decode(string(&payload, "sourceBase64")?)
                .map_err(|_| error("corrupt"))?;
            if hash(&bytes) != source_hash {
                return Err(error("corrupt"));
            }
            effective_dates.insert(
                record_id.clone(),
                string(&payload, "effectiveDate")?.to_owned(),
            );
            sources.insert(record_id, source_json(&bytes)?);
        }
        let moves = guard_save(&before, &after, &sources, &effective_dates)?;
        if !moves.is_empty() {
            let source_hash: String = sqlx::query_scalar("SELECT source_hash FROM active_plan_records WHERE record_kind='activation' ORDER BY sequence DESC LIMIT 1").fetch_one(&mut *tx).await?;
            let event = json!({"contractVersion":1,"beforeHash":hash(request.before.as_bytes()),"afterHash":hash(request.after.as_bytes()),"moves":moves});
            sqlx::query("INSERT INTO active_plan_records(record_id,record_kind,source_hash,payload,recorded_at) VALUES(?,'schedule',?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
                .bind(uuid::Uuid::new_v4().to_string()).bind(source_hash).bind(event.to_string()).execute(&mut *tx).await?;
        }
        let changed = sqlx::query("UPDATE app_state SET payload=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1 AND payload=?")
            .bind(&request.after).bind(&request.before).execute(&mut *tx).await?;
        if changed.rows_affected() != 1 {
            return Err(error("conflict"));
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn inspect_active(&self) -> Result<ActiveInspection> {
        if !self.database.try_exists().map_err(|_| error("storage"))? {
            return Ok(ActiveInspection {
                contract_version: 1,
                activation_id: None,
                effective_date: None,
                source_bytes: None,
                source_hash: None,
            });
        }
        let _guards = guard(&self.database, false)?;
        let mut db = self.connect(true).await?;
        let version = check_schema(&mut db).await?;
        if version != 5 {
            return Ok(ActiveInspection {
                contract_version: 1,
                activation_id: None,
                effective_date: None,
                source_bytes: None,
                source_hash: None,
            });
        }
        let rows = sqlx::query("SELECT record_id,source_hash,payload FROM active_plan_records WHERE record_kind='activation' ORDER BY sequence").fetch_all(&mut db).await?;
        if rows.is_empty() {
            return Err(error("corrupt"));
        }
        let mut active = None;
        for row in rows {
            let payload: Value = serde_json::from_str(&row.try_get::<String, _>("payload")?)
                .map_err(|_| error("corrupt"))?;
            let bytes = STANDARD
                .decode(string(&payload, "sourceBase64")?)
                .map_err(|_| error("corrupt"))?;
            let source_hash: String = row.try_get("source_hash")?;
            if hash(&bytes) != source_hash {
                return Err(error("corrupt"));
            }
            let header = source_value(&bytes)?;
            if payload["schemaVersion"] != header.schema_version
                || payload["planId"] != header.manifest.plan_id
                || payload["versionId"] != header.manifest.version_id
                || payload["validatorFingerprint"]
                    != crate::plan_draft_store::version_fingerprint(&header.schema_version, false)
            {
                return Err(error("corrupt"));
            }
            active = Some(ActiveInspection {
                contract_version: 1,
                activation_id: Some(row.try_get("record_id")?),
                effective_date: Some(string(&payload, "effectiveDate")?.into()),
                source_bytes: Some(bytes),
                source_hash: Some(source_hash),
            });
        }
        active.ok_or_else(|| error("corrupt"))
    }

    pub async fn activate(&self, request: ActivationRequest) -> Result<()> {
        let (before_snapshot, after_snapshot, source) = validate_activation(&request)?;
        let _guards = guard(&self.database, false)?;
        let mut db = self.connect(true).await?;
        let version = check_schema(&mut db).await?;
        if version != 3 && version != 4 && version != 5 {
            return Err(error("unsupported"));
        }
        if version == 5 {
            self.inspect_active().await?;
        }
        let today: String = sqlx::query_scalar("SELECT date('now','localtime')")
            .fetch_one(&mut db)
            .await?;
        if request.effective_date != today {
            return Err(invalid());
        }
        let raw: String = sqlx::query_scalar("SELECT payload FROM app_state WHERE id=1")
            .fetch_one(&mut db)
            .await?;
        if raw != request.before {
            return Err(error("conflict"));
        }
        let before_inventory = inventory(&mut db).await?;
        let copy_dir = self
            .database
            .parent()
            .ok_or_else(|| error("backup"))?
            .join("active-plan-safety");
        std::fs::create_dir_all(&copy_dir).map_err(|_| error("backup"))?;
        let copy = copy_dir.join(format!("before-v5-{}.sqlite", uuid::Uuid::new_v4()));
        let _copy_guards = guard(&copy, true).map_err(|_| error("backup"))?;
        sqlx::query("VACUUM INTO ?")
            .bind(copy.to_str().ok_or_else(|| error("backup"))?)
            .execute(&mut db)
            .await
            .map_err(|_| error("backup"))?;
        #[cfg(test)]
        if self.fault == Some("active_backup_corrupt") {
            std::fs::write(&copy, b"synthetic corrupt copy").map_err(|_| error("backup"))?;
        }
        let _verified_guards = guard(&copy, false).map_err(|_| error("backup"))?;
        std::fs::OpenOptions::new()
            .write(true)
            .open(&copy)
            .and_then(|f| f.sync_all())
            .map_err(|_| error("backup"))?;
        let mut backup = sqlx::SqliteConnection::connect_with(
            &sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&copy)
                .read_only(true),
        )
        .await
        .map_err(|_| error("backup"))?;
        integrity(&mut backup).await.map_err(|_| error("backup"))?;
        if inventory(&mut backup).await.map_err(|_| error("backup"))? != before_inventory {
            return Err(error("backup"));
        }
        backup.close().await.map_err(|_| error("backup"))?;
        db.close().await?;
        let mut db = self.connect(false).await?;
        sqlx::query("PRAGMA synchronous=FULL")
            .execute(&mut db)
            .await?;
        let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
        if check_schema(&mut tx).await? != version || inventory(&mut tx).await? != before_inventory
        {
            return Err(error("conflict"));
        }
        let current: String = sqlx::query_scalar("SELECT payload FROM app_state WHERE id=1")
            .fetch_one(&mut *tx)
            .await?;
        if current != request.before {
            return Err(error("conflict"));
        }
        if version == 3 {
            execute_ddl(&mut tx, VERSION_DDL).await?;
        }
        if version < 5 {
            let after_legacy_migration = if version == 3 {
                migration_inventory(&mut tx, version).await?
            } else {
                inventory(&mut tx).await?
            };
            if after_legacy_migration != before_inventory {
                return Err(error("corrupt"));
            }
            execute_active_ddl(&mut tx).await?;
            sqlx::query("PRAGMA user_version=5")
                .execute(&mut *tx)
                .await?;
        }
        let old_sessions = indexed(&before_snapshot, "sessions")?;
        let new_sessions = indexed(&after_snapshot, "sessions")?;
        let old_days = if before_snapshot.get("days").is_some() {
            indexed(&before_snapshot, "days")?
        } else {
            Default::default()
        };
        let new_days = indexed(&after_snapshot, "days")?;
        let mappings: Vec<Value> = new_sessions.iter().filter(|(key, _)| !old_sessions.contains_key(*key)).map(|(key, item)| json!({"scheduleId":key,"sourceId":item["sourceSessionId"],"sourceDayId":item["sourceDayId"],"identity":"app-assigned"})).collect();
        let day_mappings: Vec<Value> = new_days.iter().filter(|(key, _)| !old_days.contains_key(*key)).map(|(key, item)| json!({"scheduleId":key,"sourceId":item["sourceDayId"],"identity":"app-assigned"})).collect();
        let retired_sessions: Vec<&String> = old_sessions
            .iter()
            .filter(|(key, old)| {
                old.get("retiredAt").is_none()
                    && new_sessions
                        .get(*key)
                        .and_then(|v| v.get("retiredAt"))
                        .is_some()
            })
            .map(|(key, _)| key)
            .collect();
        let retired_days: Vec<&String> = old_days
            .iter()
            .filter(|(key, old)| {
                old.get("retiredAt").is_none()
                    && new_days
                        .get(*key)
                        .and_then(|v| v.get("retiredAt"))
                        .is_some()
            })
            .map(|(key, _)| key)
            .collect();
        let payload = json!({"contractVersion":1,"effectiveDate":request.effective_date,"sourceBase64":STANDARD.encode(&request.source_bytes),"schemaVersion":source["schemaVersion"],"planId":source["manifest"]["planId"],"versionId":source["manifest"]["versionId"],"validatorFingerprint":request.validator_fingerprint,"beforeHash":hash(request.before.as_bytes()),"afterHash":hash(request.after.as_bytes()),"sessionMappings":mappings,"dayMappings":day_mappings,"retiredSessionIds":retired_sessions,"retiredDayIds":retired_days});
        sqlx::query("INSERT INTO active_plan_records(record_id,record_kind,source_hash,payload,recorded_at) VALUES(?,'activation',?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
            .bind(&request.activation_id).bind(&request.source_hash).bind(payload.to_string()).execute(&mut *tx).await?;
        #[cfg(test)]
        if self.fault == Some("active_after_record") {
            return Err(error("storage"));
        }
        let changed = sqlx::query("UPDATE app_state SET payload=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1 AND payload=?")
            .bind(&request.after).bind(&request.before).execute(&mut *tx).await?;
        if changed.rows_affected() != 1 {
            return Err(error("conflict"));
        }
        check_schema(&mut tx).await?;
        integrity(&mut tx).await?;
        tx.commit().await?;
        Ok(())
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
            let path = std::env::temp_dir()
                .join(format!("stride-active-synthetic-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            let result = Self(path);
            let mut db = sqlx::SqliteConnection::connect_with(
                &SqliteConnectOptions::new()
                    .filename(result.store().database)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
            sqlx::query("CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL)").execute(&mut db).await.unwrap();
            execute_ddl(&mut db, crate::plan_draft_store::DDL)
                .await
                .unwrap();
            execute_ddl(&mut db, VERSION_DDL).await.unwrap();
            sqlx::query("PRAGMA user_version=4")
                .execute(&mut db)
                .await
                .unwrap();
            sqlx::query("INSERT INTO app_state VALUES(1,?,'synthetic')")
                .bind(Self::before())
                .execute(&mut db)
                .await
                .unwrap();
            db.close().await.unwrap();
            result
        }
        fn before() -> String {
            json!({"schemaVersion":4,"sessions":[],"activities":[],"journals":[],"shoes":[],"fitSources":[],"fitSourceActivities":[],"fitImportBatches":[],"settings":{"distanceUnit":"mi"},"importFingerprints":[]}).to_string()
        }
        fn store(&self) -> Store {
            Store {
                database: self.0.join("synthetic.sqlite"),
                sources: self.0.join("sources"),
                fault: None,
            }
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
                        .starts_with("stride-active-synthetic-")
            );
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    async fn input(activation_id: &str, before: String) -> (ActivationRequest, String) {
        let mut source: Value = serde_json::from_str(include_str!(
            "../../src/domain/__fixtures__/training-plan/valid-independent.json"
        ))
        .unwrap();
        let mut db = sqlx::SqliteConnection::connect("sqlite::memory:")
            .await
            .unwrap();
        let today: String = sqlx::query_scalar("SELECT date('now','localtime')")
            .fetch_one(&mut db)
            .await
            .unwrap();
        let tomorrow: String = sqlx::query_scalar("SELECT date('now','localtime','+1 day')")
            .fetch_one(&mut db)
            .await
            .unwrap();
        source["calendar"]["startDate"] = json!(today);
        source["calendar"]["endDate"] = json!(tomorrow);
        source["weeks"][0]["startDate"] = json!(today);
        source["weeks"][0]["endDate"] = json!(tomorrow);
        source["weeks"][0]["days"][0]["date"] = json!(today);
        source["weeks"][0]["days"][1]["date"] = json!(tomorrow);
        let bytes = format!("\u{feff}{}", source).into_bytes();
        let mut after: Value = serde_json::from_str(&before).unwrap();
        after["schemaVersion"] = json!(5);
        if after.get("days").is_none() {
            after["days"] = json!([]);
        }
        for item in after["sessions"].as_array_mut().unwrap() {
            if item.get("retiredAt").is_none() {
                item["retiredAt"] = json!("2026-11-23T00:00:00Z");
            }
        }
        for item in after["days"].as_array_mut().unwrap() {
            if item.get("retiredAt").is_none() {
                item["retiredAt"] = json!("2026-11-23T00:00:00Z");
            }
        }
        after["days"].as_array_mut().unwrap().extend([
            json!({"id":format!("active:{activation_id}:day:day-1"),"sourceDayId":"day-1","sourcePlanId":"synthetic-plan","sourceVersionId":"synthetic-version-1","originalDate":today,"kind":"training"}),
            json!({"id":format!("active:{activation_id}:day:day-2"),"sourceDayId":"day-2","sourcePlanId":"synthetic-plan","sourceVersionId":"synthetic-version-1","originalDate":tomorrow,"kind":"rest"}),
        ]);
        after["sessions"].as_array_mut().unwrap().push(json!({
            "id":format!("active:{activation_id}:session:session-1"),
            "sourceKey":"plan:synthetic-plan:synthetic-version-1:session-1",
            "sourceSessionId":"session-1","sourceDayId":"day-1","sourcePlanId":"synthetic-plan","sourceVersionId":"synthetic-version-1",
            "week":1,"originalDate":today,"scheduledDate":today,"originalDistanceMiles":null,"plannedDistanceMiles":null,
            "originalDuration":{"kind":"exact","value":30,"unit":"min"},"plannedDuration":{"kind":"exact","value":30,"unit":"min"},
            "title":"Synthetic independent run","kind":"easy","instructions":"  Synthetic easy effort.\r\nKeep this exact text.\n",
            "guidance":"","flexible":false,"phase":"","status":"planned","revisions":[]
        }));
        let after = after.to_string();
        (
            ActivationRequest {
                contract_version: 1,
                activation_id: activation_id.into(),
                before,
                after: after.clone(),
                source_hash: hash(&bytes),
                source_bytes: bytes,
                validator_fingerprint: crate::plan_draft_store::version_fingerprint("1.1", false),
                effective_date: today,
            },
            after,
        )
    }

    #[tokio::test]
    async fn migration_activation_guard_and_history_are_atomic() {
        let profile = Profile::new().await;
        let store = profile.store();
        let mut before = Profile::before();
        for index in 1..=3 {
            let activation_id = format!("synthetic-{index}");
            let (request, after) = input(&activation_id, before.clone()).await;
            let original_bytes = request.source_bytes.clone();
            store.activate(request).await.unwrap();
            assert_eq!(
                store.inspect_active().await.unwrap().source_bytes.unwrap(),
                original_bytes
            );
            let mut db = store.connect(true).await.unwrap();
            assert_eq!(check_schema(&mut db).await.unwrap(), 5);
            assert_eq!(
                sqlx::query_scalar::<_, String>("SELECT payload FROM app_state WHERE id=1")
                    .fetch_one(&mut db)
                    .await
                    .unwrap(),
                after
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT count(*) FROM active_plan_records WHERE record_kind='activation'"
                )
                .fetch_one(&mut db)
                .await
                .unwrap(),
                index
            );
            before = after;
        }
        let original = before.clone();
        let (stale, _) = input("stale-activation", Profile::before()).await;
        assert_eq!(store.activate(stale).await.unwrap_err().code, "conflict");
        let mut bad: Value = serde_json::from_str(&before).unwrap();
        bad["sessions"].as_array_mut().unwrap().pop();
        assert_eq!(
            store
                .save_active(SaveRequest {
                    contract_version: 1,
                    before: before.clone(),
                    after: bad.to_string()
                })
                .await
                .unwrap_err()
                .code,
            "invalid"
        );
        let mut db = store.connect(true).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT payload FROM app_state WHERE id=1")
                .fetch_one(&mut db)
                .await
                .unwrap(),
            original
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM active_plan_records")
                .fetch_one(&mut db)
                .await
                .unwrap(),
            3
        );
        assert_eq!(
            store
                .replace_snapshot(&before, &Profile::before())
                .await
                .unwrap_err()
                .code,
            "legacy_blocked"
        );
        assert!(
            fs::read_dir(profile.0.join("active-plan-safety"))
                .unwrap()
                .count()
                >= 3
        );
        let restored_path = profile.0.join("synthetic-restored-v5.sqlite");
        let mut writable = store.connect(false).await.unwrap();
        sqlx::query("VACUUM INTO ?")
            .bind(restored_path.to_str().unwrap())
            .execute(&mut writable)
            .await
            .unwrap();
        writable.close().await.unwrap();
        let restored = Store {
            database: restored_path,
            sources: store.sources.clone(),
            fault: None,
        };
        assert_eq!(
            restored
                .inspect_active()
                .await
                .unwrap()
                .activation_id
                .as_deref(),
            Some("synthetic-3")
        );
        let mut reopened = restored.connect(true).await.unwrap();
        assert_eq!(check_schema(&mut reopened).await.unwrap(), 5);
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT payload FROM app_state WHERE id=1")
                .fetch_one(&mut reopened)
                .await
                .unwrap(),
            original
        );
    }

    #[tokio::test]
    async fn failed_backup_or_interrupted_migration_does_not_publish_authority() {
        for fault in ["active_backup_corrupt", "active_after_record"] {
            let profile = Profile::new().await;
            let mut store = profile.store();
            store.fault = Some(fault);
            let (request, _) = input("rollback-proof", Profile::before()).await;
            assert!(store.activate(request).await.is_err());
            let mut db = store.connect(true).await.unwrap();
            assert_eq!(check_schema(&mut db).await.unwrap(), 4);
            assert_eq!(
                sqlx::query_scalar::<_, String>("SELECT payload FROM app_state WHERE id=1")
                    .fetch_one(&mut db)
                    .await
                    .unwrap(),
                Profile::before()
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT count(*) FROM sqlite_master WHERE name='active_plan_records'"
                )
                .fetch_one(&mut db)
                .await
                .unwrap(),
                0
            );
        }
    }

    #[test]
    fn fixed_dates_week_limits_and_linked_doubles_are_enforced() {
        let source: Value = serde_json::from_str(include_str!(
            "../../src/domain/__fixtures__/training-plan/valid-1.2-40.json"
        ))
        .unwrap();
        let make = |day: &Value, session: &Value| {
            json!({
                "id":format!("active:proof:session:{}",session["id"].as_str().unwrap()),
                "sourceSessionId":session["id"],"sourceDayId":day["id"],
                "sourcePlanId":source["manifest"]["planId"],"sourceVersionId":source["manifest"]["versionId"],
                "originalDate":day["date"],"scheduledDate":day["date"],"originalDistanceMiles":null,
                "plannedDistanceMiles":null,"status":"planned","revisions":[]
            })
        };
        let days = &source["weeks"][0]["days"];
        let base = json!({"schemaVersion":5,"days":[],"sessions":[
            make(&days[0],&days[0]["sessions"][0]),
            make(&days[1],&days[1]["sessions"][0]),
            make(&days[1],&days[1]["sessions"][1])
        ],"activities":[],"journals":[]});
        let sources = std::collections::BTreeMap::from([("proof".to_owned(), source)]);
        let dates =
            std::collections::BTreeMap::from([("proof".to_owned(), "2026-11-16".to_owned())]);
        let moved = |base: &Value, index: usize, date: &str| {
            let mut next = base.clone();
            let item = &mut next["sessions"][index];
            let old = item["scheduledDate"].clone();
            item["scheduledDate"] = json!(date);
            item["status"] = json!("moved");
            item["revisions"] = json!([{"id":format!("move-{index}"),"changedAt":"2026-11-16T00:00:00Z","field":"scheduledDate","from":old,"to":date,"reason":"Synthetic"}]);
            next
        };
        assert_eq!(
            guard_save(&base, &moved(&base, 0, "2026-11-18"), &sources, &dates)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            guard_save(&base, &moved(&base, 0, "2026-11-23"), &sources, &dates)
                .unwrap_err()
                .code,
            "conflict"
        );
        assert_eq!(
            guard_save(&base, &moved(&base, 2, "2026-11-18"), &sources, &dates)
                .unwrap_err()
                .code,
            "conflict"
        );
        let both = moved(&moved(&base, 1, "2026-11-18"), 2, "2026-11-18");
        assert_eq!(
            guard_save(&base, &both, &sources, &dates).unwrap_err().code,
            "conflict"
        );
    }
}
