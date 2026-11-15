//! Only writes a verified draft recovery envelope to a native-dialog selection.
//! No webview-supplied paths, arbitrary contents, or filesystem permission grants.
use crate::plan_draft_store::{error, hash, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub const DEFAULT_FILE_NAME: &str = "stride-plan-draft-recovery.json";
const LIMIT: usize = 16 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ExportOutcome {
    Cancelled { contract_version: u32 },
    Saved { contract_version: u32, path: String },
}

pub fn save_selected(
    selection: Option<PathBuf>,
    bytes: &[u8],
    source_hash: &str,
    protected_roots: &[PathBuf],
) -> Result<ExportOutcome> {
    let Some(path) = selection else {
        return Ok(ExportOutcome::Cancelled {
            contract_version: 1,
        });
    };
    if bytes.is_empty() || bytes.len() > LIMIT {
        return Err(error("invalid"));
    }
    let display = path
        .to_str()
        .ok_or_else(|| error("export_unsafe"))?
        .to_owned();
    write_selected(&path, bytes, source_hash, protected_roots)?;
    Ok(ExportOutcome::Saved {
        contract_version: 1,
        path: display,
    })
}

#[cfg(not(windows))]
fn write_selected(_: &Path, _: &[u8], _: &str, _: &[PathBuf]) -> Result<()> {
    Err(error("unsupported"))
}

#[cfg(windows)]
fn write_selected(
    path: &Path,
    bytes: &[u8],
    source_hash: &str,
    protected: &[PathBuf],
) -> Result<()> {
    windows::write(
        path,
        bytes,
        source_hash,
        protected,
        |file, bytes| {
            use std::io::Write;
            file.write_all(bytes)
        },
        || Ok(()),
    )
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::{
        fs::{self, File, OpenOptions},
        io::{self, Read, Seek, SeekFrom},
        os::windows::{
            ffi::OsStrExt,
            fs::{MetadataExt, OpenOptionsExt},
            io::AsRawHandle,
        },
        path::Component,
    };
    use windows_sys::Win32::Storage::FileSystem::*;

    #[derive(Debug, PartialEq, Eq)]
    struct Identity {
        volume: u32,
        index_high: u32,
        index_low: u32,
        length: u64,
        modified: u64,
    }

    fn redirects_name(file: &File, attributes: u32) -> Result<bool> {
        if attributes & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
            return Ok(false);
        }
        let mut tag: FILE_ATTRIBUTE_TAG_INFO = unsafe { std::mem::zeroed() };
        // SAFETY: live handle, matching info class and correctly sized output.
        if unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle(),
                FileAttributeTagInfo,
                (&mut tag as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),
                std::mem::size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
            )
        } == 0
        {
            return Err(error("export_unsafe"));
        }
        // Block name-surrogate links while allowing nonredirecting placeholders
        // in folders explicitly chosen for a manual export.
        Ok(tag.ReparseTag & 0x20000000 != 0)
    }
    fn identity(file: &File) -> Result<Identity> {
        let metadata = file.metadata().map_err(|_| error("export_write"))?;
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: a live file handle and correctly sized writable output.
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(error("export_write"));
        }
        if !metadata.is_file()
            || redirects_name(file, metadata.file_attributes())?
            || info.nNumberOfLinks != 1
        {
            return Err(error("export_unsafe"));
        }
        Ok(Identity {
            volume: info.dwVolumeSerialNumber,
            index_high: info.nFileIndexHigh,
            index_low: info.nFileIndexLow,
            length: metadata.len(),
            modified: metadata.last_write_time(),
        })
    }

    fn open_existing(path: &Path) -> Result<Option<File>> {
        match OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
            .open(path)
        {
            Ok(file) => {
                identity(&file)?;
                Ok(Some(file))
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(error("export_write")),
        }
    }

    // Resolve user-selected folders first, then pin their real ancestors. A
    // junction selected in Save As is allowed only when its resolved target is
    // outside app storage; later directory/link substitution is denied.
    fn destination(path: &Path, protected: &[PathBuf]) -> Result<(PathBuf, Vec<File>)> {
        if !path.is_absolute() {
            return Err(error("export_unsafe"));
        }
        let name = path.file_name().ok_or_else(|| error("export_unsafe"))?;
        let parent = path
            .parent()
            .ok_or_else(|| error("export_unsafe"))?
            .canonicalize()
            .map_err(|_| error("export_write"))?;
        let resolved = parent.join(name);
        let key = resolved.to_string_lossy().to_lowercase();
        for root in protected {
            let root = root.canonicalize().map_err(|_| error("export_unsafe"))?;
            let root_key = root.to_string_lossy().trim_end_matches('\\').to_lowercase();
            if key == root_key || key.starts_with(&(root_key + "\\")) {
                return Err(error("export_unsafe"));
            }
        }
        let mut current = PathBuf::new();
        let mut guards = Vec::new();
        for component in parent.components() {
            match component {
                Component::Prefix(prefix) => {
                    current.push(prefix.as_os_str());
                    continue;
                }
                Component::RootDir | Component::Normal(_) => current.push(component.as_os_str()),
                _ => return Err(error("export_unsafe")),
            }
            let file = OpenOptions::new()
                .access_mode(FILE_READ_ATTRIBUTES)
                .share_mode(FILE_SHARE_READ)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
                .open(&current)
                .map_err(|_| error("export_write"))?;
            let metadata = file.metadata().map_err(|_| error("export_write"))?;
            if !metadata.is_dir() || redirects_name(&file, metadata.file_attributes())? {
                return Err(error("export_unsafe"));
            }
            guards.push(file);
        }
        Ok((resolved, guards))
    }

    struct Staged(PathBuf);
    impl Staged {
        fn cleanup(&self) -> Result<()> {
            match fs::remove_file(&self.0) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(_) => Err(error("export_cleanup")),
            }
        }
    }
    impl Drop for Staged {
        fn drop(&mut self) {
            let _ = self.cleanup();
        }
    }

    pub(super) fn write(
        selected: &Path,
        bytes: &[u8],
        source_hash: &str,
        protected: &[PathBuf],
        writer: impl FnOnce(&mut File, &[u8]) -> io::Result<()>,
        before_publish: impl FnOnce() -> io::Result<()>,
    ) -> Result<()> {
        let (path, _guards) = destination(selected, protected)?;
        let mut existing = open_existing(&path)?;
        let expected = existing.as_ref().map(identity).transpose()?;
        if let Some(file) = existing.as_mut() {
            if file.metadata().map_err(|_| error("export_write"))?.len() <= 8 * 1024 * 1024 {
                let mut original = Vec::new();
                file.take(LIMIT as u64 + 1)
                    .read_to_end(&mut original)
                    .map_err(|_| error("export_write"))?;
                if hash(&original) == source_hash {
                    return Err(error("export_unsafe"));
                }
            }
        }
        let temp = path
            .parent()
            .ok_or_else(|| error("export_unsafe"))?
            .join(format!(
                ".stride-plan-recovery-{}.tmp",
                uuid::Uuid::new_v4()
            ));
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(&temp)
            .map_err(|_| error("export_write"))?;
        // We own cleanup only after create_new has succeeded.
        let staged = Staged(temp);
        let result = (|| {
            writer(&mut file, bytes).map_err(|_| error("export_write"))?;
            file.sync_all().map_err(|_| error("export_write"))?;
            file.seek(SeekFrom::Start(0))
                .map_err(|_| error("export_write"))?;
            let mut reread = Vec::new();
            Read::by_ref(&mut file)
                .take(LIMIT as u64 + 1)
                .read_to_end(&mut reread)
                .map_err(|_| error("export_write"))?;
            if reread != bytes {
                return Err(error("export_verify"));
            }
            identity(&file)?;
            drop(file);
            before_publish().map_err(|_| error("export_write"))?;
            // Existing files are pinned against writes/deletion during staging.
            // Recheck their identity before the atomic, user-confirmed replace.
            if existing.as_ref().map(identity).transpose()? != expected {
                return Err(error("export_conflict"));
            }
            drop(existing);
            if open_existing(&path)?.as_ref().map(identity).transpose()? != expected {
                return Err(error("export_conflict"));
            }
            let from: Vec<u16> = staged.0.as_os_str().encode_wide().chain(Some(0)).collect();
            let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            let flags = MOVEFILE_WRITE_THROUGH
                | if expected.is_some() {
                    MOVEFILE_REPLACE_EXISTING
                } else {
                    0
                };
            // SAFETY: live NUL-terminated native paths on the same destination
            // volume. New files never replace a concurrently created target.
            if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), flags) } == 0 {
                return Err(error("export_write"));
            }
            let mut final_file = open_existing(&path)?.ok_or_else(|| error("export_verify"))?;
            let mut final_bytes = Vec::new();
            Read::by_ref(&mut final_file)
                .take(LIMIT as u64 + 1)
                .read_to_end(&mut final_bytes)
                .map_err(|_| error("export_verify"))?;
            if final_bytes != bytes {
                return Err(error("export_verify"));
            }
            Ok(())
        })();
        staged.cleanup()?;
        result
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::io::Write;
        struct Fixture(PathBuf);
        impl Fixture {
            fn new() -> Self {
                let path = std::env::temp_dir()
                    .join(format!("stride-t05-export-{}", uuid::Uuid::new_v4()));
                fs::create_dir(&path).unwrap();
                Self(path)
            }
            fn path(&self) -> PathBuf {
                self.0.join(DEFAULT_FILE_NAME)
            }
            fn write(&self, bytes: &[u8]) -> Result<()> {
                write_selected(
                    &self.path(),
                    bytes,
                    &hash(b"synthetic original source"),
                    &[],
                )
            }
            fn no_temps(&self) {
                assert!(fs::read_dir(&self.0).unwrap().all(|entry| !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")));
            }
        }
        impl Drop for Fixture {
            fn drop(&mut self) {
                assert!(
                    self.0.starts_with(std::env::temp_dir())
                        && self
                            .0
                            .file_name()
                            .unwrap()
                            .to_string_lossy()
                            .starts_with("stride-t05-export-")
                );
                fs::remove_dir_all(&self.0).unwrap();
            }
        }
        #[test]
        fn cancellation_creates_nothing_and_saved_result_follows_exact_file_verification() {
            let f = Fixture::new();
            assert!(matches!(
                save_selected(None, b"synthetic", "", &[]).unwrap(),
                ExportOutcome::Cancelled { .. }
            ));
            assert_eq!(fs::read_dir(&f.0).unwrap().count(), 0);
            let bytes = b"{\"synthetic\":\"exact source bytes remain opaque: \\r\\n\"}\r\n";
            assert!(matches!(
                save_selected(Some(f.path()), bytes, "", &[]).unwrap(),
                ExportOutcome::Saved { .. }
            ));
            assert_eq!(fs::read(f.path()).unwrap(), bytes);
            f.no_temps();
            f.write(b"synthetic confirmed replacement").unwrap();
            assert_eq!(
                fs::read(f.path()).unwrap(),
                b"synthetic confirmed replacement"
            );
            f.no_temps();
        }
        #[test]
        fn partial_permission_disk_full_sync_and_publish_failures_never_report_saved() {
            for fault in ["permission", "full", "partial", "sync", "publish"] {
                let f = Fixture::new();
                fs::write(f.path(), b"previous synthetic export").unwrap();
                let result = write(
                    &f.path(),
                    b"new synthetic export",
                    "",
                    &[],
                    |file, bytes| {
                        if fault == "permission" {
                            return Err(io::Error::from(io::ErrorKind::PermissionDenied));
                        }
                        if fault == "full" {
                            file.write_all(&bytes[..3])?;
                            return Err(io::Error::from_raw_os_error(112));
                        }
                        if fault == "partial" {
                            return file.write_all(&bytes[..3]);
                        }
                        file.write_all(bytes)?;
                        if fault == "sync" {
                            *file = File::open(f.path())?;
                        }
                        Ok(())
                    },
                    || {
                        if fault == "publish" {
                            Err(io::Error::from_raw_os_error(112))
                        } else {
                            Ok(())
                        }
                    },
                );
                assert!(result.is_err(), "{fault}");
                assert_eq!(fs::read(f.path()).unwrap(), b"previous synthetic export");
                f.no_temps();
            }
        }
        #[test]
        fn new_destination_race_and_readonly_overwrite_preserve_other_contents() {
            let f = Fixture::new();
            assert!(write(
                &f.path(),
                b"export",
                "",
                &[],
                |file, bytes| file.write_all(bytes),
                || fs::write(f.path(), b"concurrent synthetic file")
            )
            .is_err());
            assert_eq!(fs::read(f.path()).unwrap(), b"concurrent synthetic file");
            f.no_temps();
            let mut permissions = fs::metadata(f.path()).unwrap().permissions();
            permissions.set_readonly(true);
            fs::set_permissions(f.path(), permissions).unwrap();
            assert!(f.write(b"replacement").is_err());
            assert_eq!(fs::read(f.path()).unwrap(), b"concurrent synthetic file");
            let mut permissions = fs::metadata(f.path()).unwrap().permissions();
            permissions.set_readonly(false);
            fs::set_permissions(f.path(), permissions).unwrap();
            f.no_temps();
        }
        #[test]
        fn app_storage_original_source_and_links_are_not_overwritten() {
            let f = Fixture::new();
            fs::write(f.path(), b"synthetic original source").unwrap();
            assert!(f.write(b"export").is_err());
            assert!(write_selected(&f.path(), b"export", "", &[f.0.clone()]).is_err());
            fs::hard_link(f.path(), f.0.join("synthetic-link.json")).unwrap();
            assert!(f.write(b"export").is_err());
            assert_eq!(fs::read(f.path()).unwrap(), b"synthetic original source");
            f.no_temps();
        }
        #[test]
        fn final_verification_failure_never_becomes_saved() {
            let f = Fixture::new();
            let result = write(
                &f.path(),
                b"verified expected recovery",
                "",
                &[],
                |file, bytes| file.write_all(bytes),
                || {
                    let staged = fs::read_dir(&f.0)?.next().unwrap()?.path();
                    fs::write(staged, b"synthetic interference after staging verification")
                },
            );
            assert_eq!(result.unwrap_err().code, "export_verify");
            f.no_temps();
        }
    }
}

#[cfg(test)]
mod contract_tests {
    use super::*;
    use crate::plan_draft_commands::ExportSaveRequest;
    #[test]
    fn export_command_contract_cannot_accept_paths_or_file_contents() {
        let request =
            serde_json::json!({"contractVersion":1,"expectedRecoveryHash":"a".repeat(64)});
        let parsed: ExportSaveRequest = serde_json::from_value(request.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), request);
        for key in ["path", "bytes", "contents", "destination"] {
            let mut invalid = request.clone();
            invalid[key] = "not permitted".into();
            assert!(serde_json::from_value::<ExportSaveRequest>(invalid).is_err());
        }
        assert_eq!(DEFAULT_FILE_NAME, "stride-plan-draft-recovery.json");
        assert_eq!(
            serde_json::to_value(save_selected(None, b"", "", &[]).unwrap()).unwrap(),
            serde_json::json!({"contractVersion":1,"status":"cancelled"})
        );
    }
}
