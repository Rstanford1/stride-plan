use crate::fit_source_store::{
    validate_request, ErrorCode, FitSourceStorage, Result, SourceError, SourceMetadata,
};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoreRequest {
    pub contract_version: u32,
    pub source_hash: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadRequest {
    pub contract_version: u32,
    pub source_hash: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadResponse {
    pub source: SourceMetadata,
    pub bytes: Vec<u8>,
}

fn storage(app: &tauri::AppHandle) -> Result<FitSourceStorage> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| SourceError::new(ErrorCode::StorageUnavailable))?;
    Ok(FitSourceStorage::new(root))
}

#[tauri::command]
pub async fn store_fit_source(
    app: tauri::AppHandle,
    request: StoreRequest,
) -> Result<SourceMetadata> {
    validate_request(request.contract_version, &request.source_hash)?;
    let storage = storage(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        storage.store(&request.source_hash, &request.bytes)
    })
    .await
    .map_err(|_| SourceError::new(ErrorCode::StorageUnavailable))?
}

#[tauri::command]
pub async fn read_fit_source(app: tauri::AppHandle, request: ReadRequest) -> Result<ReadResponse> {
    validate_request(request.contract_version, &request.source_hash)?;
    let storage = storage(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = storage.read(&request.source_hash)?;
        let source = SourceMetadata::new(&request.source_hash, bytes.len());
        Ok(ReadResponse { source, bytes })
    })
    .await
    .map_err(|_| SourceError::new(ErrorCode::StorageUnavailable))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wire_contract_round_trips_and_rejects_caller_paths() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../tests/fit-source-wire.json")).unwrap();
        let store: StoreRequest = serde_json::from_value(fixture["store"].clone()).unwrap();
        let read: ReadRequest = serde_json::from_value(fixture["read"].clone()).unwrap();
        let metadata: SourceMetadata = serde_json::from_value(fixture["metadata"].clone()).unwrap();
        let response: ReadResponse = serde_json::from_value(fixture["response"].clone()).unwrap();
        let error: SourceError = serde_json::from_value(fixture["error"].clone()).unwrap();
        assert_eq!(serde_json::to_value(store).unwrap(), fixture["store"]);
        assert_eq!(serde_json::to_value(read).unwrap(), fixture["read"]);
        assert_eq!(serde_json::to_value(metadata).unwrap(), fixture["metadata"]);
        assert_eq!(serde_json::to_value(response).unwrap(), fixture["response"]);
        assert_eq!(serde_json::to_value(error).unwrap(), fixture["error"]);
        let mut escaped = fixture["store"].clone();
        escaped["destination"] = "C:\\private\\outside.fit".into();
        assert!(serde_json::from_value::<StoreRequest>(escaped).is_err());
    }
}
