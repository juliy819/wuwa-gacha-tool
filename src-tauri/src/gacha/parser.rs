use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

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
pub struct CharacterPullInsight {
    pub pool_type: String,
    pub pool_name: String,
    pub resource_id: i64,
    pub name: String,
    pub copy_count: usize,
    pub complete_cycle_count: usize,
    pub total_pulls: i32,
    pub average_pulls: Option<f64>,
    pub is_lower_bound: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcquisitionRecordInsight {
    pub id: Option<i64>,
    pub resource_id: i64,
    pub name: String,
    pub time: String,
    pub pity: i32,
    pub is_lower_bound: bool,
    pub is_off_rate: bool,
    pub is_target: bool,
    pub is_mock: bool,
    pub acquisition_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceAcquisitionInsight {
    pub pool_type: String,
    pub pool_name: String,
    pub resource_id: i64,
    pub name: String,
    pub resource_type: String,
    pub target_count: usize,
    pub off_rate_count: usize,
    pub total_five_star_count: usize,
    pub total_pulls: i32,
    pub average_pulls: Option<f64>,
    pub is_lower_bound: bool,
    pub has_off_rate: bool,
    pub records: Vec<AcquisitionRecordInsight>,
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
    #[cfg(test)]
    pub fn from_records(records: &[GachaRecord]) -> Self {
        Self::from_records_with_boundaries(records, &HashSet::new())
    }

    pub fn from_records_with_boundaries(
        records: &[GachaRecord],
        confirmed_boundaries: &HashSet<String>,
    ) -> Self {
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

        // 首页和分析页统一使用完整周期：未确认历史起点时，首个可见
        // UP/五星不参与平均；用户确认后，首段按现有记录完整计入。
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
                    if seen_up || confirmed_boundaries.contains(*pool_type) {
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
                        if seen_five_star || confirmed_boundaries.contains(*pool_type) {
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
                    if seen_five_star || confirmed_boundaries.contains(*pool_type_str) {
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
    #[cfg(test)]
    pub fn from_records(records: &[GachaRecord], include_mock: bool) -> Self {
        Self::from_records_with_boundaries(records, include_mock, &HashSet::new())
    }

    pub fn from_records_with_boundaries(
        records: &[GachaRecord],
        include_mock: bool,
        confirmed_boundaries: &HashSet<String>,
    ) -> Self {
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
                        if seen_five_star || confirmed_boundaries.contains(&pool_type) {
                            bounded_intervals.push(pity);
                        }
                        seen_five_star = true;
                        pity = 0;

                        if tracks_featured {
                            if record.is_off_rate {
                                if (seen_featured || confirmed_boundaries.contains(&pool_type))
                                    && !lost_since_featured
                                {
                                    featured_attempt_count += 1;
                                }
                                lost_since_featured = true;
                            } else {
                                featured_count += 1;
                                if seen_featured || confirmed_boundaries.contains(&pool_type) {
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

#[derive(Default)]
struct CharacterPullAccumulator {
    pool_type: String,
    pool_name: String,
    resource_id: i64,
    name: String,
    copy_count: usize,
    complete_cycle_count: usize,
    total_pulls: i32,
    is_lower_bound: bool,
}

#[cfg(test)]
pub fn character_pull_insights(
    records: &[GachaRecord],
    include_mock: bool,
) -> Vec<CharacterPullInsight> {
    character_pull_insights_with_boundaries(records, include_mock, &HashSet::new())
}

pub fn character_pull_insights_with_boundaries(
    records: &[GachaRecord],
    include_mock: bool,
    confirmed_boundaries: &HashSet<String>,
) -> Vec<CharacterPullInsight> {
    let mut by_pool: HashMap<String, Vec<GachaRecord>> = HashMap::new();
    for record in records
        .iter()
        .filter(|record| include_mock || !record.is_mock)
    {
        // Every draw in a limited role pool contributes to pity. Three- and
        // four-star weapon results must not be filtered out merely because the
        // eventual five-star target is a character.
        if is_limited_char_pool(&record.card_pool_type) {
            by_pool
                .entry(record.card_pool_type.clone())
                .or_default()
                .push(record.clone());
        }
    }

    let mut result = Vec::new();
    for (pool_type, mut pool_records) in by_pool {
        pool_records.sort_by(|a, b| a.time.cmp(&b.time).then_with(|| b.id.cmp(&a.id)));
        let mut pity = 0i32;
        let mut seen_five_star = false;
        let mut pending_off_rate_pulls = 0i32;
        let mut pending_off_rate_is_lower_bound = false;
        let mut accumulators: HashMap<i64, CharacterPullAccumulator> = HashMap::new();

        for record in pool_records.iter() {
            pity += 1;
            if !record.is_five_star() {
                continue;
            }
            let current_is_lower_bound =
                !seen_five_star && !confirmed_boundaries.contains(&pool_type);
            seen_five_star = true;
            // Imported historical rows do not always carry a reliable is_off_rate
            // flag. The standard-character resource IDs are the authoritative
            // indicator for a role-pool off-rate result.
            let is_off_rate = STANDARD_FIVE_STAR_CHAR_IDS.contains(&record.resource_id);
            if is_off_rate {
                pending_off_rate_pulls += pity;
                pending_off_rate_is_lower_bound |= current_is_lower_bound;
                pity = 0;
                continue;
            }
            let entry = accumulators.entry(record.resource_id).or_insert_with(|| {
                CharacterPullAccumulator {
                    pool_type: pool_type.clone(),
                    pool_name: get_display_pool_name(&pool_type).to_string(),
                    resource_id: record.resource_id,
                    name: record.name.clone(),
                    ..Default::default()
                }
            });
            let mut acquisition_pulls = pity;
            let mut acquisition_is_lower_bound = current_is_lower_bound;
            acquisition_pulls += pending_off_rate_pulls;
            acquisition_is_lower_bound |= pending_off_rate_is_lower_bound;
            entry.copy_count += 1;
            entry.total_pulls += acquisition_pulls;
            if acquisition_is_lower_bound {
                entry.is_lower_bound = true;
            } else {
                entry.complete_cycle_count += 1;
            }
            pending_off_rate_pulls = 0;
            pending_off_rate_is_lower_bound = false;
            pity = 0;
        }

        result.extend(
            accumulators
                .into_values()
                .map(|entry| CharacterPullInsight {
                    pool_type: entry.pool_type,
                    pool_name: entry.pool_name,
                    resource_id: entry.resource_id,
                    name: entry.name,
                    copy_count: entry.copy_count,
                    complete_cycle_count: entry.complete_cycle_count,
                    total_pulls: entry.total_pulls,
                    average_pulls: (entry.copy_count > 0)
                        .then(|| entry.total_pulls as f64 / entry.copy_count as f64),
                    is_lower_bound: entry.is_lower_bound,
                }),
        );
    }

    result.sort_by(|a, b| {
        a.pool_type
            .cmp(&b.pool_type)
            .then_with(|| b.total_pulls.cmp(&a.total_pulls))
    });
    result
}

/// 返回所有池型可点击的五星资源获取档案。活动角色池会把前置歪常驻并入下一只 UP，
/// 其它池型按每个五星独立成段，不在前端重复推导。
#[cfg(test)]
pub fn resource_acquisition_insights(
    records: &[GachaRecord],
    include_mock: bool,
) -> Vec<ResourceAcquisitionInsight> {
    resource_acquisition_insights_with_boundaries(records, include_mock, &HashSet::new())
}

pub fn resource_acquisition_insights_with_boundaries(
    records: &[GachaRecord],
    include_mock: bool,
    confirmed_boundaries: &HashSet<String>,
) -> Vec<ResourceAcquisitionInsight> {
    let mut by_pool: HashMap<String, Vec<GachaRecord>> = HashMap::new();
    for record in records.iter().filter(|r| include_mock || !r.is_mock) {
        by_pool
            .entry(record.card_pool_type.clone())
            .or_default()
            .push(record.clone());
    }
    let mut result = Vec::new();
    for (pool_type, mut pool_records) in by_pool {
        pool_records.sort_by(|a, b| a.time.cmp(&b.time).then_with(|| b.id.cmp(&a.id)));
        let limited_char = is_limited_char_pool(&pool_type);
        let mut pity = 0;
        let mut seen_five = false;
        let mut pending: Vec<AcquisitionRecordInsight> = Vec::new();
        let mut entries: HashMap<i64, ResourceAcquisitionInsight> = HashMap::new();
        for record in pool_records {
            pity += 1;
            if !record.is_five_star() {
                continue;
            }
            let lower = !seen_five && !confirmed_boundaries.contains(&pool_type);
            seen_five = true;
            let is_off = limited_char
                && record.resource_type == "role"
                && STANDARD_FIVE_STAR_CHAR_IDS.contains(&record.resource_id);
            let mut item = AcquisitionRecordInsight {
                id: record.id,
                resource_id: record.resource_id,
                name: record.name.clone(),
                time: record.time.clone(),
                pity,
                is_lower_bound: lower,
                is_off_rate: is_off,
                is_target: !is_off,
                is_mock: record.is_mock,
                acquisition_index: 0,
            };
            if limited_char && is_off {
                pending.push(item);
                pity = 0;
                continue;
            }
            let entry =
                entries
                    .entry(record.resource_id)
                    .or_insert_with(|| ResourceAcquisitionInsight {
                        pool_type: pool_type.clone(),
                        pool_name: get_display_pool_name(&pool_type).to_string(),
                        resource_id: record.resource_id,
                        name: record.name.clone(),
                        resource_type: record.resource_type.clone(),
                        target_count: 0,
                        off_rate_count: 0,
                        total_five_star_count: 0,
                        total_pulls: 0,
                        average_pulls: None,
                        is_lower_bound: false,
                        has_off_rate: limited_char,
                        records: Vec::new(),
                    });
            let acquisition_index = entry.target_count + 1;
            if limited_char && !pending.is_empty() {
                pending
                    .iter_mut()
                    .for_each(|pending_item| pending_item.acquisition_index = acquisition_index);
                entry.off_rate_count += pending.len();
                entry.total_five_star_count += pending.len();
                entry.total_pulls += pending.iter().map(|r| r.pity).sum::<i32>();
                entry.is_lower_bound |= pending.iter().any(|r| r.is_lower_bound);
                entry.records.append(&mut pending);
            }
            entry.target_count += 1;
            entry.total_five_star_count += 1;
            entry.total_pulls += pity;
            entry.is_lower_bound |= lower;
            item.acquisition_index = acquisition_index;
            entry.records.push(item);
            entry.average_pulls = Some(entry.total_pulls as f64 / entry.target_count as f64);
            pity = 0;
        }
        result.extend(entries.into_values().filter(|e| !e.records.is_empty()));
    }
    result.sort_by(|a, b| {
        a.pool_type
            .cmp(&b.pool_type)
            .then_with(|| a.name.cmp(&b.name))
    });
    result
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
    fn character_cost_includes_pre_first_off_rate_but_ignores_trailing_off_rate() {
        let mut records = Vec::new();
        let mut first_off = record(1, "1", 5, "2026-01-01 00:00:01");
        first_off.resource_id = 1104;
        first_off.name = "维里奈".to_string();
        first_off.is_off_rate = true;
        records.push(first_off);
        for id in 2..=11 {
            let mut next = record(
                id,
                "1",
                if id == 11 { 5 } else { 3 },
                &format!("2026-01-01 00:00:{id:02}"),
            );
            if id == 11 {
                next.resource_id = 2001;
                next.name = "赞妮".to_string();
            }
            records.push(next);
        }
        for id in 12..=31 {
            let mut next = record(
                id,
                "1",
                if id == 31 { 5 } else { 3 },
                &format!("2026-01-01 00:00:{id:02}"),
            );
            if id == 31 {
                next.resource_id = 2001;
                next.name = "赞妮".to_string();
            }
            records.push(next);
        }
        let mut trailing_off = record(32, "1", 5, "2026-01-01 00:00:32");
        trailing_off.resource_id = 1203;
        trailing_off.name = "卡卡罗".to_string();
        trailing_off.is_off_rate = true;
        records.push(trailing_off);

        let insights = character_pull_insights(&records, false);
        let zanni = insights
            .iter()
            .find(|item| item.resource_id == 2001)
            .unwrap();
        assert_eq!(zanni.copy_count, 2);
        assert_eq!(zanni.complete_cycle_count, 1);
        assert_eq!(zanni.total_pulls, 31);
        assert_eq!(zanni.average_pulls, Some(15.5));
        assert!(zanni.is_lower_bound);
        assert!(insights
            .iter()
            .all(|item| item.resource_id != 1104 && item.resource_id != 1203));
    }

    #[test]
    fn character_cost_adds_the_entire_off_rate_segment_to_the_next_featured_copy() {
        let mut records = vec![record(1, "1", 5, "2026-01-01 00:00:01")];
        records[0].resource_id = 3001;
        records[0].name = "前一个UP".to_string();
        for id in 2..=5 {
            let mut next = record(
                id,
                "1",
                if id == 5 { 5 } else { 3 },
                &format!("2026-01-01 00:00:{id:02}"),
            );
            if id == 5 {
                next.resource_id = 1104;
                next.name = "维里奈".to_string();
                next.is_off_rate = true;
            }
            records.push(next);
        }
        for id in 6..=15 {
            let mut next = record(
                id,
                "1",
                if id == 15 { 5 } else { 3 },
                &format!("2026-01-01 00:00:{id:02}"),
            );
            if id == 15 {
                next.resource_id = 2001;
                next.name = "赞妮".to_string();
            }
            records.push(next);
        }

        let insights = character_pull_insights(&records, false);
        let zanni = insights
            .iter()
            .find(|item| item.resource_id == 2001)
            .unwrap();
        assert_eq!(zanni.copy_count, 1);
        assert_eq!(zanni.complete_cycle_count, 1);
        assert_eq!(zanni.total_pulls, 14);
        assert_eq!(zanni.average_pulls, Some(14.0));
        assert!(!zanni.is_lower_bound);
    }

    #[test]
    fn character_cost_handles_scattered_copies_stable_ids_and_pool_boundaries() {
        let mut records = Vec::new();
        let mut add = |id: i64, quality: i32, resource_id: i64, name: &str| {
            let mut item = record(id, "1", quality, &format!("2026-01-01 00:{:02}:00", id));
            item.resource_id = resource_id;
            item.name = name.to_string();
            item.is_off_rate = false;
            records.push(item);
        };

        add(1, 5, 2001, "赞妮");
        for id in 2..=4 {
            add(id, 3, id, "三星");
        }
        add(5, 5, 2001, "赞妮");
        for id in 6..=9 {
            add(id, 3, id, "三星");
        }
        add(10, 5, 2002, "另一位UP");
        for id in 11..=19 {
            add(id, 3, id, "三星");
        }
        add(20, 5, 2001, "赞妮");
        for id in 21..=24 {
            add(id, 3, id, "三星");
        }
        // The flag is deliberately false: the standard ID must still identify this as an off-rate.
        add(25, 5, 1104, "维里奈");
        for id in 26..=29 {
            add(id, 3, id, "三星");
        }
        add(30, 5, 2001, "赞妮");
        for id in 31..=35 {
            add(id, 3, id, "三星");
        }
        // A trailing off-rate after the last copy is not part of the character cost.
        add(36, 5, 1203, "卡卡罗");

        let mut other_pool = record(1, "2", 5, "2026-01-01 00:01:00");
        other_pool.resource_id = 2001;
        other_pool.name = "赞妮".to_string();
        records.push(other_pool);

        let insights = character_pull_insights(&records, false);
        let zanni = insights
            .iter()
            .find(|item| item.resource_id == 2001)
            .unwrap();
        assert_eq!(zanni.copy_count, 4);
        assert_eq!(zanni.complete_cycle_count, 3);
        assert_eq!(zanni.total_pulls, 25);
        assert_eq!(zanni.average_pulls, Some(6.25));
        assert!(zanni.is_lower_bound);
        assert_eq!(
            insights
                .iter()
                .filter(|item| item.resource_id == 2001)
                .count(),
            1
        );
    }

    #[test]
    fn character_cost_preserves_observed_pulls_across_invalid_consecutive_off_rates() {
        let mut records = vec![record(1, "1", 5, "2026-01-01 00:00:01")];
        records[0].resource_id = 3001;
        for id in 2..=31 {
            let quality = if matches!(id, 11 | 21 | 31) { 5 } else { 3 };
            let mut item = record(id, "1", quality, &format!("2026-01-01 00:00:{id:02}"));
            if id == 11 {
                item.resource_id = 1104;
                item.name = "维里奈".to_string();
            } else if id == 21 {
                item.resource_id = 1203;
                item.name = "卡卡罗".to_string();
            } else if id == 31 {
                item.resource_id = 2001;
                item.name = "赞妮".to_string();
            }
            records.push(item);
        }

        let insights = character_pull_insights(&records, false);
        let zanni = insights
            .iter()
            .find(|item| item.resource_id == 2001)
            .unwrap();
        assert_eq!(zanni.total_pulls, 30);
        assert_eq!(zanni.average_pulls, Some(30.0));
        assert!(!zanni.is_lower_bound);
    }

    #[test]
    fn character_cost_respects_mock_filtering() {
        let mut mock = record(1, "1", 5, "2026-01-01 00:00:01");
        mock.resource_id = 2001;
        mock.name = "赞妮".to_string();
        mock.is_mock = true;

        assert!(character_pull_insights(&[mock.clone()], false).is_empty());
        let included = character_pull_insights(&[mock], true);
        assert_eq!(included.len(), 1);
        assert_eq!(included[0].copy_count, 1);
        assert!(included[0].is_lower_bound);
    }

    #[test]
    fn character_cost_counts_weapon_fillers_inside_a_role_pool() {
        let mut records = vec![record(1, "1", 5, "2026-01-01 00:00:01")];
        records[0].resource_id = 3001;
        for id in 2..=50 {
            let mut item = record(
                id,
                "1",
                if id == 50 { 5 } else { 3 },
                &format!("2026-01-01 00:{:02}:00", id),
            );
            if id == 50 {
                item.resource_id = 2001;
                item.name = "赞妮".to_string();
            } else {
                item.resource_type = "weapon".to_string();
                item.name = "三星武器".to_string();
            }
            records.push(item);
        }

        let insights = character_pull_insights(&records, false);
        let zanni = insights
            .iter()
            .find(|item| item.resource_id == 2001)
            .unwrap();
        assert_eq!(zanni.total_pulls, 49);
        assert_eq!(zanni.average_pulls, Some(49.0));
        assert!(!zanni.is_lower_bound);
    }

    #[test]
    fn acquisition_trace_groups_all_copies_and_their_preceding_off_rates() {
        let mut records = Vec::new();
        for id in 1..=8 {
            let mut item = record(id, "1", 5, &format!("2026-01-01 00:00:{id:02}"));
            let off = matches!(id, 1 | 4 | 7);
            item.resource_id = if off { 1104 } else { 2001 };
            item.name = if off { "维里奈" } else { "绯雪" }.to_string();
            item.is_off_rate = off;
            records.push(item);
        }
        let trace = resource_acquisition_insights(&records, false)
            .into_iter()
            .find(|item| item.resource_id == 2001)
            .unwrap();
        assert_eq!(trace.target_count, 5);
        assert_eq!(trace.off_rate_count, 3);
        assert_eq!(trace.total_five_star_count, 8);
        assert_eq!(trace.records.len(), 8);
        assert_eq!(trace.total_pulls, 8);
        assert_eq!(
            trace.records.iter().filter(|item| item.is_off_rate).count(),
            3
        );
    }

    #[test]
    fn acquisition_trace_does_not_attach_a_trailing_off_rate() {
        let mut up = record(1, "1", 5, "2026-01-01 00:00:01");
        up.resource_id = 2001;
        let mut off = record(2, "1", 5, "2026-01-01 00:00:02");
        off.resource_id = 1104;
        let trace = resource_acquisition_insights(&[up, off], false).remove(0);
        assert_eq!(trace.target_count, 1);
        assert_eq!(trace.off_rate_count, 0);
        assert_eq!(trace.records.len(), 1);
    }

    #[test]
    fn acquisition_trace_supports_weapon_standard_and_beginner_pools_without_off_rate() {
        let mut weapon = record(1, "2", 5, "2026-01-01 00:00:01");
        weapon.resource_id = 21040036;
        weapon.resource_type = "weapon".to_string();
        let mut standard = record(2, "3", 5, "2026-01-01 00:00:02");
        standard.resource_id = 1503;
        let beginner = record(3, "5", 5, "2026-01-01 00:00:03");
        let insights = resource_acquisition_insights(&[weapon, standard, beginner], false);
        assert_eq!(insights.len(), 3);
        assert!(insights
            .iter()
            .all(|item| !item.has_off_rate && item.off_rate_count == 0));
        assert!(insights
            .iter()
            .any(|item| item.pool_type == "2" && item.resource_type == "weapon"));
        assert!(insights.iter().any(|item| item.pool_type == "3"));
        assert!(insights.iter().any(|item| item.pool_type == "5"));
    }

    #[test]
    fn acquisition_trace_isolated_by_pool_and_mock_filter() {
        let mut real = record(1, "1", 5, "2026-01-01 00:00:01");
        real.resource_id = 2001;
        let mut other_pool = real.clone();
        other_pool.id = Some(2);
        other_pool.card_pool_type = "8".to_string();
        let mut mock = real.clone();
        mock.id = Some(3);
        mock.is_mock = true;
        let excluded =
            resource_acquisition_insights(&[real.clone(), other_pool.clone(), mock.clone()], false);
        assert_eq!(excluded.len(), 2);
        assert!(excluded.iter().all(|item| item.target_count == 1));
        let included = resource_acquisition_insights(&[real, other_pool, mock], true);
        assert_eq!(
            included
                .iter()
                .find(|item| item.pool_type == "1")
                .unwrap()
                .target_count,
            2
        );
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
    fn confirmed_boundary_includes_first_five_star_in_every_insight() {
        let records = vec![
            record(1, "12", 3, "2026-01-01 00:00:01"),
            record(2, "12", 3, "2026-01-01 00:00:02"),
            record(3, "12", 5, "2026-01-01 00:00:03"),
        ];
        let confirmed = HashSet::from(["12".to_string()]);

        let stats = GachaStats::from_records_with_boundaries(&records, &confirmed);
        assert_eq!(stats.avg_five_star_pity, 3.0);

        let insights = GachaInsights::from_records_with_boundaries(&records, false, &confirmed);
        assert_eq!(insights.pools[0].complete_interval_count, 1);
        assert_eq!(insights.pools[0].average_pity, Some(3.0));

        let acquisitions =
            resource_acquisition_insights_with_boundaries(&records, false, &confirmed);
        assert_eq!(acquisitions[0].total_pulls, 3);
        assert!(!acquisitions[0].is_lower_bound);
        assert!(!acquisitions[0].records[0].is_lower_bound);
    }

    #[test]
    fn confirmed_boundary_makes_first_limited_up_cycle_complete() {
        let mut off_rate = record(1, "1", 5, "2026-01-01 00:00:01");
        off_rate.resource_id = 1104;
        off_rate.is_off_rate = true;
        let mut featured = record(2, "1", 5, "2026-01-01 00:00:02");
        featured.resource_id = 2001;
        featured.name = "限定角色".to_string();
        let confirmed = HashSet::from(["1".to_string()]);

        let characters = character_pull_insights_with_boundaries(
            &[off_rate.clone(), featured.clone()],
            false,
            &confirmed,
        );
        assert_eq!(characters[0].complete_cycle_count, 1);
        assert_eq!(characters[0].total_pulls, 2);
        assert!(!characters[0].is_lower_bound);

        let insights = GachaInsights::from_records_with_boundaries(
            &[off_rate.clone(), featured.clone()],
            false,
            &confirmed,
        );
        assert_eq!(insights.pools[0].featured_cycle_count, 1);
        assert_eq!(insights.pools[0].featured_average_pulls, Some(2.0));
        assert_eq!(insights.pools[0].featured_attempt_count, 1);
        assert_eq!(insights.pools[0].featured_win_count, 0);

        let direct_up =
            GachaInsights::from_records_with_boundaries(&[featured.clone()], false, &confirmed);
        assert_eq!(direct_up.pools[0].featured_cycle_count, 1);
        assert_eq!(direct_up.pools[0].featured_attempt_count, 1);
        assert_eq!(direct_up.pools[0].featured_win_count, 1);
        assert_eq!(direct_up.pools[0].featured_win_rate, Some(100.0));

        let acquisitions =
            resource_acquisition_insights_with_boundaries(&[off_rate, featured], false, &confirmed);
        assert_eq!(acquisitions[0].total_pulls, 2);
        assert!(!acquisitions[0].is_lower_bound);
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
