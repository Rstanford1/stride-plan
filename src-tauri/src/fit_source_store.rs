//! Immutable FIT byte objects. Only the command adapter selects the trusted root.
//! No snapshot/database writes, source deletion, or automatic legacy migration.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

pub const CONTRACT_VERSION: u32 = 1;
pub const MAX_SOURCE_BYTES: usize = 32 * 1024 * 1024;

// Decode only transport identity. Unknown metadata and coach strings remain
// opaque bytes; a full serde Value would impose a second interpretation of
// optional JSON strings that T01 already accepts (including escaped surrogates).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanSourceHeader {
    pub schema_version: String,
    pub manifest: PlanSourceIdentity,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanSourceIdentity {
    pub plan_id: String,
    pub version_id: String,
    pub parent_version_id: Option<String>,
}
pub(crate) fn plan_source_header(bytes: &[u8]) -> Result<PlanSourceHeader> {
    let text = std::str::from_utf8(bytes).map_err(|_| SourceError::new(ErrorCode::Corrupt))?;
    let header: PlanSourceHeader = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| SourceError::new(ErrorCode::Corrupt))?;
    if header.schema_version != "1.1" {
        return Err(SourceError::new(ErrorCode::UnsupportedVersion));
    }
    Ok(header)
}

#[derive(Clone, Copy)]
enum SourceKind {
    Fit,
    Plan,
}
impl SourceKind {
    fn folder(self) -> &'static str {
        match self {
            Self::Fit => "fit-sources",
            Self::Plan => "plan-sources",
        }
    }
    fn extension(self) -> &'static str {
        match self {
            Self::Fit => "fit",
            Self::Plan => "json",
        }
    }
    fn limit(self) -> usize {
        match self {
            Self::Fit => MAX_SOURCE_BYTES,
            Self::Plan => 8 * 1024 * 1024,
        }
    }
    fn validate(self, id: &str, bytes: &[u8]) -> Result<()> {
        if matches!(self, Self::Fit) {
            return validate_bytes(id, bytes);
        }
        if bytes.is_empty() || bytes.len() > self.limit() {
            return Err(SourceError::new(ErrorCode::TooLarge));
        }
        plan_source_header(bytes)?;
        if hash(bytes) != id {
            return Err(SourceError::new(ErrorCode::HashMismatch));
        }
        Ok(())
    }
    fn metadata(self, id: &str, len: usize) -> SourceMetadata {
        let mut result = SourceMetadata::new(id, len);
        if matches!(self, Self::Plan) {
            result.source_id = format!("plan-source:{id}");
            result.stored_relative_path =
                format!("{}/{}/{id}.{}", self.folder(), &id[..2], self.extension());
        }
        result
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    UnsupportedVersion,
    InvalidSourceId,
    InvalidFit,
    TooLarge,
    HashMismatch,
    Conflict,
    Missing,
    Corrupt,
    UnsafePath,
    StorageUnavailable,
    WriteFailed,
    CleanupFailed,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceError {
    pub contract_version: u32,
    pub code: ErrorCode,
    pub message: String,
}

impl SourceError {
    pub fn new(code: ErrorCode) -> Self {
        let message = match code {
            ErrorCode::UnsupportedVersion => "Unsupported FIT storage contract version.",
            ErrorCode::InvalidSourceId => "FIT source ID must be a lowercase SHA-256 value.",
            ErrorCode::InvalidFit => "FIT source must contain an original FIT header.",
            ErrorCode::TooLarge => "FIT source exceeds the 32 MiB storage limit.",
            ErrorCode::HashMismatch => "FIT source bytes do not match their source hash.",
            ErrorCode::Conflict => {
                "Stored FIT source conflicts with the supplied bytes; nothing was overwritten."
            }
            ErrorCode::Missing => "Saved FIT source is missing.",
            ErrorCode::Corrupt => "Saved FIT source failed its integrity check.",
            ErrorCode::UnsafePath => "FIT storage contains an unsafe path or linked object.",
            ErrorCode::StorageUnavailable => "FIT source storage is inaccessible.",
            ErrorCode::WriteFailed => "FIT source could not be saved and verified. Retry is safe.",
            ErrorCode::CleanupFailed => {
                "FIT staging cleanup failed. Retry is safe; final sources were retained."
            }
        };
        Self {
            contract_version: CONTRACT_VERSION,
            code,
            message: message.into(),
        }
    }
}

pub type Result<T> = std::result::Result<T, SourceError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceMetadata {
    pub contract_version: u32,
    pub source_id: String,
    pub source_hash: String,
    pub byte_length: usize,
    pub stored_relative_path: String,
}

impl SourceMetadata {
    pub(crate) fn new(source_hash: &str, byte_length: usize) -> Self {
        Self {
            contract_version: CONTRACT_VERSION,
            // Retain the snapshot's source identity and relative path exactly.
            source_id: format!("fit-source:{source_hash}"),
            source_hash: source_hash.into(),
            byte_length,
            stored_relative_path: format!("fit-sources/{}/{source_hash}.fit", &source_hash[..2]),
        }
    }
}

pub fn validate_request(contract_version: u32, source_hash: &str) -> Result<()> {
    if contract_version != CONTRACT_VERSION {
        return Err(SourceError::new(ErrorCode::UnsupportedVersion));
    }
    if source_hash.len() != 64
        || !source_hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(SourceError::new(ErrorCode::InvalidSourceId));
    }
    Ok(())
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn validate_bytes(source_hash: &str, bytes: &[u8]) -> Result<()> {
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err(SourceError::new(ErrorCode::TooLarge));
    }
    // Decoding/CRC validation remains with FitDecoder. Never normalize source bytes.
    if bytes.len() < 12 || &bytes[8..12] != b".FIT" {
        return Err(SourceError::new(ErrorCode::InvalidFit));
    }
    if hash(bytes) != source_hash {
        return Err(SourceError::new(ErrorCode::HashMismatch));
    }
    Ok(())
}

