use keyring::Entry;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

// Public client IDs are not secrets. Keep the registered app ID in the
// distributed build, while allowing CI/local builds to override it.
const DEFAULT_CLIENT_ID: &str = "5ee223c2-6d8f-48b4-ac81-1f7fe3cb9052";
const TOKEN_SERVICE: &str = "Wuwa Gacha Tool";
const TOKEN_ACCOUNT: &str = "onedrive-refresh-token";
const SCOPE: &str = "offline_access Files.ReadWrite";
const AUTH_BASE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const DRIVE_BASE: &str = "https://graph.microsoft.com/v1.0/me/drive";
const SYNC_ROOT_NAME: &str = "Wuwa Gacha Tool";
pub const MAX_SYNC_PAYLOAD_BYTES: usize = 256 * 1024 * 1024;

#[derive(Default)]
pub struct OneDriveState {
    pub pending: Option<PendingLogin>,
    access: Option<AccessToken>,
}

pub struct PendingLogin {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_at: u64,
    pub interval_seconds: u64,
}

struct AccessToken {
    value: String,
    expires_at: u64,
}

#[derive(Debug, Serialize)]
pub struct OneDriveStatus {
    pub configured: bool,
    pub connected: bool,
    pub login_pending: bool,
}

#[derive(Debug, Serialize)]
pub struct DeviceLoginInfo {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_at: String,
    pub interval_seconds: u64,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    #[serde(default = "default_poll_interval")]
    interval: u64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OAuthError {
    error: String,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DriveItem {
    id: String,
    #[serde(rename = "eTag")]
    etag: String,
}

pub enum PollResult {
    Pending,
    Connected,
}

pub enum UploadResult {
    Uploaded(String),
    Conflict,
}

fn default_poll_interval() -> u64 {
    5
}

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn client_id() -> Result<&'static str, String> {
    Ok(option_env!("WUWA_ONEDRIVE_CLIENT_ID")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_CLIENT_ID))
}

fn credential() -> Result<Entry, String> {
    Entry::new(TOKEN_SERVICE, TOKEN_ACCOUNT).map_err(|error| format!("无法访问系统凭据库: {error}"))
}

fn saved_refresh_token() -> Option<String> {
    credential().ok()?.get_password().ok()
}

fn save_refresh_token(token: &str) -> Result<(), String> {
    credential()?
        .set_password(token)
        .map_err(|error| format!("无法保存 OneDrive 登录凭据: {error}"))
}

pub fn status(state: &OneDriveState) -> OneDriveStatus {
    OneDriveStatus {
        configured: client_id().is_ok(),
        connected: saved_refresh_token().is_some(),
        login_pending: state.pending.is_some(),
    }
}

pub fn disconnect(state: &mut OneDriveState) -> Result<(), String> {
    state.pending = None;
    state.access = None;
    if let Ok(entry) = credential() {
        let _ = entry.delete_credential();
    }
    Ok(())
}

pub async fn start_login(
    client: &Client,
    state: &mut OneDriveState,
) -> Result<DeviceLoginInfo, String> {
    let response = client
        .post(format!("{AUTH_BASE}/devicecode"))
        .form(&[("client_id", client_id()?), ("scope", SCOPE)])
        .send()
        .await
        .map_err(|error| format!("无法连接 Microsoft 登录服务: {error}"))?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(oauth_error(&bytes, "无法开始 OneDrive 登录"));
    }
    let code: DeviceCodeResponse =
        serde_json::from_slice(&bytes).map_err(|_| "Microsoft 登录响应格式无效".to_string())?;
    let expires_at = now_epoch().saturating_add(code.expires_in);
    let info = DeviceLoginInfo {
        user_code: code.user_code.clone(),
        verification_uri: code.verification_uri.clone(),
        expires_at: chrono::DateTime::from_timestamp(expires_at as i64, 0)
            .unwrap_or_default()
            .to_rfc3339(),
        interval_seconds: code.interval.max(1),
    };
    state.pending = Some(PendingLogin {
        device_code: code.device_code,
        user_code: code.user_code,
        verification_uri: code.verification_uri,
        expires_at,
        interval_seconds: code.interval.max(1),
    });
    Ok(info)
}

