mod fit_source_commands;
mod fit_source_store;
#[cfg(not(feature = "qa-isolated"))]
mod garmin;
#[cfg(not(feature = "qa-isolated"))]
mod garmin_commands;
#[cfg(not(feature = "qa-isolated"))]
mod garmin_credentials;
mod plan_conversion_commands;
mod plan_draft_commands;
mod plan_draft_export;
mod plan_draft_store;

#[cfg(feature = "qa-isolated")]
fn qa_startup_trace() -> std::io::Result<std::fs::File> {
    use std::io::{Error, ErrorKind, Write};
    if std::env::var("GITHUB_ACTIONS").as_deref() != Ok("true")
        || std::env::var("RUNNER_ENVIRONMENT").as_deref() != Ok("github-hosted")
    {
        return Err(Error::new(
            ErrorKind::PermissionDenied,
            "QA requires a hosted runner",
        ));
    }
    let root = std::fs::canonicalize(
        std::env::var_os("STRIDE_QA_ROOT")
            .ok_or_else(|| Error::new(ErrorKind::NotFound, "QA root missing"))?,
    )?;
    let temp = std::fs::canonicalize(
        std::env::var_os("RUNNER_TEMP")
            .ok_or_else(|| Error::new(ErrorKind::NotFound, "runner temp missing"))?,
    )?;
    let run = std::env::var("GITHUB_RUN_ID").unwrap_or_default();
    let attempt = std::env::var("GITHUB_RUN_ATTEMPT").unwrap_or_default();
    if run.is_empty()
        || attempt.is_empty()
        || !run.bytes().all(|b| b.is_ascii_digit())
        || !attempt.bytes().all(|b| b.is_ascii_digit())
        || root.parent() != Some(temp.as_path())
        || root.file_name() != Some(std::ffi::OsStr::new(&format!("stride-i13-{run}-{attempt}")))
    {
        return Err(Error::new(
            ErrorKind::PermissionDenied,
            "invalid QA marker root",
        ));
    }
    let mut trace = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(root.join(format!(
            "qa-startup-{}-{}.log",
            std::process::id(),
            uuid::Uuid::new_v4()
        )))?;
    writeln!(trace, "process-started")?;
    Ok(trace)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(feature = "qa-isolated")]
    assert_eq!(
        context.config().identifier,
        "com.strideplan.qa.i13",
        "QA identity required"
    );
    #[cfg(feature = "qa-isolated")]
    assert!(
        context.config().app.windows.len() == 1 && !context.config().app.windows[0].create,
        "QA window must wait for isolation verification"
    );
    #[cfg(not(feature = "qa-isolated"))]
    assert_ne!(
        context.config().identifier,
        "com.strideplan.qa.i13",
        "QA identity requires the isolated feature"
    );
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    #[cfg(feature = "qa-isolated")]
    let builder = {
        let mut trace = qa_startup_trace().expect("QA startup trace could not be created safely");
        builder.setup(move |app| {
            use std::io::Write;
            use tauri::Manager;
            writeln!(trace, "setup-entered")?;
            let root = std::env::var_os("STRIDE_QA_ROOT").ok_or("QA root missing")?;
            let root = std::fs::canonicalize(root)?;
            if std::env::var("GITHUB_ACTIONS").as_deref() != Ok("true")
                || std::env::var("RUNNER_ENVIRONMENT").as_deref() != Ok("github-hosted")
            {
                return Err("QA requires a hosted runner".into());
            }
            let runner_temp = std::fs::canonicalize(
                std::env::var_os("RUNNER_TEMP").ok_or("runner temp missing")?,
            )?;
            if root.parent() != Some(runner_temp.as_path()) {
                return Err("QA marker outside runner temp".into());
            }
            let roaming = std::path::PathBuf::from(
                std::env::var_os("STRIDE_QA_CONFIG_BASE").ok_or("QA config base missing")?,
            );
            let local = std::path::PathBuf::from(
                std::env::var_os("STRIDE_QA_LOCAL_BASE").ok_or("QA local base missing")?,
            );
            let config = app.path().app_config_dir()?;
            let data = app.path().app_local_data_dir()?;
            if config != roaming.join("com.strideplan.qa.i13")
                || data != local.join("com.strideplan.qa.i13")
            {
                writeln!(trace, "isolation-rejected")?;
                return Err("Unexpected resolved QA storage paths".into());
            }
            writeln!(trace, "paths-verified")?;
            if app.config().app.windows.len() != 1 || app.config().app.windows[0].create {
                return Err("QA window must wait for isolation verification".into());
            }
            writeln!(trace, "window-create-requested")?;
            match tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .build()
            {
                Ok(_) => writeln!(trace, "window-created")?,
                Err(error) => {
                    writeln!(trace, "window-create-failed")?;
                    return Err(error.into());
                }
            }
            Ok(())
        })
    };
    #[cfg(not(feature = "qa-isolated"))]
    let builder = builder.manage(garmin_commands::GarminState::default());
    #[cfg(feature = "qa-isolated")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        fit_source_commands::store_fit_source,
        fit_source_commands::read_fit_source,
        plan_draft_commands::inspect_plan_draft,
        plan_draft_commands::save_plan_draft,
        plan_draft_commands::read_plan_draft,
        plan_draft_commands::export_plan_draft,
        plan_draft_commands::save_plan_draft_recovery,
        plan_draft_commands::recover_plan_draft,
        plan_draft_commands::replace_legacy_snapshot,
        plan_conversion_commands::save_plan_conversion_file,
    ]);
    #[cfg(not(feature = "qa-isolated"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        fit_source_commands::store_fit_source,
        fit_source_commands::read_fit_source,
        plan_draft_commands::inspect_plan_draft,
        plan_draft_commands::save_plan_draft,
        plan_draft_commands::read_plan_draft,
        plan_draft_commands::export_plan_draft,
        plan_draft_commands::save_plan_draft_recovery,
        plan_draft_commands::recover_plan_draft,
        plan_draft_commands::replace_legacy_snapshot,
        plan_conversion_commands::save_plan_conversion_file,
        garmin_commands::garmin_status,
        garmin_commands::garmin_connect,
        garmin_commands::garmin_verify,
        garmin_commands::garmin_disconnect,
        garmin_commands::garmin_list_activities,
        garmin_commands::garmin_retrieve_activity,
        garmin_commands::garmin_cancel,
        garmin_commands::garmin_open_key_page,
    ]);
    // Registered SQL migrations run inside Database.load, before the snapshot
    // can be validated or copied. Keep legacy tables untouched; the repository
    // initializes app_state only after establishing a genuinely empty store.
    builder
        .plugin(tauri_plugin_sql::Builder::default().build())
        .run(context)
        .expect("failed to run Stride Plan");
}
