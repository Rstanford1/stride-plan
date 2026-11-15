//! Only this adapter touches Credential Manager. No file/environment fallback.
use crate::garmin::{Code, Credential, Credentials, Error, Result};

pub struct WindowsCredentials;

#[cfg(windows)]
mod native {
    use super::*;
    use std::ptr;
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };
    use zeroize::{Zeroize, Zeroizing};

    // Fixed identity; no caller-selected target, account, path or username.
    fn target() -> Vec<u16> {
        #[cfg(test)]
        {
            // Native tests must never touch the installed application's identity.
            static TARGET: std::sync::OnceLock<String> = std::sync::OnceLock::new();
            return TARGET
                .get_or_init(|| format!("com.strideplan.test/garmin/{}\0", uuid::Uuid::new_v4()))
                .encode_utf16()
                .collect();
        }
        #[cfg(not(test))]
        {
            "com.strideplan.desktop/garmin-personal-api/v1\0"
                .encode_utf16()
                .collect()
        }
    }
    impl Credentials for WindowsCredentials {
        fn read(&self) -> Result<Option<Credential>> {
            let mut entry: *mut CREDENTIALW = ptr::null_mut();
            // SAFETY: NUL-terminated target and writable output pointer. The returned
            // allocation is owned by Credential Manager and released exactly once.
            if unsafe { CredReadW(target().as_ptr(), CRED_TYPE_GENERIC, 0, &mut entry) } == 0 {
                return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
                    Ok(None)
                } else {
                    Err(Error::new(Code::CredentialStore))
                };
            }
            struct Allocation(*mut CREDENTIALW);
            impl Drop for Allocation {
                fn drop(&mut self) {
                    // SAFETY: live CredReadW allocation; clear its credential blob
                    // before releasing it. No reference to the blob escapes read().
                    unsafe {
                        let record = &mut *self.0;
                        if !record.CredentialBlob.is_null() {
                            std::slice::from_raw_parts_mut(
                                record.CredentialBlob,
                                record.CredentialBlobSize as usize,
                            )
                            .zeroize();
                        }
                        CredFree(self.0.cast());
                    }
                }
            }
            let guard = Allocation(entry);
            // SAFETY: guard holds the allocation until after deserialization.
            let record = unsafe { &*guard.0 };
            if record.CredentialBlobSize == 0
                || record.CredentialBlobSize > 2560
                || record.CredentialBlob.is_null()
            {
                return Err(Error::new(Code::CredentialStore));
            }
            let blob = unsafe {
                std::slice::from_raw_parts(
                    record.CredentialBlob,
                    record.CredentialBlobSize as usize,
                )
            };
            let value: Credential =
                serde_json::from_slice(blob).map_err(|_| Error::new(Code::CredentialStore))?;
            if !crate::garmin::valid_key(&value.key) {
                return Err(Error::new(Code::CredentialStore));
            }
            Ok(Some(value))
        }
        fn write(&self, value: &Credential) -> Result<()> {
            let mut blob = Zeroizing::new(
                serde_json::to_vec(value).map_err(|_| Error::new(Code::CredentialStore))?,
            );
            if blob.len() > 2560 {
                return Err(Error::new(Code::InvalidKey));
            }
            let mut target = target();
            let mut entry: CREDENTIALW = unsafe { std::mem::zeroed() };
            entry.Type = CRED_TYPE_GENERIC;
            entry.TargetName = target.as_mut_ptr();
            entry.Persist = CRED_PERSIST_LOCAL_MACHINE;
            entry.CredentialBlobSize = blob.len() as u32;
            entry.CredentialBlob = blob.as_mut_ptr();
            // SAFETY: buffers remain live for the call; Windows copies the blob.
            if unsafe { CredWriteW(&entry, 0) } == 0 {
                return Err(Error::new(Code::CredentialStore));
            }
            Ok(())
        }
        fn delete(&self) -> Result<()> {
            // SAFETY: constant NUL-terminated application credential identity.
            if unsafe { CredDeleteW(target().as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
                && unsafe { GetLastError() } != ERROR_NOT_FOUND
            {
                return Err(Error::new(Code::CredentialStore));
            }
            Ok(())
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn native_synthetic_credential_persists_across_adapters_then_deletes() {
        struct Cleanup;
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = WindowsCredentials.delete();
            }
        }
        let _cleanup = Cleanup;
        let first = WindowsCredentials;
        assert!(first.read().unwrap().is_none());
        first
            .write(&Credential {
                key: "SYNTHETIC-WINDOWS-CREDENTIAL-ONLY".into(),
                verified_at: 123,
            })
            .unwrap();
        let restarted = WindowsCredentials;
        let saved = restarted.read().unwrap().unwrap();
        assert_eq!(saved.key, "SYNTHETIC-WINDOWS-CREDENTIAL-ONLY");
        assert_eq!(saved.verified_at, 123);
        restarted.delete().unwrap();
        assert!(first.read().unwrap().is_none());
        first.delete().unwrap();
    }
}

#[cfg(not(windows))]
impl Credentials for WindowsCredentials {
    fn read(&self) -> Result<Option<Credential>> {
        Err(Error::new(Code::Unsupported))
    }
    fn write(&self, _: &Credential) -> Result<()> {
        Err(Error::new(Code::Unsupported))
    }
    fn delete(&self) -> Result<()> {
        Err(Error::new(Code::Unsupported))
    }
}
