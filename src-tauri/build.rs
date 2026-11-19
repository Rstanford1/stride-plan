fn main() {
    let commands: &'static [&'static str] = &[
        "store_fit_source",
        "read_fit_source",
        "inspect_plan_draft",
        "save_plan_draft",
        "read_plan_draft",
        "export_plan_draft",
        "save_plan_draft_recovery",
        "save_plan_conversion_file",
        "recover_plan_draft",
        "replace_legacy_snapshot",
        #[cfg(not(feature = "qa-isolated"))]
        "garmin_status",
        #[cfg(not(feature = "qa-isolated"))]
        "garmin_connect",
        #[cfg(not(feature = "qa-isolated"))]
        "garmin_verify",
        #[cfg(not(feature = "qa-isolated"))]
        "garmin_disconnect",
        #[cfg(not(feature = "qa-isolated"))]
        "garmin_list_activities",
        #[cfg(not(feature = "qa-isolated"))]
        "garmin_retrieve_activity",
        #[cfg(not(feature = "qa-isolated"))]
        "garmin_cancel",
        #[cfg(not(feature = "qa-isolated"))]
        "garmin_open_key_page",
    ];
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("failed to build Stride Plan permissions");
}
