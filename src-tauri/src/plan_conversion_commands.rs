//! Saves only the two bundled conversion artifacts. No caller paths or bytes.
use crate::plan_draft_export::{save_selected, ExportOutcome};
use crate::plan_draft_store::{error, Result};
use serde::Deserialize;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    contract_version: u32,
    kind: Artifact,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Artifact {
    Schema,
    Example,
}

impl Artifact {
    fn contents(&self) -> (&'static str, &'static [u8]) {
        match self {
            Self::Schema => (
                "stride-plan-training-plan-1.2.schema.json",
                include_bytes!("../../schemas/training-plan/1.2.schema.json"),
            ),
            Self::Example => (
                "stride-plan-example-plan.json",
                include_bytes!("../../src/domain/__fixtures__/training-plan/valid-1.2-75plus.json"),
            ),
        }
    }
}

#[tauri::command]
pub async fn save_plan_conversion_file(
    app: tauri::AppHandle,
    request: Request,
) -> Result<ExportOutcome> {
    if request.contract_version != 1 {
        return Err(error("unsupported"));
    }
    let (name, bytes) = request.kind.contents();
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
            .set_title("Save training plan conversion file")
            .set_file_name(name)
            .add_filter("JSON file", &["json"])
            .blocking_save_file()
            .map(|file| file.into_path().map_err(|_| error("export_unsafe")))
            .transpose()?;
        // Application storage is protected by the shared writer. There is no
        // imported source involved in this operation, hence no source hash.
        save_selected(selected, bytes, "", &roots)
    })
    .await
    .map_err(|_| error("export_write"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_closed_artifact_requests() {
        for kind in ["schema", "example"] {
            let request: Request = serde_json::from_value(serde_json::json!({
                "contractVersion": 1, "kind": kind,
            }))
            .unwrap();
            let (name, bytes) = request.kind.contents();
            assert!(name.ends_with(".json"));
            let value: serde_json::Value = serde_json::from_slice(bytes).unwrap();
            assert_eq!(
                if kind == "schema" {
                    &value["$id"]
                } else {
                    &value["schemaVersion"]
                },
                if kind == "schema" {
                    "urn:stride-plan:training-plan:1.2"
                } else {
                    "1.2"
                }
            );
            assert!(matches!(
                save_selected(None, bytes, "", &[]).unwrap(),
                ExportOutcome::Cancelled {
                    contract_version: 1
                }
            ));
        }
        for input in [
            serde_json::json!({"contractVersion":1,"kind":"other"}),
            serde_json::json!({"contractVersion":1,"kind":"schema","path":"C:\\private"}),
            serde_json::json!({"contractVersion":1,"kind":"example","bytes":[1,2]}),
        ] {
            assert!(serde_json::from_value::<Request>(input).is_err());
        }
    }

    #[cfg(windows)]
    #[test]
    fn saves_exact_bundled_artifacts_without_touching_protected_storage() {
        let root =
            std::env::temp_dir().join(format!("stride-t07-download-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let protected = root.join("protected");
        let absent_profile = root.join("not-created").join("app-data");
        let (_, schema_bytes) = Artifact::Schema.contents();
        assert!(save_selected(
            Some(root.join("fresh-profile-schema.json")),
            schema_bytes,
            "",
            std::slice::from_ref(&absent_profile)
        )
        .is_ok());
        assert!(!absent_profile.parent().unwrap().exists());
        std::fs::create_dir(&protected).unwrap();
        for kind in [Artifact::Schema, Artifact::Example] {
            let (name, bytes) = kind.contents();
            let path = root.join(name);
            assert!(matches!(
                save_selected(
                    Some(path.clone()),
                    bytes,
                    "",
                    std::slice::from_ref(&protected)
                )
                .unwrap(),
                ExportOutcome::Saved { .. }
            ));
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
            let unsafe_path = protected.join(name);
            assert!(save_selected(
                Some(unsafe_path.clone()),
                bytes,
                "",
                std::slice::from_ref(&protected)
            )
            .is_err());
            assert!(!unsafe_path.exists());
        }
        assert!(root.starts_with(std::env::temp_dir()));
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("stride-t07-download-"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
