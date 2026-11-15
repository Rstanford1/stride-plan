use super::*;
use std::{
    collections::VecDeque,
    io::{Cursor, Write},
    sync::Mutex,
};

#[derive(Clone, Default)]
struct Vault(Arc<Mutex<Option<(String, u64)>>>);
impl Credentials for Vault {
    fn read(&self) -> Result<Option<Credential>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .as_ref()
            .map(|(key, verified_at)| Credential {
                key: key.clone(),
                verified_at: *verified_at,
            }))
    }
    fn write(&self, value: &Credential) -> Result<()> {
        *self.0.lock().unwrap() = Some((value.key.clone(), value.verified_at));
        Ok(())
    }
    fn delete(&self) -> Result<()> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}
#[derive(Default)]
struct MockHttp {
    responses: Mutex<VecDeque<Result<Vec<u8>>>>,
    calls: Mutex<Vec<(String, bool)>>,
}
impl MockHttp {
    fn new(responses: Vec<Result<Vec<u8>>>) -> Self {
        Self {
            responses: Mutex::new(responses.into()),
            ..Self::default()
        }
    }
}
impl Http for MockHttp {
    async fn request(
        &self,
        path: &str,
        key_auth: bool,
        secret: &str,
        _: usize,
        cancel: &AtomicBool,
    ) -> Result<Vec<u8>> {
        check_cancel(cancel)?;
        assert!(!secret.is_empty());
        self.calls.lock().unwrap().push((path.into(), key_auth));
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected HTTP request")
    }
}
fn jwt(exp: u64) -> Vec<u8> {
    format!(
        "e30.{}.synthetic",
        URL_SAFE_NO_PAD.encode(format!("{{\"exp\":{exp}}}"))
    )
    .into_bytes()
}
fn listing() -> Vec<u8> {
    br#"[{"activityId":123,"startTimeLocal":"2026-11-14 10:00:00","activityName":"PRIVATE NAME NEVER RETURNED","startLatitude":12.345}]"#.to_vec()
}
fn cancel() -> AtomicBool {
    AtomicBool::new(false)
}
fn key() -> Zeroizing<String> {
    Zeroizing::new("SYNTHETIC-API-KEY-DO-NOT-USE".into())
}
fn service(responses: Vec<Result<Vec<u8>>>) -> Service<Vault, MockHttp> {
    Service::new(Vault::default(), MockHttp::new(responses))
}

#[tokio::test]
async fn connect_cache_restart_expiration_reacquisition_disconnect() {
    let cancel = cancel();
    let mut s = service(vec![
        Ok(jwt(90000)),
        Ok(listing()),
        Ok(listing()),
        Ok(jwt(180000)),
        Ok(listing()),
    ]);
    assert!(!s.status().unwrap().credential_stored);
    let status = s.connect(key(), 1000, &cancel).await.unwrap();
    assert!(status.verified_this_session);
    let rows = s.list(1001, &cancel).await.unwrap();
    assert_eq!(rows[0].activity_id, "123");
    assert_eq!(rows[0].date.as_deref(), Some("2026-11-14"));
    let safe = serde_json::to_string(&rows).unwrap();
    assert!(!safe.contains("PRIVATE"));
    assert!(!safe.contains("Latitude"));
    s.list(2000, &cancel).await.unwrap();
    s.list(87000, &cancel).await.unwrap();
    assert_eq!(
        s.http
            .calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, k)| *k)
            .count(),
        2
    );
    let vault = s.credentials.clone();
    let mut restarted = Service::new(
        vault.clone(),
        MockHttp::new(vec![Ok(jwt(200000)), Ok(listing())]),
    );
    let status = restarted.status().unwrap();
    assert!(status.credential_stored);
    assert!(!status.verified_this_session);
    assert_eq!(status.last_verified_at, Some(1000));
    restarted.list(90000, &cancel).await.unwrap();
    let status = restarted.disconnect().unwrap();
    assert!(!status.credential_stored);
    assert!(vault.read().unwrap().is_none());
    assert!(restarted.token.is_none());
    assert_eq!(
        restarted.list(90001, &cancel).await.unwrap_err().code,
        Code::NotConnected
    );
}

#[tokio::test]
async fn invalid_expired_keys_and_failed_replacement_preserve_previous_credential() {
    let mut s = service(vec![
        Err(Error::new(Code::Authentication)),
        Ok(jwt(90000)),
        Err(Error::new(Code::Authentication)),
    ]);
    assert_eq!(
        s.connect(Zeroizing::new("bad\nkey".into()), 1000, &cancel())
            .await
            .unwrap_err()
            .code,
        Code::InvalidKey
    );
    assert_eq!(
        s.connect(key(), 1000, &cancel()).await.unwrap_err().code,
        Code::Authentication
    );
    assert!(!s.status().unwrap().credential_stored);
    s.connect(key(), 1000, &cancel()).await.unwrap();
    assert_eq!(
        s.connect(Zeroizing::new("REVOKED".into()), 1001, &cancel())
            .await
            .unwrap_err()
            .code,
        Code::Authentication
    );
    assert_eq!(s.credentials.read().unwrap().unwrap().key, *key());
}

