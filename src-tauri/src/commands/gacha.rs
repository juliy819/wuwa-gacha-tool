use std::collections::HashMap;

use tauri::State;

use crate::gacha::decoder;
use crate::gacha::fetcher::{self, build_pool_name_to_id, get_display_pool_name, ApiCardInfo, GachaParams, POOL_TYPES};
use crate::gacha::parser::{ClearRecordsResult, GachaImportResult, GachaRecord, GachaStats, GameDirValidation, GameSettings, RecordSummary};
use crate::AppState;

/// 解码日志文件并提取 URL
#[tauri::command]
pub fn decode_log(game_dir: String) -> Result<String, String> {
    let log_path = decoder::get_log_path(&game_dir);
    let decoded = decoder::decode_client_log(&log_path)?;
    let url = decoder::extract_gacha_url(&decoded)
        .ok_or_else(|| "未找到抽卡链接，请先在游戏中打开抽卡历史记录".to_string())?;
    Ok(url)
}

/// 从抽卡链接获取抽卡数据（公共逻辑）
async fn fetch_gacha_data_internal(
    state: &State<'_, AppState>,
    url: &str,
) -> Result<GachaImportResult, String> {
    let params = GachaParams::from_url(url)?;
    let client = reqwest::Client::new();
    let name_to_id = build_pool_name_to_id();

    let mut all_records: Vec<GachaRecord> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for (pool_name, pool_type) in POOL_TYPES.iter() {
        // API 请求需要发送数字 ID（如 "1"），而非中文名
        match fetcher::fetch_pool_data(&client, &params, pool_type).await {
            Ok(cards) => {
                for card in cards {
                    // API 返回的 cardPoolType 是中文名，反查 pool type ID
                    let actual_pool_type = name_to_id
                        .get(&card.card_pool_type)
                        .cloned()
                        .unwrap_or_else(|| pool_type.to_string());
                    let actual_pool_name = get_display_pool_name(&actual_pool_type).to_string();
                    all_records.push(GachaRecord::from_api(
                        &card,
                        &params.player_id,
                        &actual_pool_name,
                        &actual_pool_type,
                    ));
                }
            }
            Err(e) => {
                eprintln!("获取 {} 失败: {}", pool_name, e);
                errors.push(format!("{}: {}", pool_name, e));
            }
        }
    }

    // 如果一条记录都没获取到且有错误，返回第一个错误
    if all_records.is_empty() && !errors.is_empty() {
        return Err(format!("所有卡池请求均失败，首个错误: {}", errors[0]));
    }

    merge_and_load_player(state, &params.player_id, &all_records, errors)
}

fn merge_and_load_player(
    state: &State<'_, AppState>,
    player_id: &str,
    imported_records: &[GachaRecord],
    failed_pools: Vec<String>,
) -> Result<GachaImportResult, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let stats = db.merge_records(imported_records)?;
    let records = db.get_all_records(Some(player_id))?;
    let total_count = records.len();

    Ok(GachaImportResult {
        player_id: player_id.to_string(),
        records,
        imported_count: stats.imported_count,
        added_count: stats.added_count,
        duplicate_count: stats.duplicate_count,
        total_count,
        failed_pools,
    })
}

/// 从游戏目录解码日志并获取抽卡数据
#[tauri::command]
pub async fn fetch_gacha_data(
    state: State<'_, AppState>,
    game_dir: String,
) -> Result<GachaImportResult, String> {
    // 解码日志获取 URL
    let log_path = decoder::get_log_path(&game_dir);
    let decoded = decoder::decode_client_log(&log_path)?;
    let url = decoder::extract_gacha_url(&decoded)
        .ok_or_else(|| "未找到抽卡链接，请先在游戏中打开抽卡历史记录".to_string())?;

    fetch_gacha_data_internal(&state, &url).await
}

