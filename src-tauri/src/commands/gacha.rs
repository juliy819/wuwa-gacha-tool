use std::collections::HashMap;

use chrono::{Duration, NaiveDateTime};
use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

use crate::assets::GachaResource;
use crate::db::{MockInsertRequest, MockUpdateRequest};
use crate::gacha::decoder;
use crate::gacha::fetcher::{
    self, build_pool_name_to_id, get_display_pool_name, pool_type_to_api_name, ApiCardInfo,
    GachaParams, POOL_TYPES,
};
use crate::gacha::parser::{
    ClearRecordsResult, GachaImportResult, GachaRecord, GachaStats, GameDirValidation,
    GameSettings, RecordSummary,
};
use crate::AppState;

#[tauri::command]
pub async fn get_resource_icon(
    state: State<'_, AppState>,
    resource_id: i64,
) -> Result<String, String> {
    crate::assets::get_resource_icon(&state, resource_id).await
}

#[derive(Debug, Deserialize)]
pub struct InsertMockGachaRequest {
    player_id: String,
    card_pool_type: String,
    resource_id: i64,
    pulls: i32,
    time: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMockGachaRequest {
    id: i64,
    card_pool_type: String,
    resource_id: i64,
    time: String,
}

#[derive(Debug, Serialize)]
pub struct DeleteMockResult {
    deleted_count: usize,
}

#[tauri::command]
pub async fn get_gacha_resources(state: State<'_, AppState>) -> Result<Vec<GachaResource>, String> {
    crate::assets::get_gacha_resources(&state).await
}

#[tauri::command]
pub async fn insert_mock_gacha(
    state: State<'_, AppState>,
    request: InsertMockGachaRequest,
) -> Result<Vec<GachaRecord>, String> {
    let target_time = parse_gacha_time(&request.time)?;
    if request.player_id.trim().is_empty() {
        return Err("请先选择玩家 UID".to_string());
    }
    if !(1..=80).contains(&request.pulls) {
        return Err("抽数必须在 1 到 80 之间".to_string());
    }

    let resources = crate::assets::get_gacha_resources(&state).await?;
    let target = resources
        .iter()
        .find(|resource| resource.resource_id == request.resource_id && resource.quality_level == 5)
        .cloned()
        .ok_or_else(|| "资源目录中不存在该五星物品".to_string())?;
    let three_stars: Vec<&GachaResource> = resources
        .iter()
        .filter(|resource| resource.quality_level == 3)
        .collect();
    let four_stars: Vec<&GachaResource> = resources
        .iter()
        .filter(|resource| resource.quality_level == 4)
        .collect();
    if three_stars.is_empty() || four_stars.is_empty() {
        return Err("资源目录缺少三星或四星物品，无法自动补足记录".to_string());
    }

    let plan = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.mock_insert_plan(
            request.player_id.trim(),
            &request.card_pool_type,
            &target_time.format("%Y-%m-%d %H:%M:%S").to_string(),
            request.pulls,
        )?
    };

    let mut rng = rand::thread_rng();
    let before_fillers = build_filler_resources(
        &three_stars,
        &four_stars,
        plan.before_filler_count(),
        plan.three_star_streak_before,
        0,
        &mut rng,
    )?;
    let after_fillers = build_filler_resources(
        &three_stars,
        &four_stars,
        plan.after_filler_count(),
        0,
        plan.three_star_prefix_after,
        &mut rng,
    )?;

    let filler_time = if before_fillers.is_empty() {
        target_time
    } else {
        target_time
            .checked_sub_signed(Duration::seconds(1))
            .ok_or_else(|| "记录时间过早，无法生成前一秒的补足记录".to_string())?
    }
    .format("%Y-%m-%d %H:%M:%S")
    .to_string();
    let mut after_filler_time = if after_fillers.is_empty() {
        target_time
    } else {
        target_time
            .checked_add_signed(Duration::seconds(1))
            .ok_or_else(|| "记录时间过晚，无法生成后一秒的补足记录".to_string())?
    };
    if let Some(next_five_star_time) = &plan.next_five_star_time {
        let next_five_star_time = parse_gacha_time(next_five_star_time)?;
        after_filler_time = after_filler_time.min(next_five_star_time);
    }
    let after_filler_time = after_filler_time.format("%Y-%m-%d %H:%M:%S").to_string();
    let db_request = MockInsertRequest {
        player_id: request.player_id.trim().to_string(),
        card_pool_type: request.card_pool_type,
        resource: target,
        pulls: request.pulls,
        time: target_time.format("%Y-%m-%d %H:%M:%S").to_string(),
    };
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.insert_mock_batch(
        &db_request,
        &before_fillers,
        &filler_time,
        &after_fillers,
        &after_filler_time,
    )
}