pub struct FitSourceStorage {
    app_local_data: PathBuf,
    kind: SourceKind,
}

impl FitSourceStorage {
    // Internal API only: callers in Rust/tests supply a root, never the webview.
    pub fn new(app_local_data: PathBuf) -> Self {
        Self {
            app_local_data,
            kind: SourceKind::Fit,
        }
    }

    pub(crate) fn plan(app_local_data: PathBuf) -> Self {
        Self {
            app_local_data,
            kind: SourceKind::Plan,
        }
    }

    pub fn store(&self, source_hash: &str, bytes: &[u8]) -> Result<SourceMetadata> {
        validate_request(CONTRACT_VERSION, source_hash)?;
        self.kind.validate(source_hash, bytes)?;
        self.store_inner(source_hash, bytes)
    }

    pub fn read(&self, source_hash: &str) -> Result<Vec<u8>> {
        validate_request(CONTRACT_VERSION, source_hash)?;
        self.read_inner(source_hash)
    }

    // Internal T04-only provenance receipt. Caller cannot choose a filesystem
    // path or arbitrary contents. Provider identity remains separate from hash.
    pub fn store_garmin_receipt(&self, activity_id: &str, source_hash: &str) -> Result<()> {
        validate_request(CONTRACT_VERSION, source_hash)?;
        if !crate::garmin::valid_id(activity_id) {
            return Err(SourceError::new(ErrorCode::InvalidSourceId));
        }
        self.receipt_inner(activity_id, source_hash)
    }
}

#[cfg(not(windows))]
impl FitSourceStorage {
    fn receipt_inner(&self, _: &str, _: &str) -> Result<()> {
        Err(SourceError::new(ErrorCode::StorageUnavailable))
    }
    fn store_inner(&self, _: &str, _: &[u8]) -> Result<SourceMetadata> {
        Err(SourceError::new(ErrorCode::StorageUnavailable))
    }
    fn read_inner(&self, _: &str) -> Result<Vec<u8>> {
        Err(SourceError::new(ErrorCode::StorageUnavailable))
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::{
        fs::{self, File, OpenOptions},
        io::{self, Read, Seek, SeekFrom, Write},
        os::windows::{
            ffi::OsStrExt,
            fs::{MetadataExt, OpenOptionsExt},
            io::AsRawHandle,
        },
        path::{Component, Path},
    };
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, MoveFileExW, BY_HANDLE_FILE_INFORMATION,
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_READ_ATTRIBUTES, FILE_SHARE_READ, MOVEFILE_WRITE_THROUGH,
    };

