mod fit_source_commands;
mod fit_source_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fit_source_commands::store_fit_source,
            fit_source_commands::read_fit_source,
        ])
        // Registered SQL migrations run inside Database.load, before the snapshot
        // can be validated or copied. Keep legacy tables untouched; the repository
        // initializes app_state only after establishing a genuinely empty store.
        .plugin(tauri_plugin_sql::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("failed to run Stride Plan");
}