pub async fn poll_login(client: &Client, state: &mut OneDriveState) -> Result<PollResult, String> {
    let pending = state
        .pending
        .as_ref()
        .ok_or_else(|| "没有待完成的 OneDrive 登录".to_string())?;
    if now_epoch() >= pending.expires_at {
        state.pending = None;
        return Err("OneDrive 登录验证码已过期，请重新登录".to_string());
    }
    let response = client
        .post(format!("{AUTH_BASE}/token"))
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("client_id", client_id()?),
            ("device_code", pending.device_code.as_str()),
        ])
        .send()
        .await
        .map_err(|error| format!("无法检查 OneDrive 登录状态: {error}"))?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        let error: OAuthError = serde_json::from_slice(&bytes).unwrap_or(OAuthError {
            error: "unknown_error".into(),
            error_description: None,
        });
        return match error.error.as_str() {
            "authorization_pending" | "slow_down" => Ok(PollResult::Pending),
            "expired_token" => {
                state.pending = None;
                Err("OneDrive 登录验证码已过期，请重新登录".to_string())
            }
            "access_denied" => {
                state.pending = None;
                Err("OneDrive 登录已取消".to_string())
            }
            _ => Err(error
                .error_description
                .unwrap_or_else(|| "OneDrive 登录失败".to_string())),
        };
    }
    let token: TokenResponse =
        serde_json::from_slice(&bytes).map_err(|_| "Microsoft 令牌响应格式无效".to_string())?;
    let refresh = token
        .refresh_token
        .ok_or_else(|| "Microsoft 未返回刷新凭据".to_string())?;
    save_refresh_token(&refresh)?;
    state.access = Some(AccessToken {
        value: token.access_token,
        expires_at: now_epoch().saturating_add(token.expires_in),
    });
    state.pending = None;
    Ok(PollResult::Connected)
}

pub async fn access_token(client: &Client, state: &mut OneDriveState) -> Result<String, String> {
    if let Some(access) = &state.access {
        if access.expires_at > now_epoch().saturating_add(60) {
            return Ok(access.value.clone());
        }
    }
    let refresh = saved_refresh_token().ok_or_else(|| "请先登录 OneDrive".to_string())?;
    let response = client
        .post(format!("{AUTH_BASE}/token"))
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", client_id()?),
            ("refresh_token", refresh.as_str()),
            ("scope", SCOPE),
        ])
        .send()
        .await
        .map_err(|error| format!("无法刷新 OneDrive 登录状态: {error}"))?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        state.access = None;
        return Err(oauth_error(&bytes, "OneDrive 登录已失效，请重新登录"));
    }
    let token: TokenResponse =
        serde_json::from_slice(&bytes).map_err(|_| "Microsoft 令牌响应格式无效".to_string())?;
    if let Some(rotated) = token.refresh_token.as_deref() {
        save_refresh_token(rotated)?;
    }
    state.access = Some(AccessToken {
        value: token.access_token.clone(),
        expires_at: now_epoch().saturating_add(token.expires_in),
    });
    Ok(token.access_token)
}

pub async fn ensure_sync_directories(client: &Client, token: &str) -> Result<String, String> {
    ensure_folder(client, token, &format!("{DRIVE_BASE}/root"), SYNC_ROOT_NAME).await
}