#[tauri::command]
pub async fn update_mock_gacha(
    state: State<'_, AppState>,
    request: UpdateMockGachaRequest,
) -> Result<(), String> {
    let target_time = parse_gacha_time(&request.time)?;
    let time = target_time.format("%Y-%m-%d %H:%M:%S").to_string();
    let resources = crate::assets::get_gacha_resources(&state).await?;
    let resource = resources
        .into_iter()
        .find(|resource| resource.resource_id == request.resource_id)
        .ok_or_else(|| "资源目录中不存在该物品".to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let (before_filler_count, after_filler_count) = db.mock_filler_segment_counts(request.id)?;
    let filler_time = if before_filler_count == 0 {
        target_time
    } else {
        target_time
            .checked_sub_signed(Duration::seconds(1))
            .ok_or_else(|| "记录时间过早，无法移动前置补足记录".to_string())?
    }
    .format("%Y-%m-%d %H:%M:%S")
    .to_string();
    let after_filler_time = if after_filler_count == 0 {
        target_time
    } else {
        target_time
            .checked_add_signed(Duration::seconds(1))
            .ok_or_else(|| "记录时间过晚，无法移动后置补足记录".to_string())?
    }
    .format("%Y-%m-%d %H:%M:%S")
    .to_string();
    db.update_mock_record(&MockUpdateRequest {
        id: request.id,
        card_pool_type: request.card_pool_type,
        resource,
        time,
        filler_time,
        after_filler_time,
    })
}

#[tauri::command]
pub fn delete_mock_gacha(state: State<'_, AppState>, id: i64) -> Result<DeleteMockResult, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    Ok(DeleteMockResult {
        deleted_count: db.delete_mock_record(id)?,
    })
}

fn parse_gacha_time(value: &str) -> Result<NaiveDateTime, String> {
    let value = value.trim();
    ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"]
        .iter()
        .find_map(|format| NaiveDateTime::parse_from_str(value, format).ok())
        .ok_or_else(|| "时间格式必须为 YYYY-MM-DD HH:mm:ss".to_string())
}

fn build_filler_resources<R: Rng + ?Sized>(
    three_stars: &[&GachaResource],
    four_stars: &[&GachaResource],
    count: usize,
    initial_three_star_streak: usize,
    following_three_star_prefix: usize,
    rng: &mut R,
) -> Result<Vec<GachaResource>, String> {
    // Six percent is the base four-star chance; boundary streaks can force a
    // four-star so the generated rows remain valid when joined to real records.
    let mut consecutive_three_stars = initial_three_star_streak;
    let mut fillers = Vec::with_capacity(count);
    for index in 0..count {
        let is_last = index + 1 == count;
        let use_four_star = consecutive_three_stars >= 9
            || (is_last && consecutive_three_stars + 1 + following_three_star_prefix > 9)
            || rng.gen_bool(0.06);
        let candidates = if use_four_star {
            four_stars
        } else {
            three_stars
        };
        fillers.push(
            (*candidates
                .choose(rng)
                .ok_or_else(|| "无法随机选择补足物品".to_string())?)
            .clone(),
        );
        consecutive_three_stars = if use_four_star {
            0
        } else {
            consecutive_three_stars + 1
        };
    }
    Ok(fillers)
}

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

    let completed_official_sync = errors.is_empty();
    merge_and_load_player(
        state,
        &params.player_id,
        &all_records,
        errors,
        completed_official_sync,
    )
}

