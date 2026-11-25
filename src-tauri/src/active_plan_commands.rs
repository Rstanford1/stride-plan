use crate::logical_activity_store::ActivitySaveRequest;
use crate::{
    active_plan_store::{ActivationRequest, ActiveInspection, SaveRequest},
    plan_draft_commands::{storage, Request},
    plan_draft_store::Result,
};

#[tauri::command]
pub async fn inspect_active_plan(
    app: tauri::AppHandle,
    request: Request,
) -> Result<ActiveInspection> {
    storage(&app, request.contract_version)?
        .inspect_active()
        .await
}

#[tauri::command]
pub async fn activate_training_plan(
    app: tauri::AppHandle,
    request: ActivationRequest,
) -> Result<()> {
    storage(&app, request.contract_version)?
        .activate(request)
        .await
}

#[tauri::command]
pub async fn save_active_snapshot(app: tauri::AppHandle, request: SaveRequest) -> Result<()> {
    storage(&app, request.contract_version)?
        .save_active(request)
        .await
}

#[tauri::command]
pub async fn save_logical_activity(
    app: tauri::AppHandle,
    request: ActivitySaveRequest,
) -> Result<serde_json::Value> {
    storage(&app, request.contract_version)?
        .save_logical_activity(request)
        .await
}
