use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::gacha::fetcher::{
    self, get_display_pool_name, get_pool_group, hard_pity_for_pool, is_limited_char_pool,
    POOL_TYPES,
};

/// 常驻五星角色 resource_id（维里奈、卡卡罗、鉴心、凌阳、安可）
const STANDARD_FIVE_STAR_CHAR_IDS: &[i64] = &[1104, 1203, 1301, 1405, 1503];

/// 常驻五星武器 resource_id
const STANDARD_FIVE_STAR_WEAPON_IDS: &[i64] = &[
    21010015, 21020015, 21030015, 21040015, 21050015, 21010045, 21020045, 21030045, 21040045,
    21050045,
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
    pub last_imported_at: Option<String>,
    pub is_inferred: Option<bool>,
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

    pub fn is_five_star(&self) -> bool {
        self.quality_level == 5
    }
    pub fn is_four_star(&self) -> bool {
        self.quality_level == 4
    }
    pub fn is_three_star(&self) -> bool {
        self.quality_level == 3
    }
    pub fn is_role(&self) -> bool {
        self.resource_type == "role"
    }
    pub fn is_weapon(&self) -> bool {
        self.resource_type == "weapon"
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PityDistributionBin {
    pub start: i32,
    pub end: i32,
    pub label: String,
    pub count: usize,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CumulativePityPoint {
    pub pull: i32,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbabilityPoint {
    pub pull: i32,
    pub percentage: f64,
    pub sample_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolInsight {
    pub pool_type: String,
    pub pool_name: String,
    pub record_count: usize,
    pub five_star_count: usize,
    pub complete_interval_count: usize,
    pub invalid_interval_count: usize,
    pub current_pity: i32,
    pub average_pity: Option<f64>,
    pub median_pity: Option<f64>,
    pub best_pity: Option<i32>,
    pub worst_pity: Option<i32>,
    pub early_count: usize,
    pub early_rate: f64,
    pub reliability: String,
    pub distribution: Vec<PityDistributionBin>,
    pub cumulative: Vec<CumulativePityPoint>,
    pub probability_curve: Vec<ProbabilityPoint>,
    pub featured_count: usize,
    pub featured_cycle_count: usize,
    pub invalid_featured_cycle_count: usize,
    pub featured_average_pulls: Option<f64>,
    pub featured_median_pulls: Option<f64>,
    pub featured_best_pulls: Option<i32>,
    pub featured_worst_pulls: Option<i32>,
    pub featured_attempt_count: usize,
    pub featured_win_count: usize,
    pub featured_win_rate: Option<f64>,
    pub featured_guaranteed: bool,
    pub featured_distribution: Vec<PityDistributionBin>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GachaInsights {
    pub include_mock: bool,
    pub total_records: usize,
    pub pools: Vec<PoolInsight>,
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
        } else {
            0.0
        };
        let four_star_rate = if total_draws > 0 {
            (total_four_star as f64 / total_draws as f64) * 100.0
        } else {
            0.0
        };

        let limited_five_star = records
            .iter()
            .filter(|r| {
                r.is_five_star()
                    && !STANDARD_FIVE_STAR_CHAR_IDS.contains(&r.resource_id)
                    && !STANDARD_FIVE_STAR_WEAPON_IDS.contains(&r.resource_id)
            })
            .count() as i32;
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
        let limited_char_fives: Vec<&GachaRecord> = sorted
            .iter()
            .filter(|r| r.is_five_star() && is_limited_char_pool(&r.card_pool_type))
            .collect();
        let off_rate_count = limited_char_fives.iter().filter(|r| r.is_off_rate).count() as i32;
        let win_count = limited_char_fives.len() as i32 - off_rate_count;
        let win_rate_5050 = if !limited_char_fives.is_empty() {
            (win_count as f64 / limited_char_fives.len() as f64) * 100.0
        } else {
            0.0
        };

        // 首页和分析页统一使用完整周期：首个可见 UP/五星不参与平均，
        // 因为它之前的垫抽历史可能不在当前记录中。
        let mut up_role_cycles = Vec::new();
        let mut up_weapon_cycles = Vec::new();
        for (_, pool_type) in POOL_TYPES.iter() {
            let pool_records: Vec<&GachaRecord> = sorted
                .iter()
                .filter(|r| r.card_pool_type == *pool_type)
                .collect();
            if is_limited_char_pool(pool_type) {
                let mut pulls_since_up = 0i32;
                let mut seen_up = false;
                for record in pool_records {
                    pulls_since_up += 1;
                    if !record.is_five_star() {
                        continue;
                    }
                    if record.is_off_rate {
                        continue;
                    }
                    if seen_up {
                        up_role_cycles.push(pulls_since_up);
                    }
                    seen_up = true;
                    pulls_since_up = 0;
                }
            } else if get_pool_group(pool_type) == "UP武器池" {
                let mut pity = 0i32;
                let mut seen_five_star = false;
                for record in pool_records {
                    pity += 1;
                    if record.is_five_star() {
                        if seen_five_star {
                            up_weapon_cycles.push(pity);
                        }
                        seen_five_star = true;
                        pity = 0;
                    }
                }
            }
        }
        let avg_up_role_pulls = if up_role_cycles.is_empty() {
            0.0
        } else {
            up_role_cycles.iter().sum::<i32>() as f64 / up_role_cycles.len() as f64
        };
        let avg_up_weapon_pulls = if up_weapon_cycles.is_empty() {
            0.0
        } else {
            up_weapon_cycles.iter().sum::<i32>() as f64 / up_weapon_cycles.len() as f64
        };

        // 按卡池统计
        let mut pool_map: HashMap<String, PoolInfo> = HashMap::new();
        for (_pool_name, pool_type) in POOL_TYPES.iter() {
            pool_map.insert(
                pool_type.to_string(),
                PoolInfo {
                    pool_type: pool_type.to_string(),
                    pool_name: get_display_pool_name(pool_type).to_string(),
                    count: 0,
                    five_star_count: 0,
                    four_star_count: 0,
                    current_pity: 0,
                    avg_pity: 0.0,
                    max_pity: 0,
                    off_rate_count: 0,
                },
            );
        }

        let mut completed_pity_total = 0i32;
        let mut completed_interval_count = 0usize;
        for (_, pool_type_str) in POOL_TYPES.iter() {
            let pool_records: Vec<&GachaRecord> = sorted
                .iter()
                .filter(|r| r.card_pool_type == *pool_type_str)
                .collect();

            if pool_records.is_empty() {
                continue;
            }

            let entry = pool_map.get_mut(*pool_type_str).unwrap();
            entry.count = pool_records.len() as i32;
            entry.five_star_count = pool_records.iter().filter(|r| r.is_five_star()).count() as i32;
            entry.four_star_count = pool_records.iter().filter(|r| r.is_four_star()).count() as i32;
            entry.off_rate_count = pool_records.iter().filter(|r| r.is_off_rate).count() as i32;

            let mut pity = 0i32;
            let mut pool_pity_counts: Vec<i32> = Vec::new();
            let mut seen_five_star = false;
            for r in &pool_records {
                pity += 1;
                if r.is_five_star() {
                    if seen_five_star {
                        pool_pity_counts.push(pity);
                    }
                    seen_five_star = true;
                    pity = 0;
                }
            }
            completed_pity_total += pool_pity_counts.iter().sum::<i32>();
            completed_interval_count += pool_pity_counts.len();
            entry.current_pity = pity;
            entry.avg_pity = if !pool_pity_counts.is_empty() {
                pool_pity_counts.iter().sum::<i32>() as f64 / pool_pity_counts.len() as f64
            } else {
                0.0
            };
            entry.max_pity = pool_pity_counts.iter().copied().max().unwrap_or(0);
        }

        let mut pools: Vec<PoolInfo> = pool_map.into_values().collect();
        pools.sort_by_key(|p| {
            POOL_TYPES
                .iter()
                .position(|(_, t)| *t == p.pool_type)
                .unwrap_or(99)
        });

        let current_pity = pools.iter().map(|p| p.current_pity).max().unwrap_or(0);
        let max_pity = pools.iter().map(|p| p.max_pity).max().unwrap_or(0);
        let avg_five_star_pity = if completed_interval_count > 0 {
            completed_pity_total as f64 / completed_interval_count as f64
        } else {
            0.0
        };

        Self {
            total_draws,
            total_five_star,
            total_four_star,
            total_three_star,
            five_star_rate,
            four_star_rate,
            limited_five_star,
            standard_five_star,
            current_pity,
            max_pity,
            avg_five_star_pity,
            win_rate_5050,
            off_rate_count,
            avg_up_role_pulls,
            avg_up_weapon_pulls,
            pools,
        }
    }
}

impl GachaInsights {
    pub fn from_records(records: &[GachaRecord], include_mock: bool) -> Self {
        let filtered: Vec<GachaRecord> = records
            .iter()
            .filter(|record| include_mock || !record.is_mock)
            .cloned()
            .collect();
        let mut by_pool: HashMap<String, Vec<GachaRecord>> = HashMap::new();
        for record in &filtered {
            by_pool
                .entry(record.card_pool_type.clone())
                .or_default()
                .push(record.clone());
        }

        let mut pools: Vec<PoolInsight> = by_pool
            .into_iter()
            .map(|(pool_type, mut pool_records)| {
                pool_records.sort_by(|a, b| a.time.cmp(&b.time).then_with(|| b.id.cmp(&a.id)));

                let mut bounded_intervals = Vec::new();
                let tracks_featured = is_limited_char_pool(&pool_type);
                let mut featured_cycles = Vec::new();
                let mut pity = 0i32;
                let mut pulls_since_featured = 0i32;
                let mut seen_five_star = false;
                let mut seen_featured = false;
                let mut lost_since_featured = false;
                let mut five_star_count = 0usize;
                let mut featured_count = 0usize;
                let mut featured_attempt_count = 0usize;
                let mut featured_win_count = 0usize;
                for record in &pool_records {
                    pity += 1;
                    if tracks_featured {
                        pulls_since_featured += 1;
                    }
                    if record.is_five_star() {
                        five_star_count += 1;
                        // The first observed five-star may have pulls before the
                        // retained history. Only later intervals have both bounds.
                        if seen_five_star {
                            bounded_intervals.push(pity);
                        }
                        seen_five_star = true;
                        pity = 0;

                        if tracks_featured {
                            if record.is_off_rate {
                                if seen_featured && !lost_since_featured {
                                    featured_attempt_count += 1;
                                }
                                lost_since_featured = true;
                            } else {
                                featured_count += 1;
                                if seen_featured {
                                    featured_cycles.push(pulls_since_featured);
                                    if !lost_since_featured {
                                        featured_attempt_count += 1;
                                        featured_win_count += 1;
                                    }
                                }
                                seen_featured = true;
                                lost_since_featured = false;
                                pulls_since_featured = 0;
                            }
                        }
                    }
                }

                let invalid_interval_count = bounded_intervals
                    .iter()
                    .filter(|&&value| !(1..=hard_pity_for_pool(&pool_type)).contains(&value))
                    .count();
                let mut complete_intervals: Vec<i32> = bounded_intervals
                    .into_iter()
                    .filter(|value| (1..=hard_pity_for_pool(&pool_type)).contains(value))
                    .collect();
                complete_intervals.sort_unstable();
                let sample_count = complete_intervals.len();
                let average_pity = (sample_count > 0)
                    .then(|| complete_intervals.iter().sum::<i32>() as f64 / sample_count as f64);
                let median_pity = median(&complete_intervals);
                let best_pity = complete_intervals.first().copied();
                let worst_pity = complete_intervals.last().copied();
                let early_count = complete_intervals
                    .iter()
                    .filter(|&&value| value <= 40)
                    .count();
                let percentage = |count: usize| {
                    if sample_count == 0 {
                        0.0
                    } else {
                        count as f64 / sample_count as f64 * 100.0
                    }
                };
                let invalid_featured_cycle_count = featured_cycles
                    .iter()
                    .filter(|&&value| !(1..=160).contains(&value))
                    .count();
                let mut complete_featured_cycles: Vec<i32> = featured_cycles
                    .into_iter()
                    .filter(|value| (1..=160).contains(value))
                    .collect();
                complete_featured_cycles.sort_unstable();
                let featured_cycle_count = complete_featured_cycles.len();
                let featured_average_pulls = (featured_cycle_count > 0).then(|| {
                    complete_featured_cycles.iter().sum::<i32>() as f64
                        / featured_cycle_count as f64
                });
                let featured_win_rate = (featured_attempt_count > 0)
                    .then(|| featured_win_count as f64 / featured_attempt_count as f64 * 100.0);

                PoolInsight {
                    pool_name: get_display_pool_name(&pool_type).to_string(),
                    pool_type,
                    record_count: pool_records.len(),
                    five_star_count,
                    complete_interval_count: sample_count,
                    invalid_interval_count,
                    current_pity: pity,
                    average_pity,
                    median_pity,
                    best_pity,
                    worst_pity,
                    early_count,
                    early_rate: percentage(early_count),
                    reliability: reliability_label(sample_count).to_string(),
                    distribution: distribution_bins(&complete_intervals),
                    cumulative: cumulative_curve(&complete_intervals),
                    probability_curve: probability_curve(&complete_intervals),
                    featured_count,
                    featured_cycle_count,
                    invalid_featured_cycle_count,
                    featured_average_pulls,
                    featured_median_pulls: median(&complete_featured_cycles),
                    featured_best_pulls: complete_featured_cycles.first().copied(),
                    featured_worst_pulls: complete_featured_cycles.last().copied(),
                    featured_attempt_count,
                    featured_win_count,
                    featured_win_rate,
                    featured_guaranteed: tracks_featured && lost_since_featured,
                    featured_distribution: featured_distribution_bins(&complete_featured_cycles),
                }
            })
            .collect();
        pools.sort_by_key(|pool| pool.pool_type.parse::<i32>().unwrap_or(i32::MAX));

        Self {
            include_mock,
            total_records: filtered.len(),
            pools,
        }
    }
}

fn median(values: &[i32]) -> Option<f64> {
    let middle = values.len() / 2;
    match values.len() {
        0 => None,
        length if length % 2 == 1 => Some(values[middle] as f64),
        _ => Some((values[middle - 1] + values[middle]) as f64 / 2.0),
    }
}

fn reliability_label(sample_count: usize) -> &'static str {
    match sample_count {
        0..=9 => "insufficient",
        10..=29 => "low",
        30..=99 => "medium",
        _ => "high",
    }
}

fn distribution_bins(intervals: &[i32]) -> Vec<PityDistributionBin> {
    const RANGES: [(i32, i32); 8] = [
        (1, 10),
        (11, 20),
        (21, 30),
        (31, 40),
        (41, 50),
        (51, 60),
        (61, 70),
        (71, 80),
    ];
    RANGES
        .iter()
        .map(|&(start, end)| {
            let count = intervals
                .iter()
                .filter(|&&value| value >= start && value <= end)
                .count();
            PityDistributionBin {
                start,
                end,
                label: format!("{start}-{end}"),
                count,
                percentage: if intervals.is_empty() {
                    0.0
                } else {
                    count as f64 / intervals.len() as f64 * 100.0
                },
            }
        })
        .collect()
}

fn featured_distribution_bins(cycles: &[i32]) -> Vec<PityDistributionBin> {
    (0..16)
        .map(|index| {
            let start = index * 10 + 1;
            let end = (index + 1) * 10;
            let count = cycles
                .iter()
                .filter(|&&value| value >= start && value <= end)
                .count();
            PityDistributionBin {
                start,
                end,
                label: format!("{start}-{end}"),
                count,
                percentage: if cycles.is_empty() {
                    0.0
                } else {
                    count as f64 / cycles.len() as f64 * 100.0
                },
            }
        })
        .collect()
}

fn cumulative_curve(intervals: &[i32]) -> Vec<CumulativePityPoint> {
    (1..=80)
        .map(|pull| CumulativePityPoint {
            pull,
            percentage: if intervals.is_empty() {
                0.0
            } else {
                intervals.iter().filter(|&&value| value <= pull).count() as f64
                    / intervals.len() as f64
                    * 100.0
            },
        })
        .collect()
}

fn probability_curve(intervals: &[i32]) -> Vec<ProbabilityPoint> {
    (1..=80)
        .map(|pull| {
            let sample_size = intervals.iter().filter(|&&value| value >= pull).count();
            let hit_count = intervals.iter().filter(|&&value| value == pull).count();
            ProbabilityPoint {
                pull,
                percentage: if sample_size == 0 {
                    0.0
                } else {
                    hit_count as f64 / sample_size as f64 * 100.0
                },
                sample_size,
            }
        })
        .collect()
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
        let role_event_pool = stats
            .pools
            .iter()
            .find(|pool| pool.pool_type == "1")
            .unwrap();
        let weapon_event_pool = stats
            .pools
            .iter()
            .find(|pool| pool.pool_type == "2")
            .unwrap();

        assert_eq!(role_event_pool.max_pity, 0);
        assert_eq!(role_event_pool.current_pity, 0);
        assert_eq!(weapon_event_pool.current_pity, 1);
        assert_eq!(stats.max_pity, 0);
        assert_eq!(stats.avg_five_star_pity, 0.0);
    }

    #[test]
    fn stats_use_only_intervals_bounded_by_two_five_stars() {
        let records = vec![
            record(1, "1", 3, "2026-01-01 00:00:01"),
            record(2, "1", 5, "2026-01-01 00:00:02"),
            record(3, "1", 3, "2026-01-01 00:00:03"),
            record(4, "1", 3, "2026-01-01 00:00:04"),
            record(5, "1", 5, "2026-01-01 00:00:05"),
        ];

        let stats = GachaStats::from_records(&records);
        let pool = stats
            .pools
            .iter()
            .find(|pool| pool.pool_type == "1")
            .unwrap();

        assert_eq!(pool.avg_pity, 3.0);
        assert_eq!(pool.max_pity, 3);
        assert_eq!(stats.avg_five_star_pity, 3.0);
    }

    #[test]
    fn aggregate_average_is_weighted_by_confirmed_intervals() {
        let records = vec![
            record(1, "1", 5, "2026-01-01 00:00:01"),
            record(2, "1", 3, "2026-01-01 00:00:02"),
            record(3, "1", 5, "2026-01-01 00:00:03"),
            record(4, "1", 3, "2026-01-01 00:00:04"),
            record(5, "1", 3, "2026-01-01 00:00:05"),
            record(6, "1", 5, "2026-01-01 00:00:06"),
            record(7, "2", 5, "2026-01-01 00:00:07"),
            record(8, "2", 3, "2026-01-01 00:00:08"),
            record(9, "2", 3, "2026-01-01 00:00:09"),
            record(10, "2", 3, "2026-01-01 00:00:10"),
            record(11, "2", 3, "2026-01-01 00:00:11"),
            record(12, "2", 5, "2026-01-01 00:00:12"),
        ];

        let stats = GachaStats::from_records(&records);

        assert_eq!(stats.avg_five_star_pity, 10.0 / 3.0);
    }

    #[test]
    fn insights_use_only_intervals_bounded_by_two_five_stars() {
        let records = vec![
            record(1, "1", 3, "2026-01-01 00:00:01"),
            record(2, "1", 5, "2026-01-01 00:00:02"),
            record(3, "1", 3, "2026-01-01 00:00:03"),
            record(4, "1", 3, "2026-01-01 00:00:04"),
            record(5, "1", 5, "2026-01-01 00:00:05"),
            record(6, "1", 3, "2026-01-01 00:00:06"),
        ];

        let insights = GachaInsights::from_records(&records, false);
        let pool = &insights.pools[0];

        assert_eq!(pool.five_star_count, 2);
        assert_eq!(pool.complete_interval_count, 1);
        assert_eq!(pool.average_pity, Some(3.0));
        assert_eq!(pool.current_pity, 1);
        assert_eq!(pool.distribution[0].count, 1);
        assert_eq!(pool.cumulative[1].percentage, 0.0);
        assert_eq!(pool.cumulative[2].percentage, 100.0);
        assert_eq!(pool.probability_curve[1].sample_size, 1);
        assert_eq!(pool.probability_curve[2].percentage, 100.0);
    }

    #[test]
    fn insights_exclude_mock_records_unless_requested() {
        let mut mock = record(3, "1", 5, "2026-01-01 00:00:03");
        mock.is_mock = true;
        let records = vec![
            record(1, "1", 5, "2026-01-01 00:00:01"),
            record(2, "1", 3, "2026-01-01 00:00:02"),
            mock,
        ];

        let official = GachaInsights::from_records(&records, false);
        let with_mock = GachaInsights::from_records(&records, true);

        assert_eq!(official.pools[0].complete_interval_count, 0);
        assert_eq!(with_mock.pools[0].complete_interval_count, 1);
        assert_eq!(with_mock.pools[0].average_pity, Some(2.0));
    }

    #[test]
    fn insights_reject_intervals_beyond_the_hard_pity_range() {
        let mut records = vec![record(1, "1", 5, "2026-01-01 00:00:00")];
        for id in 2..=82 {
            records.push(record(
                id,
                "1",
                if id == 82 { 5 } else { 3 },
                &format!("2026-01-01 00:{:02}:{:02}", id / 60, id % 60),
            ));
        }

        let insights = GachaInsights::from_records(&records, false);
        let pool = &insights.pools[0];

        assert_eq!(pool.complete_interval_count, 0);
        assert_eq!(pool.invalid_interval_count, 1);
        assert!(pool.distribution.iter().all(|bin| bin.count == 0));
    }

    #[test]
    fn featured_cycles_include_the_off_rate_five_star_and_reset_at_featured() {
        let mut records = vec![record(1, "1", 5, "2026-01-01 00:00:001")];
        for id in 2..=11 {
            records.push(record(
                id,
                "1",
                if id == 11 { 5 } else { 3 },
                &format!("2026-01-01 00:00:{id:03}"),
            ));
        }
        for id in 12..=31 {
            let mut next = record(
                id,
                "1",
                if id == 31 { 5 } else { 3 },
                &format!("2026-01-01 00:00:{id:03}"),
            );
            next.is_off_rate = id == 31;
            records.push(next);
        }
        for id in 32..=71 {
            records.push(record(
                id,
                "1",
                if id == 71 { 5 } else { 3 },
                &format!("2026-01-01 00:00:{id:03}"),
            ));
        }

        let insights = GachaInsights::from_records(&records, false);
        let pool = &insights.pools[0];

        assert_eq!(pool.featured_count, 3);
        assert_eq!(pool.featured_cycle_count, 2);
        assert_eq!(pool.featured_average_pulls, Some(35.0));
        assert_eq!(pool.featured_median_pulls, Some(35.0));
        assert_eq!(pool.featured_best_pulls, Some(10));
        assert_eq!(pool.featured_worst_pulls, Some(60));
        assert_eq!(pool.featured_attempt_count, 2);
        assert_eq!(pool.featured_win_count, 1);
        assert_eq!(pool.featured_win_rate, Some(50.0));
        assert!(!pool.featured_guaranteed);
        assert_eq!(pool.featured_distribution[0].count, 1);
        assert_eq!(pool.featured_distribution[5].count, 1);
    }

    #[test]
    fn insights_expose_the_active_featured_guarantee() {
        let mut off_rate = record(1, "1", 5, "2026-01-01 00:00:001");
        off_rate.is_off_rate = true;
        let guaranteed = GachaInsights::from_records(&[off_rate], false);
        assert!(guaranteed.pools[0].featured_guaranteed);

        let featured =
            GachaInsights::from_records(&[record(1, "1", 5, "2026-01-01 00:00:001")], false);
        assert!(!featured.pools[0].featured_guaranteed);

        let mut standard_off_rate = record(1, "3", 5, "2026-01-01 00:00:001");
        standard_off_rate.is_off_rate = true;
        let standard = GachaInsights::from_records(&[standard_off_rate], false);
        assert!(!standard.pools[0].featured_guaranteed);
    }
}