fn merge_and_load_player(
    state: &State<'_, AppState>,
    player_id: &str,
    imported_records: &[GachaRecord],
    failed_pools: Vec<String>,
    completed_official_sync: bool,
) -> Result<GachaImportResult, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let stats = db.merge_records(imported_records)?;
    if completed_official_sync {
        db.update_import_info(player_id)?;
    }
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
    let content =
        std::fs::read_to_string(&file_path).map_err(|e| format!("读取文件失败: {}", e))?;

    let parsed: HashMap<String, serde_json::Value> =
        serde_json::from_str(&content).map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let player_id = parsed
        .get("uid")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "JSON 中未找到 uid 字段".to_string())?
        .to_string();

    let name_to_id = build_pool_name_to_id();
    let mut all_records: Vec<GachaRecord> = Vec::new();

    for (pool_type_key, cards_value) in &parsed {
        // 跳过 uid 字段
        if pool_type_key == "uid" {
            continue;
        }

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

    // JSON 可能是任意时间生成的离线快照，不能作为一次当前官方同步。
    merge_and_load_player(&state, &player_id, &all_records, Vec::new(), false)
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

/// 导出指定玩家的抽卡数据为 JSON 文件（格式与导入一致）
#[tauri::command]
pub fn export_gacha_json(
    state: State<'_, AppState>,
    player_id: String,
    file_path: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let records = db.get_all_records(Some(&player_id))?;

    if records.is_empty() {
        return Err("该玩家没有抽卡记录".to_string());
    }

    let json = serialize_gacha_records(&player_id, records)?;
    std::fs::write(&file_path, &json).map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(())
}

// Serializes official-compatible JSON independently from SQLite insertion order.
fn serialize_gacha_records(
    player_id: &str,
    mut records: Vec<GachaRecord>,
) -> Result<String, String> {
    // Keep JSON newest-first even when mock rows were inserted after older real rows.
    // Stable sorting preserves the database order for records sharing one timestamp.
    records.sort_by(|a, b| b.time.cmp(&a.time));

    let mut result = serde_json::Map::new();
    for (_, pool_type) in POOL_TYPES.iter() {
        let cards: Vec<serde_json::Value> = records
            .iter()
            .filter(|r| r.card_pool_type == *pool_type)
            .map(|r| {
                let resource_type_cn = if r.resource_type == "role" {
                    "角色"
                } else {
                    "武器"
                };
                json!({
                    "cardPoolType": pool_type_to_api_name(&r.card_pool_type),
                    "resourceId": r.resource_id,
                    "qualityLevel": r.quality_level,
                    "resourceType": resource_type_cn,
                    "name": r.name,
                    "count": r.count,
                    "time": r.time,
                })
            })
            .collect();
        if !cards.is_empty() {
            result.insert(pool_type.to_string(), serde_json::Value::Array(cards));
        }
    }
    result.insert(
        "uid".to_string(),
        serde_json::Value::String(player_id.to_string()),
    );

    serde_json::to_string_pretty(&serde_json::Value::Object(result))
        .map_err(|e| format!("序列化失败: {}", e))
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
pub fn save_game_dir(state: State<'_, AppState>, game_dir: String) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    #[test]
    fn filler_generation_never_has_ten_consecutive_three_stars() {
        let three = GachaResource {
            resource_id: 1,
            name: "三星".to_string(),
            quality_level: 3,
            resource_type: "weapon".to_string(),
        };
        let four = GachaResource {
            resource_id: 2,
            name: "四星".to_string(),
            quality_level: 4,
            resource_type: "role".to_string(),
        };
        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        let fillers = build_filler_resources(&[&three], &[&four], 79, 0, 0, &mut rng).unwrap();

        let mut consecutive_three_stars = 0;
        for resource in fillers {
            if resource.quality_level == 4 {
                consecutive_three_stars = 0;
            } else {
                consecutive_three_stars += 1;
                assert!(consecutive_three_stars <= 9);
            }
        }
    }

    #[test]
    fn filler_generation_respects_existing_three_star_streaks_on_both_sides() {
        let three = GachaResource {
            resource_id: 1,
            name: "三星".to_string(),
            quality_level: 3,
            resource_type: "weapon".to_string(),
        };
        let four = GachaResource {
            resource_id: 2,
            name: "四星".to_string(),
            quality_level: 4,
            resource_type: "role".to_string(),
        };
        let mut rng = rand::rngs::StdRng::seed_from_u64(7);

        let after_nine_existing =
            build_filler_resources(&[&three], &[&four], 1, 9, 0, &mut rng).unwrap();
        assert_eq!(after_nine_existing[0].quality_level, 4);

        let before_nine_following =
            build_filler_resources(&[&three], &[&four], 3, 0, 9, &mut rng).unwrap();
        assert_eq!(before_nine_following.last().unwrap().quality_level, 4);
    }

    #[test]
    fn export_serialization_orders_records_by_time_instead_of_sqlite_id() {
        let make_record = |id, time: &str, name: &str| GachaRecord {
            id: Some(id),
            player_id: "10001".to_string(),
            card_pool_type: "3".to_string(),
            card_pool_name: "角色常驻唤取".to_string(),
            card_pool_group: "常驻角色池".to_string(),
            resource_id: id,
            quality_level: 3,
            resource_type: "weapon".to_string(),
            name: name.to_string(),
            count: 1,
            time: time.to_string(),
            is_off_rate: false,
            is_mock: id == 99,
            mock_batch_id: None,
        };
        let json = serialize_gacha_records(
            "10001",
            vec![
                make_record(99, "2026-01-01 00:00:00", "后插入的旧 mock"),
                make_record(1, "2026-03-01 00:00:00", "较新的真实记录"),
                make_record(2, "2026-02-01 00:00:00", "中间记录"),
            ],
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        let names: Vec<_> = value["3"]
            .as_array()
            .unwrap()
            .iter()
            .map(|record| record["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["较新的真实记录", "中间记录", "后插入的旧 mock"]);
    }

    #[test]
    fn gacha_time_requires_seconds_and_valid_calendar_values() {
        assert!(parse_gacha_time("2026-01-01 00:00:00").is_ok());
        assert!(parse_gacha_time("2026-01-01T00:00:00").is_ok());
        assert!(parse_gacha_time("2026-01-01 00:00").is_err());
        assert!(parse_gacha_time("2026-02-30 00:00:00").is_err());
    }
}
