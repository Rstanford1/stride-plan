fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["store_fit_source", "read_fit_source"]),
    ))
    .expect("failed to build Stride Plan permissions");
}