async fn ensure_folder(
    client: &Client,
    token: &str,
    parent: &str,
    name: &str,
) -> Result<String, String> {
    let existing = client
        .get(format!("{parent}/children"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("无法读取 OneDrive 同步目录: {error}"))?;
    if existing.status().is_success() {
        let value: serde_json::Value = existing
            .json()
            .await
            .map_err(|_| "OneDrive 同步目录响应格式无效".to_string())?;
        if let Some(id) = value
            .get("value")
            .and_then(|v| v.as_array())
            .and_then(|items| {
                items
                    .iter()
                    .find(|item| item.get("name").and_then(|v| v.as_str()) == Some(name))
            })
            .and_then(|item| item.get("id"))
            .and_then(|v| v.as_str())
        {
            return Ok(id.to_string());
        }
    } else if existing.status() != StatusCode::NOT_FOUND {
        return Err(graph_error(existing, "读取同步目录").await);
    }
    let response = client
        .post(format!("{parent}/children"))
        .bearer_auth(token)
        .json(&serde_json::json!({
            "name": name,
            "folder": {},
            "@microsoft.graph.conflictBehavior": "fail"
        }))
        .send()
        .await
        .map_err(|error| format!("无法创建 OneDrive 同步目录: {error}"))?;
    if response.status().is_success() {
        let item: DriveItem = response
            .json()
            .await
            .map_err(|_| "OneDrive 同步目录响应格式无效".to_string())?;
        return Ok(item.id);
    }
    if response.status() == StatusCode::CONFLICT {
        let retry = client
            .get(format!("{parent}/children"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| format!("无法读取 OneDrive 同步目录: {error}"))?;
        if retry.status().is_success() {
            let value: serde_json::Value = retry
                .json()
                .await
                .map_err(|_| "OneDrive 同步目录响应格式无效".to_string())?;
            if let Some(id) = value
                .get("value")
                .and_then(|v| v.as_array())
                .and_then(|items| {
                    items
                        .iter()
                        .find(|item| item.get("name").and_then(|v| v.as_str()) == Some(name))
                })
                .and_then(|item| item.get("id"))
                .and_then(|v| v.as_str())
            {
                return Ok(id.to_string());
            }
        }
    }
    Err(graph_error(response, "创建同步目录").await)
}

pub async fn download_snapshot(
    client: &Client,
    token: &str,
    folder_id: &str,
) -> Result<Option<(String, Vec<u8>)>, String> {
    let db_name = crate::paths::MAIN_DB_FILENAME;
    let path = format!("{DRIVE_BASE}/items/{folder_id}:/{db_name}:");
    let metadata = client
        .get(&path)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("无法读取 OneDrive 同步元数据: {error}"))?;
    if metadata.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !metadata.status().is_success() {
        return Err(graph_error(metadata, "读取同步文件元数据").await);
    }
    let item: DriveItem = metadata
        .json()
        .await
        .map_err(|_| "OneDrive 同步元数据格式无效".to_string())?;
    let content = client
        .get(format!("{path}/content"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("无法下载 OneDrive 同步数据: {error}"))?;
    if !content.status().is_success() {
        return Err(graph_error(content, "下载同步文件").await);
    }
    if content.content_length().unwrap_or(0) > MAX_SYNC_PAYLOAD_BYTES as u64 {
        return Err("云端同步数据超过大小限制".to_string());
    }
    let bytes = content.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_SYNC_PAYLOAD_BYTES {
        return Err("云端同步数据超过大小限制".to_string());
    }
    Ok(Some((item.etag, bytes.to_vec())))
}

pub async fn upload_snapshot(
    client: &Client,
    token: &str,
    folder_id: &str,
    body: Vec<u8>,
    etag: Option<&str>,
) -> Result<UploadResult, String> {
    if body.len() > MAX_SYNC_PAYLOAD_BYTES {
        return Err("同步数据超过大小限制".to_string());
    }
    let db_name = crate::paths::MAIN_DB_FILENAME;
    let mut request = client
        .put(format!(
            "{DRIVE_BASE}/items/{folder_id}:/{db_name}:/content"
        ))
        .bearer_auth(token)
        .header(reqwest::header::CONTENT_TYPE, "application/vnd.sqlite3")
        .body(body);
    request = if let Some(value) = etag {
        request.header(reqwest::header::IF_MATCH, value)
    } else {
        request.header(reqwest::header::IF_NONE_MATCH, "*")
    };
    let response = request
        .send()
        .await
        .map_err(|error| format!("无法上传 OneDrive 同步数据: {error}"))?;
    if response.status() == StatusCode::PRECONDITION_FAILED
        || response.status() == StatusCode::CONFLICT
    {
        return Ok(UploadResult::Conflict);
    }
    if response.status().is_success() {
        let item: DriveItem = response
            .json()
            .await
            .map_err(|_| "OneDrive 上传响应格式无效".to_string())?;
        return Ok(UploadResult::Uploaded(item.etag));
    }
    Err(graph_error(response, "上传同步文件").await)
}

async fn graph_error(response: reqwest::Response, fallback: &str) -> String {
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED {
        return "OneDrive 登录已失效，请重新登录".to_string();
    }
    let body = response.text().await.unwrap_or_default();
    let parsed = serde_json::from_str::<serde_json::Value>(&body).ok();
    let code = parsed
        .as_ref()
        .and_then(|value| value.pointer("/error/code"))
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");
    let message = parsed
        .as_ref()
        .and_then(|value| value.pointer("/error/message"))
        .and_then(|value| value.as_str())
        .unwrap_or("未返回详细错误");
    format!(
        "{fallback}失败（HTTP {}，{}：{}）",
        status.as_u16(),
        code,
        message
    )
}

fn oauth_error(bytes: &[u8], fallback: &str) -> String {
    serde_json::from_slice::<OAuthError>(bytes)
        .ok()
        .and_then(|error| error.error_description)
        .unwrap_or_else(|| fallback.to_string())
}
