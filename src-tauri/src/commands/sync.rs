use serde::Serialize;
use tauri::State;

use crate::sync::SyncEnvelope;
use crate::AppState;

const MAX_SYNC_PAYLOAD_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct SyncApplyResult {
    pub payload: SyncEnvelope,
    pub imported_count: usize,
    pub added_count: usize,
    pub duplicate_count: usize,
    pub total_count: usize,
}

#[tauri::command]
pub fn prepare_sync_payload(
    state: State<'_, AppState>,
    player_id: String,
) -> Result<SyncEnvelope, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let records = db.get_all_records(Some(&player_id))?;
    SyncEnvelope::from_records(&player_id, &records, chrono::Utc::now().to_rfc3339())
}

#[tauri::command]
pub fn apply_cloud_sync_payload(
    state: State<'_, AppState>,
    player_id: String,
    cloud_payload: String,
) -> Result<SyncApplyResult, String> {
    if cloud_payload.len() > MAX_SYNC_PAYLOAD_BYTES {
        return Err("云端同步数据超过大小限制".to_string());
    }
    let cloud: SyncEnvelope =
        serde_json::from_str(&cloud_payload).map_err(|e| format!("云端同步数据解析失败: {e}"))?;
    cloud.validate()?;
    if cloud.uid != player_id {
        return Err("所选 UID 与云端同步数据不一致".to_string());
    }
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let local_records = db.get_all_records(Some(&player_id))?;
    let local =
        SyncEnvelope::from_records(&player_id, &local_records, chrono::Utc::now().to_rfc3339())?;
    let merged = local.merge_with_cloud(&cloud, chrono::Utc::now().to_rfc3339())?;
    let records = merged.clone().into_records()?;
    let stats = db.merge_sync_records(&records)?;
    let total_count = db.get_all_records(Some(&player_id))?.len();
    Ok(SyncApplyResult {
        payload: merged,
        imported_count: stats.imported_count,
        added_count: stats.added_count,
        duplicate_count: stats.duplicate_count,
        total_count,
    })
}