/// 直接通过抽卡链接获取抽卡数据
#[tauri::command]
pub async fn fetch_gacha_data_by_url(
    state: State<'_, AppState>,
    url: String,
) -> Result<GachaImportResult, String> {
    fetch_gacha_data_internal(&state, &url).await
}

/// 从本地 JSON 文件导入抽卡数据
/// JSON 格式: { "1": [...cards], "2": [...], ..., "uid": "player_id" }
#[tauri::command]
pub fn import_gacha_json(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<GachaImportResult, String> {
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("读取文件失败: {}", e))?;

    let parsed: HashMap<String, serde_json::Value> = serde_json::from_str(&content)
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let player_id = parsed
        .get("uid")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "JSON 中未找到 uid 字段".to_string())?
        .to_string();

    let name_to_id = build_pool_name_to_id();
    let mut all_records: Vec<GachaRecord> = Vec::new();

    for (pool_type_key, cards_value) in &parsed {
        // 跳过 uid 字段
        if pool_type_key == "uid" { continue; }

        let cards: Vec<ApiCardInfo> = serde_json::from_value(cards_value.clone())
            .map_err(|e| format!("解析卡池 {} 数据失败: {}", pool_type_key, e))?;

        for card in cards {
            // API 返回的 cardPoolType 是中文名，反查 pool type ID
            let actual_pool_type = name_to_id
                .get(&card.card_pool_type)
                .cloned()
                .unwrap_or_else(|| pool_type_key.clone());
            let actual_pool_name = get_display_pool_name(&actual_pool_type).to_string();
            all_records.push(GachaRecord::from_api(
                &card,
                &player_id,
                &actual_pool_name,
                &actual_pool_type,
            ));
        }
    }

    if all_records.is_empty() {
        return Err("JSON 文件中没有有效的抽卡记录".to_string());
    }

    merge_and_load_player(&state, &player_id, &all_records, Vec::new())
}

/// 获取所有抽卡记录
#[tauri::command]
pub fn get_all_records(
    state: State<'_, AppState>,
    player_id: Option<String>,
) -> Result<Vec<GachaRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_records(player_id.as_deref())
}

/// 获取所有玩家 ID
#[tauri::command]
pub fn get_pools(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_player_ids()
}

/// 获取每个玩家的记录数量和时间范围
#[tauri::command]
pub fn get_record_summaries(state: State<'_, AppState>) -> Result<Vec<RecordSummary>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_record_summaries()
}

/// 获取统计数据
#[tauri::command]
pub fn get_stats(
    state: State<'_, AppState>,
    player_id: Option<String>,
) -> Result<GachaStats, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let records = db.get_all_records(player_id.as_deref())?;
    Ok(GachaStats::from_records(&records))
}

/// 清空记录
#[tauri::command]
pub fn clear_records(
    state: State<'_, AppState>,
    player_id: Option<String>,
) -> Result<ClearRecordsResult, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.clear_records(player_id.as_deref())
}

/// 保存游戏目录
#[tauri::command]
pub fn save_game_dir(
    state: State<'_, AppState>,
    game_dir: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.save_settings(&GameSettings { game_dir })
}

/// 获取游戏目录
#[tauri::command]
pub fn get_game_dir(state: State<'_, AppState>) -> Result<GameSettings, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_settings()
}

/// 检查游戏目录及 Client.log 是否存在。
#[tauri::command]
pub fn validate_game_dir(game_dir: String) -> GameDirValidation {
    let trimmed = game_dir.trim();
    let log_path = decoder::get_log_path(trimmed);

    if trimmed.is_empty() {
        return GameDirValidation {
            valid: false,
            log_path,
            message: "尚未设置游戏目录".to_string(),
        };
    }

    let path = std::path::Path::new(&log_path);
    if path.is_file() {
        GameDirValidation {
            valid: true,
            log_path,
            message: "已找到 Client.log".to_string(),
        }
    } else {
        GameDirValidation {
            valid: false,
            log_path,
            message: "未找到 Client\\Saved\\Logs\\Client.log".to_string(),
        }
    }
}
