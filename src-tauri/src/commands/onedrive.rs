use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::onedrive::{self, DeviceLoginInfo, OneDriveStatus, PollResult, UploadResult};
use crate::AppState;

#[derive(Debug, Serialize)]
pub struct LoginPollStatus {
    pub connected: bool,
    pub pending: bool,
}

#[derive(Debug, Serialize)]
pub struct OneDriveSyncResult {
    pub added_count: usize,
    pub duplicate_count: usize,
    pub total_count: usize,
    pub uploaded_count: usize,
    pub conflict_retries: u32,
    pub updated_at: String,
}

#[tauri::command]
pub async fn get_onedrive_status(state: State<'_, AppState>) -> Result<OneDriveStatus, String> {
    let auth = state.onedrive.lock().await;
    Ok(onedrive::status(&auth))
}

#[tauri::command]
pub async fn start_onedrive_login(state: State<'_, AppState>) -> Result<DeviceLoginInfo, String> {
    let mut auth = state.onedrive.lock().await;
    onedrive::start_login(&state.http, &mut auth).await
}

#[tauri::command]
pub async fn poll_onedrive_login(state: State<'_, AppState>) -> Result<LoginPollStatus, String> {
    let mut auth = state.onedrive.lock().await;
    match onedrive::poll_login(&state.http, &mut auth).await? {
        PollResult::Pending => Ok(LoginPollStatus {
            connected: false,
            pending: true,
        }),
        PollResult::Connected => Ok(LoginPollStatus {
            connected: true,
            pending: false,
        }),
    }
}

#[tauri::command]
pub async fn cancel_onedrive_login(state: State<'_, AppState>) -> Result<(), String> {
    state.onedrive.lock().await.pending = None;
    Ok(())
}

#[tauri::command]
pub async fn disconnect_onedrive(state: State<'_, AppState>) -> Result<(), String> {
    let mut auth = state.onedrive.lock().await;
    onedrive::disconnect(&mut auth)
}

fn hash_file(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

#[tauri::command]
pub async fn sync_onedrive_database(
    state: State<'_, AppState>,
    _player_id: String,
    strategy: Option<String>,
) -> Result<OneDriveSyncResult, String> {
    let token = {
        let mut auth = state.onedrive.lock().await;
        onedrive::access_token(&state.http, &mut auth).await?
    };
    let folder = onedrive::ensure_sync_directories(&state.http, &token).await?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let local_path = state.app_data_dir.join(format!("sync-local-{stamp}.db"));
    let remote_path = state.app_data_dir.join(format!("sync-remote-{stamp}.db"));
    let (before_count, baseline_etag, baseline_hash) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.create_sync_snapshot(&local_path)?;
        let (etag, hash) = db.cloud_sync_baseline()?;
        (db.record_count()?, etag, hash)
    };
    let local_hash = hash_file(&local_path)?;
    let remote = onedrive::download_snapshot(&state.http, &token, &folder).await?;

    let result = match remote {
        None => {
            match onedrive::upload_snapshot(
                &state.http,
                &token,
                &folder,
                std::fs::read(&local_path).map_err(|e| e.to_string())?,
                None,
            )
            .await?
            {
                UploadResult::Conflict => {
                    Err("云端数据库刚刚被其他设备创建，请重新同步".to_string())
                }
                UploadResult::Uploaded(etag) => {
                    state
                        .db
                        .lock()
                        .map_err(|e| e.to_string())?
                        .save_cloud_sync_baseline(&etag, &local_hash)?;
                    Ok((before_count, before_count, 0))
                }
            }
        }
        Some((remote_etag, bytes)) => {
            std::fs::write(&remote_path, bytes).map_err(|e| e.to_string())?;
            let remote_changed = baseline_etag.as_deref() != Some(remote_etag.as_str());
            let local_changed = baseline_hash.as_deref() != Some(local_hash.as_str());
            if baseline_etag.is_none() && before_count > 0 && strategy.as_deref() != Some("local") && strategy.as_deref() != Some("remote") {
                Err("本机和云端都已有数据，首次连接时无法判断应保留哪一版；请先在另一端同步，或清空本机数据后重新拉取".to_string())
            } else if remote_changed && local_changed && baseline_etag.is_some() && strategy.as_deref() != Some("local") && strategy.as_deref() != Some("remote") {
                Err(
                    "本机和云端数据库都已发生变化。为避免覆盖，请先保留其中一端的修改后再同步"
                        .to_string(),
                )
            } else if strategy.as_deref() == Some("remote") || (!remote_changed && !local_changed) {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                db.apply_sync_snapshot(&remote_path)?;
                let after = db.record_count()?;
                db.create_sync_snapshot(&local_path)?;
                db.save_cloud_sync_baseline(&remote_etag, &hash_file(&local_path)?)?;
                Ok((after, 0, after.saturating_sub(before_count)))
            } else if !remote_changed && local_changed || strategy.as_deref() == Some("local") {
                match onedrive::upload_snapshot(
                    &state.http,
                    &token,
                    &folder,
                    std::fs::read(&local_path).map_err(|e| e.to_string())?,
                    Some(&remote_etag),
                )
                .await?
                {
                    UploadResult::Conflict => Err("云端数据库已变化，请重新同步".to_string()),
                    UploadResult::Uploaded(etag) => {
                        state
                            .db
                            .lock()
                            .map_err(|e| e.to_string())?
                            .save_cloud_sync_baseline(&etag, &local_hash)?;
                        Ok((before_count, before_count, 0))
                    }
                }
            } else {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                db.apply_sync_snapshot(&remote_path)?;
                let after = db.record_count()?;
                db.create_sync_snapshot(&local_path)?;
                db.save_cloud_sync_baseline(&remote_etag, &hash_file(&local_path)?)?;
                Ok((after, 0, after.saturating_sub(before_count)))
            }
        }
    };
    let _ = std::fs::remove_file(&local_path);
    let _ = std::fs::remove_file(&remote_path);
    let (total, uploaded, added) = result?;
    Ok(OneDriveSyncResult {
        added_count: added,
        duplicate_count: 0,
        total_count: total,
        uploaded_count: uploaded,
        conflict_retries: 0,
        updated_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Deprecated compatibility alias for clients released before the database-wide sync rename.
#[tauri::command]
pub async fn sync_onedrive_uid(
    state: State<'_, AppState>,
    player_id: String,
) -> Result<OneDriveSyncResult, String> {
    sync_onedrive_database(state, player_id, None).await
}
