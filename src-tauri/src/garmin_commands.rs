use crate::{
    garmin::{self, Code, Error, Result, Service},
    garmin_credentials::WindowsCredentials,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::Manager;
use tokio::sync::{Mutex, MutexGuard};
use zeroize::Zeroizing;

type NativeService = Service<WindowsCredentials, garmin::GarminHttp>;
pub struct GarminState {
    service: Mutex<NativeService>,
    cancel: Arc<AtomicBool>,
}
impl Default for GarminState {
    fn default() -> Self {
        Self {
            service: Mutex::new(Service::new(WindowsCredentials, garmin::GarminHttp)),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }
}
impl GarminState {
    fn begin(&self) -> Result<MutexGuard<'_, NativeService>> {
        let service = self
            .service
            .try_lock()
            .map_err(|_| Error::new(Code::Busy))?;
        self.cancel.store(false, Ordering::SeqCst);
        Ok(service)
    }
}
#[tauri::command]
pub async fn garmin_status(state: tauri::State<'_, GarminState>) -> Result<garmin::Status> {
    state
        .service
        .try_lock()
        .map_err(|_| Error::new(Code::Busy))?
        .status()
}
#[tauri::command]
pub async fn garmin_connect(
    state: tauri::State<'_, GarminState>,
    api_key: String,
) -> Result<garmin::Status> {
    let key = Zeroizing::new(api_key);
    state
        .begin()?
        .connect(key, garmin::now(), &state.cancel)
        .await
}
#[tauri::command]
pub async fn garmin_verify(state: tauri::State<'_, GarminState>) -> Result<garmin::Status> {
    state.begin()?.verify(garmin::now(), &state.cancel).await
}
#[tauri::command]
pub async fn garmin_disconnect(state: tauri::State<'_, GarminState>) -> Result<garmin::Status> {
    state.begin()?.disconnect()
}
#[tauri::command]
pub async fn garmin_list_activities(
    state: tauri::State<'_, GarminState>,
) -> Result<Vec<garmin::Activity>> {
    state.begin()?.list(garmin::now(), &state.cancel).await
}
#[tauri::command]
pub async fn garmin_retrieve_activity(
    app: tauri::AppHandle,
    state: tauri::State<'_, GarminState>,
    activity_id: String,
) -> Result<garmin::Retrieval> {
    let mut service = state.begin()?;
    let bytes = service
        .download(&activity_id, garmin::now(), &state.cancel)
        .await?;
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| Error::new(Code::Storage))?;
    let cancel = Arc::clone(&state.cancel);
    let result = tauri::async_runtime::spawn_blocking(move || {
        garmin::preserve(root, activity_id, bytes, cancel)
    })
    .await
    .map_err(|_| Error::new(Code::Storage))?;
    // Hold serialization through publication so disconnect/key replacement
    // cannot race a still-publishing retrieval.
    drop(service);
    result
}
#[tauri::command]
pub fn garmin_cancel(state: tauri::State<'_, GarminState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

// Fixed destination only: no arbitrary URL/path/command opener is exposed.
#[tauri::command]
pub fn garmin_open_key_page() -> Result<()> {
    #[cfg(windows)]
    {
        let verb: Vec<u16> = "open\0".encode_utf16().collect();
        let url: Vec<u16> = "https://connect.garmin.com/app/settings/personalApiToken\0"
            .encode_utf16()
            .collect();
        // SAFETY: constant NUL-terminated buffers, no parameters or working dir.
        let result = unsafe {
            windows_sys::Win32::UI::Shell::ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if result as isize <= 32 {
            return Err(Error::new(Code::Browser));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err(Error::new(Code::Unsupported))
    }
}
