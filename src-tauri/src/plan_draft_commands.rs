use crate::plan_draft_store::{error, Envelope, Inspection, Result, SaveRequest, Saved, Store};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub contract_version: u32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryRequest {
    pub contract_version: u32,
    pub envelope_json: String,
    pub expected_snapshot: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplacementRequest {
    pub contract_version: u32,
    pub before: String,
    pub after: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportSaveRequest {
    pub contract_version: u32,
    pub expected_recovery_hash: String,
}

fn storage(app: &tauri::AppHandle, version: u32) -> Result<Store> {
    if version != 1 {
        return Err(error("unsupported"));
    }
    Ok(Store {
        // Match tauri-plugin-sql's existing app_config_dir path exactly.
        database: app
            .path()
            .app_config_dir()
            .map_err(|_| error("storage"))?
            .join("stride-plan.db"),
        sources: app
            .path()
            .app_local_data_dir()
            .map_err(|_| error("storage"))?,
        #[cfg(test)]
        fault: None,
    })
}
#[tauri::command]
pub async fn inspect_plan_draft(app: tauri::AppHandle, request: Request) -> Result<Inspection> {
    storage(&app, request.contract_version)?.inspect().await
}
#[tauri::command]
pub async fn save_plan_draft(app: tauri::AppHandle, request: SaveRequest) -> Result<Saved> {
    storage(&app, request.contract_version)?.save(request).await
}
#[tauri::command]
pub async fn read_plan_draft(app: tauri::AppHandle, request: Request) -> Result<Option<Saved>> {
    storage(&app, request.contract_version)?.read().await
}
#[tauri::command]
pub async fn export_plan_draft(app: tauri::AppHandle, request: Request) -> Result<String> {
    let envelope = storage(&app, request.contract_version)?.export().await?;
    serde_json::to_string(&envelope).map_err(|_| error("storage"))
}
#[tauri::command]
pub async fn save_plan_draft_recovery(
    app: tauri::AppHandle,
    request: ExportSaveRequest,
) -> Result<crate::plan_draft_export::ExportOutcome> {
    use crate::{
        plan_draft_export::{save_selected, DEFAULT_FILE_NAME},
        plan_draft_store::hash,
    };
    if request.expected_recovery_hash.len() != 64
        || !request
            .expected_recovery_hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(error("invalid"));
    }
    // The webview verifies this same envelope with T01 before asking to save it.
    // Native code chooses the payload and dialog destination, never the caller.
    let envelope = storage(&app, request.contract_version)?.export().await?;
    let source_hash = envelope.record.source_hash.clone();
    let bytes = serde_json::to_vec(&envelope).map_err(|_| error("storage"))?;
    if hash(&bytes) != request.expected_recovery_hash {
        return Err(error("export_conflict"));
    }
    let roots = vec![
        app.path()
            .app_config_dir()
            .map_err(|_| error("export_unsafe"))?,
        app.path()
            .app_local_data_dir()
            .map_err(|_| error("export_unsafe"))?,
    ];
    tauri::async_runtime::spawn_blocking(move || {
        let parent = app
            .get_webview_window("main")
            .ok_or_else(|| error("export_write"))?;
        let selected = app
            .dialog()
            .file()
            .set_parent(&parent)
            .set_title("Export draft recovery")
            .set_file_name(DEFAULT_FILE_NAME)
            .add_filter("JSON recovery", &["json"])
            .blocking_save_file()
            .map(|file| file.into_path().map_err(|_| error("export_unsafe")))
            .transpose()?;
        save_selected(selected, &bytes, &source_hash, &roots)
    })
    .await
    .map_err(|_| error("export_write"))?
}
#[tauri::command]
pub async fn recover_plan_draft(app: tauri::AppHandle, request: RecoveryRequest) -> Result<Saved> {
    let store = storage(&app, request.contract_version)?;
    if request.envelope_json.len() > 16 * 1024 * 1024 {
        return Err(error("invalid"));
    }
    let envelope: Envelope =
        serde_json::from_str(&request.envelope_json).map_err(|_| error("invalid"))?;
    store.recover(envelope, &request.expected_snapshot).await
}
#[tauri::command]
pub async fn replace_legacy_snapshot(
    app: tauri::AppHandle,
    request: ReplacementRequest,
) -> Result<()> {
    // Snapshot validation and verified restore copies remain T02's responsibility.
    // This command adds the atomic native-draft guard and exact-payload CAS.
    storage(&app, request.contract_version)?
        .replace_snapshot(&request.before, &request.after)
        .await
}
