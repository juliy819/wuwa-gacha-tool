use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::gacha::fetcher::{self, get_display_pool_name, get_pool_group, is_limited_char_pool, POOL_TYPES};

/// 常驻五星角色 resource_id（维里奈、卡卡罗、鉴心、凌阳、安可）
const STANDARD_FIVE_STAR_CHAR_IDS: &[i64] = &[1104, 1203, 1301, 1405, 1503];

/// 常驻五星武器 resource_id
const STANDARD_FIVE_STAR_WEAPON_IDS: &[i64] = &[
    21010015, 21020015, 21030015, 21040015, 21050015,
    21010045, 21020045, 21030045, 21040045, 21050045,
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GachaRecord {
    pub id: Option<i64>,
    pub player_id: String,
    /// 数字 pool type ID（"1", "2", ...）
    pub card_pool_type: String,
    /// 中文卡池名
    pub card_pool_name: String,
    /// 卡池分组（UP角色池、UP武器池等）
    pub card_pool_group: String,
    pub resource_id: i64,
    pub quality_level: i32,
    /// "role" / "weapon"
    pub resource_type: String,
    pub name: String,
    pub count: i32,
    pub time: String,
    pub is_off_rate: bool,
    #[serde(default)]
    pub is_mock: bool,
    #[serde(default)]
    pub mock_batch_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GachaImportResult {
    pub player_id: String,
    pub records: Vec<GachaRecord>,
    pub imported_count: usize,
    pub added_count: usize,
    pub duplicate_count: usize,
    pub total_count: usize,
    pub failed_pools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordSummary {
    pub player_id: String,
    pub record_count: usize,
    pub earliest_time: String,
    pub latest_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClearRecordsResult {
    pub deleted_count: usize,
    pub backup_path: Option<String>,
}

impl GachaRecord {
    pub fn from_api(
        info: &fetcher::ApiCardInfo,
        player_id: &str,
        pool_name: &str,
        pool_type: &str,
    ) -> Self {
        // API 返回的 resourceType 是中文 "角色" / "武器"
        let resource_type = match info.resource_type.as_str() {
            "角色" => "role",
            "武器" => "weapon",
            _ if info.resource_id < 100000 => "role",
            _ => "weapon",
        };

        let group = get_pool_group(pool_type);
        let is_char = resource_type == "role";

        // 歪的判断：限定角色池中抽到常驻五星角色
        let is_off_rate = info.quality_level == 5
            && is_char
            && is_limited_char_pool(pool_type)
            && STANDARD_FIVE_STAR_CHAR_IDS.contains(&info.resource_id);

        Self {
            id: None,
            player_id: player_id.to_string(),
            card_pool_type: pool_type.to_string(),
            card_pool_name: pool_name.to_string(),
            card_pool_group: group.to_string(),
            resource_id: info.resource_id,
            quality_level: info.quality_level,
            resource_type: resource_type.to_string(),
            name: info.name.clone(),
            count: info.count,
            time: info.time.clone(),
            is_off_rate,
            is_mock: false,
            mock_batch_id: None,
        }
    }

    pub fn quality_label(&self) -> &str {
        match self.quality_level {
            5 => "五星",
            4 => "四星",
            3 => "三星",
            _ => "未知",
        }
    }

    pub fn is_five_star(&self) -> bool { self.quality_level == 5 }
    pub fn is_four_star(&self) -> bool { self.quality_level == 4 }
    pub fn is_three_star(&self) -> bool { self.quality_level == 3 }
    pub fn is_role(&self) -> bool { self.resource_type == "role" }
    pub fn is_weapon(&self) -> bool { self.resource_type == "weapon" }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolInfo {
    pub pool_type: String,
    pub pool_name: String,
    pub count: i32,
    pub five_star_count: i32,
    pub four_star_count: i32,
    pub current_pity: i32,
    pub avg_pity: f64,
    pub max_pity: i32,
    pub off_rate_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GachaStats {
    pub total_draws: i32,
    pub total_five_star: i32,
    pub total_four_star: i32,
    pub total_three_star: i32,
    pub five_star_rate: f64,
    pub four_star_rate: f64,
    pub limited_five_star: i32,
    pub standard_five_star: i32,
    /// Legacy aggregate: the largest current pity among independent pools.
    pub current_pity: i32,
    /// Largest completed five-star interval within a single pool.
    pub max_pity: i32,
    /// Average completed five-star interval, calculated within each pool.
    pub avg_five_star_pity: f64,
    pub win_rate_5050: f64,
    pub off_rate_count: i32,
    pub avg_up_role_pulls: f64,
    pub avg_up_weapon_pulls: f64,
    pub pools: Vec<PoolInfo>,
}

impl GachaStats {
    pub fn from_records(records: &[GachaRecord]) -> Self {
        if records.is_empty() {
            return Self::default();
        }

        let total_draws = records.len() as i32;
        let total_five_star = records.iter().filter(|r| r.is_five_star()).count() as i32;
        let total_four_star = records.iter().filter(|r| r.is_four_star()).count() as i32;
        let total_three_star = records.iter().filter(|r| r.is_three_star()).count() as i32;

        let five_star_rate = if total_draws > 0 {
            (total_five_star as f64 / total_draws as f64) * 100.0
        } else { 0.0 };
        let four_star_rate = if total_draws > 0 {
            (total_four_star as f64 / total_draws as f64) * 100.0
        } else { 0.0 };

        let limited_five_star = records.iter().filter(|r| {
            r.is_five_star()
                && !STANDARD_FIVE_STAR_CHAR_IDS.contains(&r.resource_id)
                && !STANDARD_FIVE_STAR_WEAPON_IDS.contains(&r.resource_id)
        }).count() as i32;
        let standard_five_star = total_five_star - limited_five_star;

        // Sort once, then calculate pity independently for every pool. Pity never
        // carries between pool types, even when their records interleave in time.
        let mut sorted = records.to_vec();
        sorted.sort_by(|a, b| {
            a.time
                .cmp(&b.time)
                // API records are newest-first. Reversing IDs restores the draw
                // order for ten-pulls whose entries share one timestamp.
                .then_with(|| b.id.cmp(&a.id))
        });

        // 50/50 统计
        let limited_char_fives: Vec<&GachaRecord> = sorted.iter()
            .filter(|r| r.is_five_star() && is_limited_char_pool(&r.card_pool_type))
            .collect();
        let off_rate_count = limited_char_fives.iter().filter(|r| r.is_off_rate).count() as i32;
        let win_count = limited_char_fives.len() as i32 - off_rate_count;
        let win_rate_5050 = if !limited_char_fives.is_empty() {
            (win_count as f64 / limited_char_fives.len() as f64) * 100.0
        } else { 0.0 };

        // 平均每 UP 角色抽数
        let limited_char_pulls: i32 = sorted.iter()
            .filter(|r| is_limited_char_pool(&r.card_pool_type))
            .count() as i32;
        let avg_up_role_pulls = if win_count > 0 {
            limited_char_pulls as f64 / win_count as f64
        } else { 0.0 };

        // 平均每 UP 武器抽数
        let limited_weapon_pulls: i32 = sorted.iter()
            .filter(|r| get_pool_group(&r.card_pool_type) == "UP武器池")
            .count() as i32;
        let limited_weapon_fives = sorted.iter()
            .filter(|r| r.is_five_star() && get_pool_group(&r.card_pool_type) == "UP武器池")
            .count() as i32;
        let avg_up_weapon_pulls = if limited_weapon_fives > 0 {
            limited_weapon_pulls as f64 / limited_weapon_fives as f64
        } else { 0.0 };

        // 按卡池统计
        let mut pool_map: HashMap<String, PoolInfo> = HashMap::new();
        for (_pool_name, pool_type) in POOL_TYPES.iter() {
            pool_map.insert(pool_type.to_string(), PoolInfo {
                pool_type: pool_type.to_string(),
                pool_name: get_display_pool_name(pool_type).to_string(),
                count: 0, five_star_count: 0, four_star_count: 0,
                current_pity: 0, avg_pity: 0.0, max_pity: 0, off_rate_count: 0,
            });
        }

        for (_, pool_type_str) in POOL_TYPES.iter() {
            let pool_records: Vec<&GachaRecord> = sorted.iter()
                .filter(|r| r.card_pool_type == *pool_type_str)
                .collect();

            if pool_records.is_empty() { continue; }

            let entry = pool_map.get_mut(*pool_type_str).unwrap();
            entry.count = pool_records.len() as i32;
            entry.five_star_count = pool_records.iter().filter(|r| r.is_five_star()).count() as i32;
            entry.four_star_count = pool_records.iter().filter(|r| r.is_four_star()).count() as i32;
            entry.off_rate_count = pool_records.iter().filter(|r| r.is_off_rate).count() as i32;

            let mut pity = 0i32;
            let mut pool_pity_counts: Vec<i32> = Vec::new();
            for r in &pool_records {
                pity += 1;
                if r.is_five_star() {
                    pool_pity_counts.push(pity);
                    pity = 0;
                }
            }
            entry.current_pity = pity;
            entry.avg_pity = if !pool_pity_counts.is_empty() {
                pool_pity_counts.iter().sum::<i32>() as f64 / pool_pity_counts.len() as f64
            } else { 0.0 };
            entry.max_pity = pool_pity_counts.iter().copied().max().unwrap_or(0);
        }

        let mut pools: Vec<PoolInfo> = pool_map.into_values().collect();
        pools.sort_by_key(|p| {
            POOL_TYPES.iter().position(|(_, t)| *t == p.pool_type).unwrap_or(99)
        });

        let current_pity = pools.iter().map(|p| p.current_pity).max().unwrap_or(0);
        let max_pity = pools.iter().map(|p| p.max_pity).max().unwrap_or(0);
        let completed_five_star_count: i32 = pools.iter().map(|p| p.five_star_count).sum();
        let completed_pity_total: f64 = pools
            .iter()
            .map(|p| p.avg_pity * p.five_star_count as f64)
            .sum();
        let avg_five_star_pity = if completed_five_star_count > 0 {
            completed_pity_total / completed_five_star_count as f64
        } else {
            0.0
        };

        Self {
            total_draws, total_five_star, total_four_star, total_three_star,
            five_star_rate, four_star_rate,
            limited_five_star, standard_five_star,
            current_pity, max_pity, avg_five_star_pity,
            win_rate_5050, off_rate_count,
            avg_up_role_pulls, avg_up_weapon_pulls,
            pools,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GameSettings {
    pub game_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameDirValidation {
    pub valid: bool,
    pub log_path: String,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: i64, pool_type: &str, quality_level: i32, time: &str) -> GachaRecord {
        GachaRecord {
            id: Some(id),
            player_id: "10001".to_string(),
            card_pool_type: pool_type.to_string(),
            card_pool_name: get_display_pool_name(pool_type).to_string(),
            card_pool_group: get_pool_group(pool_type).to_string(),
            resource_id: id,
            quality_level,
            resource_type: "role".to_string(),
            name: format!("record-{id}"),
            count: 1,
            time: time.to_string(),
            is_off_rate: false,
            is_mock: false,
            mock_batch_id: None,
        }
    }

    #[test]
    fn pity_is_independent_per_pool_and_restores_same_timestamp_order() {
        // Records arrive newest-first. Within the same timestamp, the larger ID
        // was inserted later and is the older draw in the original API order.
        let records = vec![
            record(1, "1", 5, "2026-01-02 12:00:00"),
            record(2, "1", 3, "2026-01-02 12:00:00"),
            record(3, "2", 3, "2026-01-01 12:00:00"),
        ];

        let stats = GachaStats::from_records(&records);
        let role_event_pool = stats.pools.iter().find(|pool| pool.pool_type == "1").unwrap();
        let weapon_event_pool = stats.pools.iter().find(|pool| pool.pool_type == "2").unwrap();

        assert_eq!(role_event_pool.max_pity, 2);
        assert_eq!(role_event_pool.current_pity, 0);
        assert_eq!(weapon_event_pool.current_pity, 1);
        assert_eq!(stats.max_pity, 2);
        assert_eq!(stats.avg_five_star_pity, 2.0);
    }
}