    fn io_error(error: io::Error, writing: bool) -> SourceError {
        SourceError::new(match error.kind() {
            io::ErrorKind::NotFound if !writing => ErrorCode::Missing,
            io::ErrorKind::PermissionDenied => ErrorCode::StorageUnavailable,
            _ if writing => ErrorCode::WriteFailed,
            _ => ErrorCode::StorageUnavailable,
        })
    }

    // Hold every ancestor open without FILE_SHARE_DELETE. A directory/junction
    // cannot be swapped between checking it and using a child path on Windows.
    struct Directory {
        path: PathBuf,
        _guards: Vec<File>,
        kind: SourceKind,
    }

    impl Directory {
        fn open(app_data: &Path, source_hash: &str, create: bool) -> Result<Self> {
            Self::open_kind(app_data, source_hash, create, SourceKind::Fit)
        }
        fn open_kind(
            app_data: &Path,
            source_hash: &str,
            create: bool,
            kind: SourceKind,
        ) -> Result<Self> {
            if !app_data.is_absolute() {
                return Err(SourceError::new(ErrorCode::UnsafePath));
            }
            let path = app_data.join(kind.folder()).join(&source_hash[..2]);
            let mut current = PathBuf::new();
            let mut guards = Vec::new();
            for component in path.components() {
                match component {
                    Component::Prefix(prefix) => {
                        current.push(prefix.as_os_str());
                        continue;
                    }
                    Component::RootDir | Component::Normal(_) => {
                        current.push(component.as_os_str())
                    }
                    _ => return Err(SourceError::new(ErrorCode::UnsafePath)),
                }
                let open = || {
                    OpenOptions::new()
                        .access_mode(FILE_READ_ATTRIBUTES)
                        .share_mode(FILE_SHARE_READ)
                        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
                        .open(&current)
                };
                let file = match open() {
                    Ok(file) => file,
                    Err(error) if create && error.kind() == io::ErrorKind::NotFound => {
                        match fs::create_dir(&current) {
                            Ok(()) => (),
                            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => (),
                            Err(error) => return Err(io_error(error, true)),
                        }
                        open().map_err(|e| io_error(e, true))?
                    }
                    Err(error) => return Err(io_error(error, create)),
                };
                let metadata = file.metadata().map_err(|e| io_error(e, create))?;
                if !metadata.is_dir()
                    || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
                {
                    return Err(SourceError::new(ErrorCode::UnsafePath));
                }
                guards.push(file);
            }
            Ok(Self {
                path,
                _guards: guards,
                kind,
            })
        }

