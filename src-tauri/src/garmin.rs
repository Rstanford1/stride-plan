//! Narrow Personal API service. Never log HTTP errors, requests or provider bodies.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    future::Future,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use zeroize::{Zeroize, Zeroizing};

pub const BASE: &str = "https://personal.connectapi.garmin.com";
pub const TOKEN_PATH: &str = "/personalapitoken-service/personal-api/personal-api-key/token";
pub const LIST_PATH: &str =
    "/activitylist-service/activities/search/activities?start=0&limit=5&activityType=running";
pub const MAX_ZIP: usize = 16 * 1024 * 1024;
pub const MAX_FIT: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Code {
    Browser,
    InvalidKey,
    Authentication,
    NotConnected,
    CredentialStore,
    Network,
    Timeout,
    RateLimited,
    Provider,
    InvalidResponse,
    TooLarge,
    InvalidArchive,
    InvalidFit,
    Storage,
    Cancelled,
    Busy,
    Unsupported,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Error {
    pub code: Code,
    pub retry_after_seconds: Option<u64>,
}
impl Error {
    pub fn new(code: Code) -> Self {
        Self {
            code,
            retry_after_seconds: None,
        }
    }
}
pub type Result<T> = std::result::Result<T, Error>;

// Intentionally no Debug/Serialize implementation for tokens or requests.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Credential {
    pub key: String,
    pub verified_at: u64,
}
impl Drop for Credential {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}
pub trait Credentials: Send + Sync {
    fn read(&self) -> Result<Option<Credential>>;
    fn write(&self, value: &Credential) -> Result<()>;
    fn delete(&self) -> Result<()>;
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 2048 && key.bytes().all(|b| (33..=126).contains(&b))
}
pub fn check_cancel(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::SeqCst) {
        Err(Error::new(Code::Cancelled))
    } else {
        Ok(())
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub credential_stored: bool,
    pub last_verified_at: Option<u64>,
    pub verified_this_session: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub activity_id: String,
    pub date: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Retrieval {
    pub provider: &'static str,
    pub activity_id: String,
    pub source: crate::fit_source_store::SourceMetadata,
}
pub struct Token {
    value: Zeroizing<String>,
    expires_at: u64,
}

pub trait Http: Send + Sync {
    fn request(
        &self,
        path: &str,
        key_auth: bool,
        secret: &str,
        limit: usize,
        cancel: &AtomicBool,
    ) -> impl Future<Output = Result<Vec<u8>>> + Send;
}
pub struct GarminHttp;
pub fn response_status(status: u16, retry_after: Option<&str>, time: u64) -> Result<()> {
    match status {
        200..=299 => Ok(()),
        401 | 403 => Err(Error::new(Code::Authentication)),
        429 => {
            let delay = retry_after.and_then(|v| {
                v.parse::<u64>().ok().or_else(|| {
                    httpdate::parse_http_date(v)
                        .ok()
                        .and_then(|d| d.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs().saturating_sub(time))
                })
            });
            Err(Error {
                code: Code::RateLimited,
                retry_after_seconds: delay.map(|n| n.min(86400)),
            })
        }
        _ => Err(Error::new(Code::Provider)),
    }
}
impl Http for GarminHttp {
    async fn request(
        &self,
        path: &str,
        key_auth: bool,
        secret: &str,
        limit: usize,
        cancel: &AtomicBool,
    ) -> Result<Vec<u8>> {
        use reqwest::{
            header::{HeaderValue, ACCEPT, AUTHORIZATION},
            redirect::Policy,
        };
        check_cancel(cancel)?;
        let network_error = |e: reqwest::Error| {
            Error::new(if e.is_timeout() {
                Code::Timeout
            } else {
                Code::Network
            })
        };
        let operation = async {
            let client = reqwest::Client::builder()
                .https_only(true)
                .redirect(Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .no_proxy()
                .build()
                .map_err(network_error)?;
            let auth_text = Zeroizing::new(format!(
                "{} {secret}",
                if key_auth { "ApiKey" } else { "Bearer" }
            ));
            let mut auth =
                HeaderValue::from_str(&auth_text).map_err(|_| Error::new(Code::InvalidResponse))?;
            auth.set_sensitive(true);
            let url = format!("{BASE}{path}");
            let request = if key_auth {
                client.post(url)
            } else {
                client.get(url)
            };
            let accept = if key_auth {
                "*/*"
            } else if path.starts_with("/download-service/") {
                "application/zip, application/x-zip-compressed, application/octet-stream"
            } else {
                "application/json"
            };
            let mut response = request
                .header(AUTHORIZATION, auth)
                .header(ACCEPT, accept)
                .send()
                .await
                .map_err(network_error)?;
            response_status(
                response.status().as_u16(),
                response
                    .headers()
                    .get("retry-after")
                    .and_then(|h| h.to_str().ok()),
                now(),
            )?;
            if response
                .content_length()
                .is_some_and(|size| size > limit as u64)
            {
                return Err(Error::new(Code::TooLarge));
            }
            let mut bytes = Vec::new();
            while let Some(mut chunk) = response.chunk().await.map_err(network_error)? {
                if bytes.len().saturating_add(chunk.len()) > limit {
                    return Err(Error::new(Code::TooLarge));
                }
                bytes.extend_from_slice(&chunk);
                // Provider bytes never enter errors or logs. Token bodies are wiped
                // by token acquisition after parsing; reqwest owns its chunk buffer.
                let _ = &mut chunk;
            }
            Ok(bytes)
        };
        tokio::select! {
            result = operation => result,
            _ = async { loop { if cancel.load(Ordering::SeqCst) { break; } tokio::time::sleep(Duration::from_millis(40)).await; } } => Err(Error::new(Code::Cancelled)),
        }
    }
}

pub struct Service<C, H> {
    pub credentials: C,
    pub http: H,
    token: Option<Token>,
    verified: bool,
    listed: Vec<String>,
}
impl<C: Credentials, H: Http> Service<C, H> {
    pub fn new(credentials: C, http: H) -> Self {
        Self {
            credentials,
            http,
            token: None,
            verified: false,
            listed: vec![],
        }
    }
    pub fn status(&self) -> Result<Status> {
        let saved = self.credentials.read()?;
        Ok(Status {
            credential_stored: saved.is_some(),
            last_verified_at: saved.as_ref().map(|c| c.verified_at),
            verified_this_session: self.verified,
        })
    }
    async fn acquire(&self, key: &str, time: u64, cancel: &AtomicBool) -> Result<Token> {
        let bytes = Zeroizing::new(
            self.http
                .request(TOKEN_PATH, true, key, 16384, cancel)
                .await?,
        );
        let raw = std::str::from_utf8(&bytes)
            .map_err(|_| Error::new(Code::InvalidResponse))?
            .trim();
        let payload = raw
            .split('.')
            .nth(1)
            .ok_or_else(|| Error::new(Code::InvalidResponse))?;
        let decoded = Zeroizing::new(
            URL_SAFE_NO_PAD
                .decode(payload)
                .map_err(|_| Error::new(Code::InvalidResponse))?,
        );
        #[derive(Deserialize)]
        struct Claims {
            exp: u64,
        }
        let claims: Claims =
            serde_json::from_slice(&decoded).map_err(|_| Error::new(Code::InvalidResponse))?;
        if claims.exp <= time + 60
            || raw.len() > 16000
            || !raw.bytes().all(|b| (33..=126).contains(&b))
        {
            return Err(Error::new(Code::InvalidResponse));
        }
        // JWT is delivered over authenticated TLS. exp schedules refresh only;
        // it never grants authorization or replaces server verification.
        Ok(Token {
            value: Zeroizing::new(raw.into()),
            expires_at: claims.exp.min(time.saturating_add(86400)),
        })
    }
    pub async fn connect(
        &mut self,
        key: Zeroizing<String>,
        time: u64,
        cancel: &AtomicBool,
    ) -> Result<Status> {
        if !valid_key(&key) {
            return Err(Error::new(Code::InvalidKey));
        }
        let token = self.acquire(&key, time, cancel).await?;
        check_cancel(cancel)?;
        // A failed replacement preserves the previously saved credential.
        self.credentials.write(&Credential {
            key: key.to_string(),
            verified_at: time,
        })?;
        self.token = Some(token);
        self.verified = true;
        self.listed.clear();
        self.status()
    }
    pub async fn verify(&mut self, time: u64, cancel: &AtomicBool) -> Result<Status> {
        let credential = self
            .credentials
            .read()?
            .ok_or_else(|| Error::new(Code::NotConnected))?;
        self.verified = false;
        self.token = None;
        let token = self.acquire(&credential.key, time, cancel).await?;
        check_cancel(cancel)?;
        self.credentials.write(&Credential {
            key: credential.key.clone(),
            verified_at: time,
        })?;
        self.token = Some(token);
        self.verified = true;
        self.status()
    }
    pub fn disconnect(&mut self) -> Result<Status> {
        self.token = None;
        self.verified = false;
        self.listed.clear();
        self.credentials.delete()?;
        self.status()
    }
    async fn get(
        &mut self,
        path: &str,
        limit: usize,
        time: u64,
        cancel: &AtomicBool,
    ) -> Result<Vec<u8>> {
        check_cancel(cancel)?;
        let credential = self
            .credentials
            .read()?
            .ok_or_else(|| Error::new(Code::NotConnected))?;
        for attempt in 0..2 {
            if self
                .token
                .as_ref()
                .is_none_or(|t| t.expires_at <= time.saturating_add(3600))
            {
                self.token = None;
                self.verified = false;
                self.token = Some(self.acquire(&credential.key, time, cancel).await?);
            }
            let result = self
                .http
                .request(
                    path,
                    false,
                    &self.token.as_ref().unwrap().value,
                    limit,
                    cancel,
                )
                .await;
            match result {
                Err(error) if error.code == Code::Authentication => {
                    self.token = None;
                    self.verified = false;
                    if attempt == 1 {
                        return Err(error);
                    }
                }
                Ok(bytes) if bytes.len() > limit => return Err(Error::new(Code::TooLarge)),
                result => return result,
            }
        }
        Err(Error::new(Code::Authentication))
    }
    pub async fn list(&mut self, time: u64, cancel: &AtomicBool) -> Result<Vec<Activity>> {
        self.listed.clear();
        let body = self.get(LIST_PATH, 512 * 1024, time, cancel).await?;
        // Deserialize a deliberately tiny projection; names, GPS and health data
        // are discarded and never returned to the frontend.
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Row {
            activity_id: u64,
            start_time_local: Option<String>,
        }
        let rows: Vec<Row> =
            serde_json::from_slice(&body).map_err(|_| Error::new(Code::InvalidResponse))?;
        if rows.len() > 5 {
            return Err(Error::new(Code::InvalidResponse));
        }
        let mut activities = vec![];
        for row in rows {
            if row.activity_id == 0 {
                return Err(Error::new(Code::InvalidResponse));
            }
            let activity_id = row.activity_id.to_string();
            let date = row.start_time_local.and_then(|s| {
                s.get(..10)
                    .filter(|d| {
                        d.bytes().enumerate().all(|(i, b)| {
                            if i == 4 || i == 7 {
                                b == b'-'
                            } else {
                                b.is_ascii_digit()
                            }
                        })
                    })
                    .map(str::to_owned)
            });
            self.listed.push(activity_id.clone());
            activities.push(Activity { activity_id, date });
        }
        Ok(activities)
    }
    pub async fn download(&mut self, id: &str, time: u64, cancel: &AtomicBool) -> Result<Vec<u8>> {
        if !valid_id(id) || !self.listed.iter().any(|v| v == id) {
            return Err(Error::new(Code::InvalidResponse));
        }
        self.get(
            &format!("/download-service/files/activity/{id}"),
            MAX_ZIP,
            time,
            cancel,
        )
        .await
    }
}
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 20
        && !id.starts_with('0')
        && id.bytes().all(|b| b.is_ascii_digit())
        && id.parse::<u64>().is_ok()
}

pub fn extract_fit(zip_bytes: &[u8], cancel: &AtomicBool) -> Result<Vec<u8>> {
    use std::io::{Cursor, Read};
    check_cancel(cancel)?;
    if zip_bytes.len() > MAX_ZIP {
        return Err(Error::new(Code::TooLarge));
    }
    let archive_error = |_| Error::new(Code::InvalidArchive);
    let mut archive = zip::ZipArchive::new(Cursor::new(zip_bytes)).map_err(archive_error)?;
    if archive.len() != 1 {
        return Err(Error::new(Code::InvalidArchive));
    }
    let mut file = archive.by_index(0).map_err(archive_error)?;
    let name = file.name();
    // No filesystem extraction: accept one flat ASCII .fit filename, reject all
    // path components, alternate streams, links, directories and special files.
    if name.len() > 128
        || !name.to_ascii_lowercase().ends_with(".fit")
        || name.starts_with('.')
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        || file.is_dir()
        || file
            .unix_mode()
            .is_some_and(|m| m & 0o170000 != 0 && m & 0o170000 != 0o100000)
        || !matches!(
            file.compression(),
            zip::CompressionMethod::Stored | zip::CompressionMethod::Deflated
        )
    {
        return Err(Error::new(Code::InvalidArchive));
    }
    if file.size() > MAX_FIT as u64 {
        return Err(Error::new(Code::TooLarge));
    }
    let declared = file.size();
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 16384];
    loop {
        check_cancel(cancel)?;
        let count = file
            .read(&mut buffer)
            .map_err(|_| Error::new(Code::InvalidArchive))?;
        if count == 0 {
            break;
        }
        if bytes.len() + count > MAX_FIT {
            return Err(Error::new(Code::TooLarge));
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    if bytes.len() as u64 != declared {
        return Err(Error::new(Code::InvalidArchive));
    }
    validate_fit(&bytes)?;
    Ok(bytes)
}
fn fit_crc(bytes: &[u8]) -> u16 {
    let mut crc = 0u16;
    for byte in bytes {
        crc ^= *byte as u16;
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xa001
            } else {
                crc >> 1
            };
        }
    }
    crc
}
fn validate_fit(bytes: &[u8]) -> Result<()> {
    let invalid = || Error::new(Code::InvalidFit);
    if bytes.len() < 14 || !matches!(bytes[0], 12 | 14) || &bytes[8..12] != b".FIT" {
        return Err(invalid());
    }
    let header = bytes[0] as usize;
    let data = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    if data == 0 || header.checked_add(data).and_then(|n| n.checked_add(2)) != Some(bytes.len()) {
        return Err(invalid());
    }
    // Header CRC may be zero (omitted per FIT); the final CRC is required here.
    if header == 14 && bytes[12..14] != [0, 0] && fit_crc(&bytes[..14]) != 0 {
        return Err(invalid());
    }
    if fit_crc(bytes) != 0 {
        return Err(invalid());
    }
    Ok(())
}
pub fn preserve(
    root: std::path::PathBuf,
    id: String,
    zip: Vec<u8>,
    cancel: Arc<AtomicBool>,
) -> Result<Retrieval> {
    if !valid_id(&id) {
        return Err(Error::new(Code::InvalidResponse));
    }
    let bytes = extract_fit(&zip, &cancel)?;
    check_cancel(&cancel)?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let storage = crate::fit_source_store::FitSourceStorage::new(root);
    let source = storage
        .store(&hash, &bytes)
        .map_err(|_| Error::new(Code::Storage))?;
    if storage.read(&hash).map_err(|_| Error::new(Code::Storage))? != bytes {
        return Err(Error::new(Code::Storage));
    }
    // No cancellation inside T03 publication: finish an atomic source + receipt
    // once publishing starts. Neither operation creates a workout or plan edit.
    storage
        .store_garmin_receipt(&id, &hash)
        .map_err(|_| Error::new(Code::Storage))?;
    Ok(Retrieval {
        provider: "garmin",
        activity_id: id,
        source,
    })
}

#[cfg(test)]
#[path = "garmin_tests.rs"]
mod tests;
