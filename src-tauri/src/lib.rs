mod fit_source_commands;
mod fit_source_store;
mod garmin;
mod garmin_commands;
mod garmin_credentials;
mod plan_draft_commands;
mod plan_draft_export;
mod plan_draft_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(garmin_commands::GarminState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fit_source_commands::store_fit_source,
            fit_source_commands::read_fit_source,
            plan_draft_commands::inspect_plan_draft,
            plan_draft_commands::save_plan_draft,
            plan_draft_commands::read_plan_draft,
            plan_draft_commands::export_plan_draft,
            plan_draft_commands::save_plan_draft_recovery,
            plan_draft_commands::recover_plan_draft,
            plan_draft_commands::replace_legacy_snapshot,
            garmin_commands::garmin_status,
            garmin_commands::garmin_connect,
            garmin_commands::garmin_verify,
            garmin_commands::garmin_disconnect,
            garmin_commands::garmin_list_activities,
            garmin_commands::garmin_retrieve_activity,
            garmin_commands::garmin_cancel,
            garmin_commands::garmin_open_key_page,
        ])
        // Registered SQL migrations run inside Database.load, before the snapshot
        // can be validated or copied. Keep legacy tables untouched; the repository
        // initializes app_state only after establishing a genuinely empty store.
        .plugin(tauri_plugin_sql::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("failed to run Stride Plan");
}