        fn read(&self, source_hash: &str) -> Result<Vec<u8>> {
            let mut file = OpenOptions::new()
                .read(true)
                .share_mode(FILE_SHARE_READ)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
                .open(
                    self.path
                        .join(format!("{source_hash}.{}", self.kind.extension())),
                )
                .map_err(|e| io_error(e, false))?;
            let metadata = file.metadata().map_err(|e| io_error(e, false))?;
            if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
            {
                return Err(SourceError::new(ErrorCode::UnsafePath));
            }
            let mut information: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
            // SAFETY: live file handle and correctly sized writable output.
            if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut information) } == 0 {
                return Err(io_error(io::Error::last_os_error(), false));
            }
            if information.nNumberOfLinks != 1 {
                return Err(SourceError::new(ErrorCode::UnsafePath));
            }
            if metadata.len() > self.kind.limit() as u64 {
                return Err(SourceError::new(ErrorCode::Corrupt));
            }
            let mut bytes = Vec::with_capacity(metadata.len() as usize);
            Read::by_ref(&mut file)
                .take(self.kind.limit() as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| io_error(e, false))?;
            if bytes.len() as u64 != metadata.len()
                || self.kind.validate(source_hash, &bytes).is_err()
            {
                return Err(SourceError::new(ErrorCode::Corrupt));
            }
            Ok(bytes)
        }
    }

    // Only temporary objects from this operation are eligible for cleanup.
    struct StagedFile(PathBuf);
    impl StagedFile {
        fn cleanup(&self) -> Result<()> {
            match fs::remove_file(&self.0) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(_) => Err(SourceError::new(ErrorCode::CleanupFailed)),
            }
        }
    }

    fn publish(staged: &Path, final_path: &Path) -> io::Result<()> {
        let from: Vec<u16> = staged.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = final_path
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        // SAFETY: NUL-terminated buffers live for this synchronous call. Never set
        // REPLACE_EXISTING or COPY_ALLOWED: same-volume, no-clobber publication.
        if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    impl FitSourceStorage {
        pub(super) fn receipt_inner(&self, activity_id: &str, source_hash: &str) -> Result<()> {
            let directory = Directory::open(&self.app_local_data, source_hash, false)?;
            // Verify source before creating provenance; never manufacture a
            // receipt for an absent or corrupt source object.
            directory.read(source_hash)?;
            let name = format!("{source_hash}.garmin-{activity_id}.json");
            let destination = directory.path.join(name);
            let expected = format!("{{\"version\":1,\"provider\":\"garmin\",\"activityId\":\"{activity_id}\",\"sourceHash\":\"{source_hash}\"}}\n").into_bytes();
            let verify = || -> Result<()> {
                let mut file = OpenOptions::new()
                    .read(true)
                    .share_mode(FILE_SHARE_READ)
                    .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                    .open(&destination)
                    .map_err(|e| io_error(e, false))?;
                let metadata = file.metadata().map_err(|e| io_error(e, false))?;
                let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
                // SAFETY: live handle, valid writable output structure.
                if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
                    return Err(SourceError::new(ErrorCode::StorageUnavailable));
                }
                if !metadata.is_file()
                    || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
                    || info.nNumberOfLinks != 1
                {
                    return Err(SourceError::new(ErrorCode::UnsafePath));
                }
                let mut bytes = Vec::new();
                Read::by_ref(&mut file)
                    .take(1024)
                    .read_to_end(&mut bytes)
                    .map_err(|e| io_error(e, false))?;
                if bytes != expected {
                    return Err(SourceError::new(ErrorCode::Conflict));
                }
                Ok(())
            };
            match verify() {
                Ok(()) => return Ok(()),
                Err(e) if e.code == ErrorCode::Missing => (),
                Err(e) => return Err(e),
            }
            let staged = StagedFile(directory.path.join(format!("{}.tmp", uuid::Uuid::new_v4())));
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .share_mode(FILE_SHARE_READ)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(&staged.0)
                .map_err(|e| io_error(e, true))?;
            let result = file
                .write_all(&expected)
                .and_then(|()| file.sync_all())
                .map_err(|e| io_error(e, true));
            drop(file);
            let result = result.and_then(|()| {
                if let Err(e) = publish(&staged.0, &destination) {
                    if e.kind() != io::ErrorKind::AlreadyExists {
                        return Err(io_error(e, true));
                    }
                }
                verify()
            });
            staged.cleanup()?;
            result
        }

        pub(super) fn read_inner(&self, source_hash: &str) -> Result<Vec<u8>> {
            Directory::open_kind(&self.app_local_data, source_hash, false, self.kind)?
                .read(source_hash)
        }

        pub(super) fn store_inner(
            &self,
            source_hash: &str,
            bytes: &[u8],
        ) -> Result<SourceMetadata> {
            self.store_with_writer(source_hash, bytes, |file, bytes| file.write_all(bytes))
        }

        fn store_with_writer(
            &self,
            source_hash: &str,
            bytes: &[u8],
            writer: impl FnOnce(&mut File, &[u8]) -> io::Result<()>,
        ) -> Result<SourceMetadata> {
            let directory =
                Directory::open_kind(&self.app_local_data, source_hash, true, self.kind)?;
            match directory.read(source_hash) {
                Ok(existing) if existing == bytes => {
                    return Ok(self.kind.metadata(source_hash, bytes.len()))
                }
                Ok(_) => return Err(SourceError::new(ErrorCode::Conflict)),
                Err(e) if e.code == ErrorCode::Corrupt => {
                    return Err(SourceError::new(ErrorCode::Conflict))
                }
                Err(e) if e.code == ErrorCode::Missing => (),
                Err(e) => return Err(e),
            }
            let staged = StagedFile(directory.path.join(format!("{}.tmp", uuid::Uuid::new_v4())));
            let mut file = OpenOptions::new()
                .read(true)
                .write(true)
                .create_new(true)
                .share_mode(FILE_SHARE_READ)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(&staged.0)
                .map_err(|e| io_error(e, true))?;
            let written = (|| {
                writer(&mut file, bytes).map_err(|e| io_error(e, true))?;
                file.sync_all().map_err(|e| io_error(e, true))?;
                file.seek(SeekFrom::Start(0))
                    .map_err(|e| io_error(e, true))?;
                let mut saved = Vec::new();
                Read::by_ref(&mut file)
                    .take(self.kind.limit() as u64 + 1)
                    .read_to_end(&mut saved)
                    .map_err(|e| io_error(e, true))?;
                if saved != bytes || self.kind.validate(source_hash, &saved).is_err() {
                    return Err(SourceError::new(ErrorCode::WriteFailed));
                }
                Ok(())
            })();
            drop(file);
            let result = written.and_then(|()| {
                let final_path = directory
                    .path
                    .join(format!("{source_hash}.{}", self.kind.extension()));
                if let Err(error) = publish(&staged.0, &final_path) {
                    // A competing successful writer may have published first.
                    if error.kind() != io::ErrorKind::AlreadyExists {
                        return Err(io_error(error, true));
                    }
                }
                match directory.read(source_hash) {
                    Ok(saved) if saved == bytes => Ok(self.kind.metadata(source_hash, bytes.len())),
                    Ok(_) => Err(SourceError::new(ErrorCode::Conflict)),
                    Err(e) if e.code == ErrorCode::Corrupt => {
                        Err(SourceError::new(ErrorCode::Conflict))
                    }
                    Err(e) => Err(e),
                }
            });
            // If cleanup fails, return a safe explicit error even when an object
            // was published. A retry re-verifies that object; it never overwrites.
            staged.cleanup()?;
            result
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        struct Profile(PathBuf);
        impl Profile {
            fn new() -> Self {
                let path =
                    std::env::temp_dir().join(format!("stride-fit-test-{}", uuid::Uuid::new_v4()));
                fs::create_dir(&path).unwrap();
                Self(path)
            }
            fn store(&self) -> FitSourceStorage {
                FitSourceStorage::new(self.0.clone())
            }
            fn final_path(&self, id: &str) -> PathBuf {
                self.0.join(SourceMetadata::new(id, 0).stored_relative_path)
            }
        }
        impl Drop for Profile {
            fn drop(&mut self) {
                fs::remove_dir_all(&self.0).unwrap();
            }
        }
        fn fit() -> Vec<u8> {
            b"\x0c\x20\x00\x00\x00\x00\x00\x00.FITsynthetic\x00\xff".to_vec()
        }

        #[test]
        fn exact_bytes_duplicate_and_restart_preserve_legacy_reference() {
            let profile = Profile::new();
            let bytes = fit();
            let id = hash(&bytes);
            let result = profile.store().store(&id, &bytes).unwrap();
            let original = fs::metadata(profile.final_path(&id))
                .unwrap()
                .modified()
                .unwrap();
            assert_eq!(result.source_id, format!("fit-source:{id}"));
            assert_eq!(
                result.stored_relative_path,
                format!("fit-sources/{}/{id}.fit", &id[..2])
            );
            assert_eq!(profile.store().read(&id).unwrap(), bytes);
            assert_eq!(profile.store().store(&id, &bytes).unwrap(), result);
            assert_eq!(
                fs::metadata(profile.final_path(&id))
                    .unwrap()
                    .modified()
                    .unwrap(),
                original
            );
            assert_eq!(
                fs::read_dir(profile.final_path(&id).parent().unwrap())
                    .unwrap()
                    .count(),
                1
            );
        }
        #[test]
        fn corrupt_conflict_is_never_overwritten_and_missing_does_not_create_directories() {
            let profile = Profile::new();
            let bytes = fit();
            let id = hash(&bytes);
            assert_eq!(
                profile.store().read(&id).unwrap_err().code,
                ErrorCode::Missing
            );
            assert!(!profile.0.join("fit-sources").exists());
            profile.store().store(&id, &bytes).unwrap();
            fs::write(profile.final_path(&id), b"unexpected bytes").unwrap();
            assert_eq!(
                profile.store().read(&id).unwrap_err().code,
                ErrorCode::Corrupt
            );
            assert_eq!(
                profile.store().store(&id, &bytes).unwrap_err().code,
                ErrorCode::Conflict
            );
            assert_eq!(
                fs::read(profile.final_path(&id)).unwrap(),
                b"unexpected bytes"
            );
            fs::remove_file(profile.final_path(&id)).unwrap();
            assert_eq!(
                profile.store().read(&id).unwrap_err().code,
                ErrorCode::Missing
            );
        }
        #[test]
        fn short_failed_and_interrupted_writes_never_become_verified_sources() {
            let profile = Profile::new();
            let bytes = fit();
            let id = hash(&bytes);
            let failed = profile.store().store_with_writer(&id, &bytes, |file, _| {
                file.write_all(b"partial")?;
                Err(io::ErrorKind::StorageFull.into())
            });
            assert_eq!(failed.unwrap_err().code, ErrorCode::WriteFailed);
            let short = profile
                .store()
                .store_with_writer(&id, &bytes, |file, _| file.write_all(b"short"));
            assert_eq!(short.unwrap_err().code, ErrorCode::WriteFailed);
            assert!(!profile.final_path(&id).exists());
            let directory = profile.final_path(&id).parent().unwrap().to_path_buf();
            assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
            // Simulate a terminated process before publication. Ignore and retain
            // its staging file; never treat it as a source or delete another job.
            fs::write(directory.join("interrupted.tmp"), b"partial").unwrap();
            assert_eq!(
                profile.store().read(&id).unwrap_err().code,
                ErrorCode::Missing
            );
            profile.store().store(&id, &bytes).unwrap();
            assert_eq!(profile.store().read(&id).unwrap(), bytes);
            assert!(directory.join("interrupted.tmp").exists());
        }
        #[test]
        fn duplicate_race_cannot_clobber_a_competing_final_object() {
            let profile = Profile::new();
            let bytes = fit();
            let id = hash(&bytes);
            let final_path = profile.final_path(&id);
            let result = profile
                .store()
                .store_with_writer(&id, &bytes, |file, bytes| {
                    fs::write(&final_path, b"competing content")?;
                    file.write_all(bytes)
                });
            assert_eq!(result.unwrap_err().code, ErrorCode::Conflict);
            assert_eq!(fs::read(&final_path).unwrap(), b"competing content");
            fs::remove_file(&final_path).unwrap();
            let result = profile
                .store()
                .store_with_writer(&id, &bytes, |file, bytes| {
                    fs::write(&final_path, bytes)?;
                    file.write_all(bytes)
                });
            assert!(result.is_ok());
        }
        #[test]
        fn inaccessible_file_and_non_directory_storage_return_safe_errors() {
            let profile = Profile::new();
            let bytes = fit();
            let id = hash(&bytes);
            fs::write(profile.0.join("fit-sources"), b"blocked").unwrap();
            assert!(profile.store().store(&id, &bytes).is_err());
            fs::remove_file(profile.0.join("fit-sources")).unwrap();
            profile.store().store(&id, &bytes).unwrap();
            let _lock = OpenOptions::new()
                .read(true)
                .share_mode(0)
                .open(profile.final_path(&id))
                .unwrap();
            let error = profile.store().read(&id).unwrap_err();
            assert_eq!(error.code, ErrorCode::StorageUnavailable);
            assert!(!error
                .message
                .contains(&profile.0.to_string_lossy().to_string()));
        }
        #[test]
        fn hard_links_cannot_read_or_mutate_an_outside_object() {
            let profile = Profile::new();
            let outside = Profile::new();
            let bytes = fit();
            let id = hash(&bytes);
            Directory::open(&profile.0, &id, true).unwrap();
            let external = outside.0.join("original.fit");
            fs::write(&external, &bytes).unwrap();
            fs::hard_link(&external, profile.final_path(&id)).unwrap();
            assert_eq!(
                profile.store().read(&id).unwrap_err().code,
                ErrorCode::UnsafePath
            );
            assert_eq!(
                profile.store().store(&id, &bytes).unwrap_err().code,
                ErrorCode::UnsafePath
            );
            assert_eq!(fs::read(&external).unwrap(), bytes);
        }
        #[test]
        fn directory_junction_escape_is_rejected_without_touching_target() {
            // Junctions do not require Windows symlink/developer privileges.
            let profile = Profile::new();
            let outside = Profile::new();
            let bytes = fit();
            let id = hash(&bytes);
            let junction = profile.0.join("fit-sources");
            let output = std::process::Command::new("cmd")
                .args(["/c", "mklink", "/J"])
                .arg(&junction)
                .arg(&outside.0)
                .output()
                .unwrap();
            assert!(output.status.success(), "synthetic junction setup failed");
            let result = profile.store().store(&id, &bytes);
            fs::remove_dir(&junction).unwrap();
            assert_eq!(result.unwrap_err().code, ErrorCode::UnsafePath);
            assert_eq!(fs::read_dir(&outside.0).unwrap().count(), 0);
        }
        #[test]
        fn cleanup_failure_is_explicit_and_does_not_delete_final_sources() {
            let profile = Profile::new();
            let blocked = profile.0.join("staging.tmp");
            fs::write(&blocked, b"partial").unwrap();
            let lock = OpenOptions::new()
                .read(true)
                .share_mode(FILE_SHARE_READ)
                .open(&blocked)
                .unwrap();
            assert_eq!(
                StagedFile(blocked.clone()).cleanup().unwrap_err().code,
                ErrorCode::CleanupFailed
            );
            drop(lock);
            StagedFile(blocked).cleanup().unwrap();
        }
        #[test]
        fn directory_guards_prevent_replacement_during_io() {
            let profile = Profile::new();
            let id = hash(&fit());
            let directory = Directory::open(&profile.0, &id, true).unwrap();
            assert!(fs::rename(profile.0.join("fit-sources"), profile.0.join("moved")).is_err());
            drop(directory);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sha256_uses_known_vectors() {
        assert_eq!(
            hash(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            hash(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }
    #[test]
    fn rejects_invalid_identifiers_versions_and_unbounded_or_non_fit_data() {
        for id in [
            "../secret",
            "C:\\private.fit",
            "/tmp/a",
            "ab/../",
            "",
            &"A".repeat(64),
            &"a".repeat(63),
            &format!("{}:stream", "a".repeat(64)),
        ] {
            assert_eq!(
                validate_request(1, id).unwrap_err().code,
                ErrorCode::InvalidSourceId
            );
        }
        let id = "a".repeat(64);
        assert_eq!(
            validate_request(2, &id).unwrap_err().code,
            ErrorCode::UnsupportedVersion
        );
        assert_eq!(
            validate_bytes(&id, b"not FIT").unwrap_err().code,
            ErrorCode::InvalidFit
        );
        assert_eq!(
            validate_bytes(&id, b"12345678.FIT").unwrap_err().code,
            ErrorCode::HashMismatch
        );
        assert_eq!(
            validate_bytes(&id, &vec![0; MAX_SOURCE_BYTES + 1])
                .unwrap_err()
                .code,
            ErrorCode::TooLarge
        );
    }
}
