fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "store_fit_source",
            "read_fit_source",
            "garmin_status",
            "garmin_connect",
            "garmin_verify",
            "garmin_disconnect",
            "garmin_list_activities",
            "garmin_retrieve_activity",
            "garmin_cancel",
            "garmin_open_key_page",
        ]),
    ))
    .expect("failed to build Stride Plan permissions");
}