#[tokio::test]
async fn http_401_reacquires_once_and_second_failure_clears_token() {
    let mut s = service(vec![
        Ok(jwt(90000)),
        Err(Error::new(Code::Authentication)),
        Ok(jwt(91000)),
        Ok(listing()),
        Err(Error::new(Code::Authentication)),
        Ok(jwt(92000)),
        Err(Error::new(Code::Authentication)),
    ]);
    s.connect(key(), 1000, &cancel()).await.unwrap();
    s.list(1001, &cancel()).await.unwrap();
    assert_eq!(
        s.list(1002, &cancel()).await.unwrap_err().code,
        Code::Authentication
    );
    assert!(s.token.is_none());
    assert!(!s.verified);
    assert_eq!(s.http.calls.lock().unwrap().len(), 7);
}

#[tokio::test]
async fn network_timeout_and_rate_limit_errors_remain_typed_no_automatic_retry() {
    for code in [Code::Network, Code::Timeout, Code::RateLimited] {
        let mut s = service(vec![Ok(jwt(90000)), Err(Error::new(code))]);
        s.connect(key(), 1000, &cancel()).await.unwrap();
        assert_eq!(s.list(1001, &cancel()).await.unwrap_err().code, code);
        assert_eq!(s.http.calls.lock().unwrap().len(), 2);
    }
    assert_eq!(
        response_status(429, Some("120"), 0)
            .unwrap_err()
            .retry_after_seconds,
        Some(120)
    );
    assert_eq!(
        response_status(429, Some("Thu, 01 Jan 1970 00:02:00 GMT"), 60)
            .unwrap_err()
            .retry_after_seconds,
        Some(60)
    );
    let error = response_status(429, Some("SYNTHETIC-API-KEY"), 0).unwrap_err();
    assert_eq!(error.retry_after_seconds, None);
    for status in [301, 400, 401, 403, 429, 500] {
        let safe = format!(
            "{:?} {}",
            response_status(status, Some("secret"), 0),
            serde_json::to_string(&response_status(status, Some("secret"), 0).unwrap_err())
                .unwrap()
        );
        assert!(!safe.contains("secret"));
        assert!(!safe.contains("http"));
        assert!(!safe.contains("Authorization"));
    }
}

#[tokio::test]
async fn list_is_bounded_download_requires_selection_and_cancellation_is_safe() {
    let zip = archive("record.fit", &fit(), None);
    let mut s = service(vec![Ok(jwt(90000)), Ok(listing()), Ok(zip.clone())]);
    s.connect(key(), 1000, &cancel()).await.unwrap();
    assert_eq!(
        s.download("123", 1001, &cancel()).await.unwrap_err().code,
        Code::InvalidResponse
    );
    s.list(1001, &cancel()).await.unwrap();
    for id in ["../secret", "0", "0123", "999", "123/other"] {
        assert_eq!(
            s.download(id, 1001, &cancel()).await.unwrap_err().code,
            Code::InvalidResponse
        );
    }
    assert_eq!(s.download("123", 1001, &cancel()).await.unwrap(), zip);
    let stopped = AtomicBool::new(true);
    assert_eq!(
        s.list(1001, &stopped).await.unwrap_err().code,
        Code::Cancelled
    );
    let mut s = service(vec![Ok(jwt(90000)), Ok(b"[{\"activityId\":1},{\"activityId\":2},{\"activityId\":3},{\"activityId\":4},{\"activityId\":5},{\"activityId\":6}]".to_vec())]);
    s.connect(key(), 1000, &cancel()).await.unwrap();
    assert_eq!(
        s.list(1001, &cancel()).await.unwrap_err().code,
        Code::InvalidResponse
    );
}

#[tokio::test]
async fn malformed_or_expired_tokens_are_not_saved() {
    for body in [
        b"PRIVATE PROVIDER ERROR".to_vec(),
        jwt(900),
        jwt(1030),
        b"e30.eyJleHAiOiJzZWNyZXQifQ.sig".to_vec(),
    ] {
        let mut s = service(vec![Ok(body)]);
        assert_eq!(
            s.connect(key(), 1000, &cancel()).await.unwrap_err().code,
            Code::InvalidResponse
        );
        assert!(!s.status().unwrap().credential_stored);
    }
}

