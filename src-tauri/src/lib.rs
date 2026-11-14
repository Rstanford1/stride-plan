#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Registered SQL migrations run inside Database.load, before the snapshot
        // can be validated or copied. Keep legacy tables untouched; the repository
        // initializes app_state only after establishing a genuinely empty store.
        .plugin(tauri_plugin_sql::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("failed to run Stride Plan");
}