fn fit() -> Vec<u8> {
    // Synthetic FIT activity file_id definition and data record (no private data).
    let data = [0x40, 0, 0, 0, 0, 1, 0, 1, 0, 0, 4];
    let mut bytes = vec![12, 0x20, 0, 0];
    bytes.extend_from_slice(&(data.len() as u32).to_le_bytes());
    bytes.extend_from_slice(b".FIT");
    bytes.extend_from_slice(&data);
    bytes.extend_from_slice(&fit_crc(&bytes).to_le_bytes());
    bytes
}
fn archive(name: &str, bytes: &[u8], second: Option<&str>) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    writer.start_file(name, options).unwrap();
    writer.write_all(bytes).unwrap();
    if let Some(other) = second {
        writer.start_file(other, options).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

#[test]
fn archive_keeps_original_bytes_and_rejects_missing_extra_malformed_and_unsafe_entries() {
    let bytes = fit();
    assert_eq!(
        extract_fit(&archive("123_ACTIVITY.fit", &bytes, None), &cancel()).unwrap(),
        bytes
    );
    for name in [
        "../run.fit",
        "/run.fit",
        "C:run.fit",
        "dir/run.fit",
        "dir\\run.fit",
        "run.fit:stream",
        ".hidden.fit",
        "run.txt",
    ] {
        assert_eq!(
            extract_fit(&archive(name, &bytes, None), &cancel())
                .unwrap_err()
                .code,
            Code::InvalidArchive,
            "{name}"
        );
    }
    assert_eq!(
        extract_fit(b"not a zip", &cancel()).unwrap_err().code,
        Code::InvalidArchive
    );
    assert_eq!(
        extract_fit(&archive("a.fit", &bytes, Some("b.fit")), &cancel())
            .unwrap_err()
            .code,
        Code::InvalidArchive
    );
    assert_eq!(
        extract_fit(&archive("a.fit", b"not FIT", None), &cancel())
            .unwrap_err()
            .code,
        Code::InvalidFit
    );
    let mut damaged = bytes.clone();
    damaged[15] ^= 1;
    assert_eq!(
        extract_fit(&archive("a.fit", &damaged, None), &cancel())
            .unwrap_err()
            .code,
        Code::InvalidFit
    );
    let mut partial = archive("a.fit", &bytes, None);
    partial.truncate(partial.len() / 2);
    assert_eq!(
        extract_fit(&partial, &cancel()).unwrap_err().code,
        Code::InvalidArchive
    );
    assert_eq!(
        extract_fit(&vec![0; MAX_ZIP + 1], &cancel())
            .unwrap_err()
            .code,
        Code::TooLarge
    );
    assert_eq!(
        extract_fit(&archive("bomb.fit", &vec![0; MAX_FIT + 1], None), &cancel())
            .unwrap_err()
            .code,
        Code::TooLarge
    );
    assert_eq!(
        extract_fit(&archive("a.fit", &bytes, None), &AtomicBool::new(true))
            .unwrap_err()
            .code,
        Code::Cancelled
    );
}

#[test]
fn zip_crc_corruption_and_symlink_are_rejected() {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .add_symlink(
            "link.fit",
            "target.fit",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
    let zip = writer.finish().unwrap().into_inner();
    assert_eq!(
        extract_fit(&zip, &cancel()).unwrap_err().code,
        Code::InvalidArchive
    );
    let mut zip = archive("a.fit", &fit(), None);
    // Change compressed data without updating the ZIP CRC.
    zip[35] ^= 0xff;
    assert!(extract_fit(&zip, &cancel()).is_err());
}

#[tokio::test]
async fn oversized_and_partial_downloads_never_become_sources() {
    let mut s = service(vec![
        Ok(jwt(90000)),
        Ok(listing()),
        Ok(vec![0; MAX_ZIP + 1]),
        Ok(b"PK-partial".to_vec()),
    ]);
    s.connect(key(), 1000, &cancel()).await.unwrap();
    s.list(1001, &cancel()).await.unwrap();
    assert_eq!(
        s.download("123", 1001, &cancel()).await.unwrap_err().code,
        Code::TooLarge
    );
    let partial = s.download("123", 1001, &cancel()).await.unwrap();
    assert_eq!(
        extract_fit(&partial, &cancel()).unwrap_err().code,
        Code::InvalidArchive
    );
}

#[tokio::test]
async fn cancellation_during_token_request_never_saves_credentials() {
    struct WaitingHttp;
    impl Http for WaitingHttp {
        async fn request(
            &self,
            _: &str,
            _: bool,
            _: &str,
            _: usize,
            cancel: &AtomicBool,
        ) -> Result<Vec<u8>> {
            while !cancel.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
            Err(Error::new(Code::Cancelled))
        }
    }
    let mut s = Service::new(Vault::default(), WaitingHttp);
    let stop = cancel();
    let (result, ()) = tokio::join!(s.connect(key(), 1000, &stop), async {
        tokio::task::yield_now().await;
        stop.store(true, Ordering::SeqCst);
    });
    assert_eq!(result.unwrap_err().code, Code::Cancelled);
    assert!(!s.status().unwrap().credential_stored);
    assert!(s.token.is_none());
}

#[tokio::test]
async fn credential_write_failure_does_not_claim_connection() {
    struct UnavailableVault;
    impl Credentials for UnavailableVault {
        fn read(&self) -> Result<Option<Credential>> {
            Ok(None)
        }
        fn write(&self, _: &Credential) -> Result<()> {
            Err(Error::new(Code::CredentialStore))
        }
        fn delete(&self) -> Result<()> {
            Err(Error::new(Code::CredentialStore))
        }
    }
    let mut s = Service::new(UnavailableVault, MockHttp::new(vec![Ok(jwt(90000))]));
    assert_eq!(
        s.connect(key(), 1000, &cancel()).await.unwrap_err().code,
        Code::CredentialStore
    );
    assert!(s.token.is_none());
    assert!(!s.verified);
}

#[cfg(windows)]
#[test]
fn provenance_conflicts_and_linked_receipts_fail_without_overwriting() {
    let root = std::env::temp_dir().join(format!("stride-garmin-receipt-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let zip = archive("123.fit", &fit(), None);
    let first = preserve(root.clone(), "123".into(), zip.clone(), Arc::new(cancel())).unwrap();
    let receipt = root
        .join(first.source.stored_relative_path)
        .with_file_name(format!("{}.garmin-123.json", first.source.source_hash));
    std::fs::write(&receipt, b"existing conflicting receipt").unwrap();
    assert_eq!(
        preserve(root.clone(), "123".into(), zip.clone(), Arc::new(cancel()))
            .unwrap_err()
            .code,
        Code::Storage
    );
    assert_eq!(
        std::fs::read(&receipt).unwrap(),
        b"existing conflicting receipt"
    );
    std::fs::remove_file(&receipt).unwrap();
    let trap = root.join("synthetic-trap.txt");
    std::fs::write(&trap, b"retained").unwrap();
    std::fs::hard_link(&trap, &receipt).unwrap();
    assert_eq!(
        preserve(root.clone(), "123".into(), zip, Arc::new(cancel()))
            .unwrap_err()
            .code,
        Code::Storage
    );
    assert_eq!(std::fs::read(&trap).unwrap(), b"retained");
    assert_eq!(
        preserve(root.clone(), "../escape".into(), vec![], Arc::new(cancel()))
            .unwrap_err()
            .code,
        Code::InvalidResponse
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[tokio::test]
async fn download_to_t03_preserves_hash_receipt_duplicates_restart_and_disconnect() {
    let root = std::env::temp_dir().join(format!("stride-garmin-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let bytes = fit();
    let zip = archive("123.fit", &bytes, None);
    let mut s = service(vec![Ok(jwt(90000)), Ok(listing()), Ok(zip.clone())]);
    s.connect(key(), 1000, &cancel()).await.unwrap();
    s.list(1001, &cancel()).await.unwrap();
    let downloaded = s.download("123", 1001, &cancel()).await.unwrap();
    let first = preserve(root.clone(), "123".into(), downloaded, Arc::new(cancel())).unwrap();
    let expected = format!("{:x}", Sha256::digest(&bytes));
    assert_eq!(first.source.source_hash, expected);
    let path = root.join(&first.source.stored_relative_path);
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    let second = preserve(root.clone(), "123".into(), zip, Arc::new(cancel())).unwrap();
    assert_eq!(first.source, second.source);
    assert_eq!(
        std::fs::metadata(&path).unwrap().modified().unwrap(),
        modified
    );
    s.disconnect().unwrap();
    assert_eq!(
        crate::fit_source_store::FitSourceStorage::new(root.clone())
            .read(&expected)
            .unwrap(),
        bytes
    );
    let receipt = path
        .parent()
        .unwrap()
        .join(format!("{expected}.garmin-123.json"));
    let raw = std::fs::read_to_string(&receipt).unwrap();
    assert!(raw.contains("\"activityId\":\"123\""));
    assert!(raw.contains(&expected));
    assert!(!raw.contains(&*key()));
    assert!(!raw.contains("Bearer"));
    assert_eq!(
        std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
        2
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[test]
fn storage_failure_never_returns_a_preservation_success() {
    let root = std::env::temp_dir().join(format!("stride-garmin-blocked-{}", uuid::Uuid::new_v4()));
    std::fs::write(&root, b"not a directory").unwrap();
    let error = preserve(
        root.clone(),
        "123".into(),
        archive("a.fit", &fit(), None),
        Arc::new(cancel()),
    )
    .unwrap_err();
    assert_eq!(error.code, Code::Storage);
    std::fs::remove_file(root).unwrap();
}
