use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::assets::GachaResource;
use crate::gacha::fetcher::{get_display_pool_name, hard_pity_for_pool, is_limited_char_pool};
use crate::gacha::parser::{ClearRecordsResult, GachaRecord, GameSettings, RecordSummary};

const STANDARD_FIVE_STAR_CHAR_IDS: &[i64] = &[1104, 1203, 1301, 1405, 1503];
type OccurrenceKey = (
    String,
    String,
    String,
    i64,
    i32,
    String,
    i32,
    bool,
    Option<String>,
);

fn current_datetime() -> String {
    use chrono::{Local, TimeZone};
    let now = SystemTime::now();
    let dur = now.duration_since(UNIX_EPOCH).unwrap_or_default();
    // 用 chrono Local 格式化，跟记录时间保持一致
    let local = Local
        .timestamp_opt(dur.as_secs() as i64, 0)
        .single()
        .unwrap_or_else(|| Local::now());
    local.format("%Y-%m-%d %H:%M:%S").to_string()
}

#[derive(Debug, Clone)]
pub struct MockInsertRequest {
    pub player_id: String,
    pub card_pool_type: String,
    pub resource: GachaResource,
    pub pulls: i32,
    pub time: String,
}

/// Database-derived counts and boundary context for one mock five-star insertion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MockInsertPlan {
    pub required_draws: i32,
    pub existing_pity: i32,
    pub next_five_star_time: Option<String>,
    pub three_star_streak_before: usize,
    pub three_star_prefix_after: usize,
}

impl MockInsertPlan {
    pub fn before_filler_count(&self) -> usize {
        self.required_draws.saturating_sub(1) as usize
    }

    pub fn after_filler_count(&self) -> usize {
        if self.next_five_star_time.is_some() {
            self.existing_pity as usize
        } else {
            0
        }
    }
}

#[derive(Debug, Clone)]
pub struct MockUpdateRequest {
    pub id: i64,
    pub card_pool_type: String,
    pub resource: GachaResource,
    pub time: String,
    pub filler_time: String,
    pub after_filler_time: String,
}

pub struct Database {
    conn: Connection,
    path: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeStats {
    pub imported_count: usize,
    pub added_count: usize,
    pub duplicate_count: usize,
    pub added_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedJson {
    pub json: String,
    pub updated_at: i64,
}

impl Database {
    pub fn new(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        let db = Self {
            conn,
            path: Some(path.to_path_buf()),
        };
        db.init_tables()?;
        db.migrate()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS gacha_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    player_id TEXT NOT NULL,
                    card_pool_type TEXT NOT NULL,
                    card_pool_name TEXT NOT NULL,
                    resource_id INTEGER NOT NULL,
                    quality_level INTEGER NOT NULL,
                    resource_type TEXT NOT NULL,
                    name TEXT NOT NULL,
                    count INTEGER NOT NULL,
                    time TEXT NOT NULL,
                    is_off_rate INTEGER NOT NULL DEFAULT 0,
                    occurrence_no INTEGER NOT NULL DEFAULT 0,
                    order_in_timestamp INTEGER NOT NULL DEFAULT 0,
                    is_mock INTEGER NOT NULL DEFAULT 0,
                    mock_batch_id TEXT
                );

                CREATE TABLE IF NOT EXISTS game_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_dir TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS nanoka_cache (
                    cache_key TEXT PRIMARY KEY,
                    json TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS player_import_info (
                    player_id TEXT PRIMARY KEY,
                    last_imported_at TEXT,
                    is_inferred INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS pool_history_boundaries (
                    player_id TEXT NOT NULL,
                    card_pool_type TEXT NOT NULL,
                    earliest_time TEXT NOT NULL,
                    earliest_time_count INTEGER NOT NULL,
                    confirmed_at TEXT NOT NULL,
                    PRIMARY KEY (player_id, card_pool_type)
                );
                ",
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 数据库迁移
    fn migrate(&self) -> Result<(), String> {
        // 检查 is_off_rate 列是否存在
        let has_column: bool = self
            .conn
            .prepare("PRAGMA table_info(gacha_records)")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .any(|name| name == "is_off_rate");

        if !has_column {
            self.conn
                .execute(
                    "ALTER TABLE gacha_records ADD COLUMN is_off_rate INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .map_err(|e| e.to_string())?;
        }

        // 旧表有 UNIQUE(player_id, resource_id, time) 约束，会吞掉同秒重复记录
        // 检查是否还有该约束，如果有则重建表
        let has_unique: bool = self
            .conn
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='gacha_records'")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .next()
            .map(|sql| sql.contains("UNIQUE"))
            .unwrap_or(false);

        if has_unique {
            self.conn
                .execute_batch(
                    r#"
                BEGIN;
                CREATE TABLE gacha_records_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    player_id TEXT NOT NULL,
                    card_pool_type TEXT NOT NULL,
                    card_pool_name TEXT NOT NULL,
                    resource_id INTEGER NOT NULL,
                    quality_level INTEGER NOT NULL,
                    resource_type TEXT NOT NULL,
                    name TEXT NOT NULL,
                    count INTEGER NOT NULL,
                    time TEXT NOT NULL,
                    is_off_rate INTEGER NOT NULL DEFAULT 0,
                    occurrence_no INTEGER NOT NULL DEFAULT 0,
                    order_in_timestamp INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO gacha_records_new
                    (id, player_id, card_pool_type, card_pool_name, resource_id, quality_level,
                     resource_type, name, count, time, is_off_rate)
                SELECT id, player_id, card_pool_type, card_pool_name, resource_id, quality_level,
                       resource_type, name, count, time, is_off_rate
                FROM gacha_records;
                DROP TABLE gacha_records;
                ALTER TABLE gacha_records_new RENAME TO gacha_records;
                COMMIT;
            "#,
                )
                .map_err(|e| e.to_string())?;
        }

        let columns: Vec<String> = self
            .conn
            .prepare("PRAGMA table_info(gacha_records)")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get(1))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        let needs_occurrence_no = !columns.iter().any(|name| name == "occurrence_no");
        let needs_order = !columns.iter().any(|name| name == "order_in_timestamp");
        let needs_is_mock = !columns.iter().any(|name| name == "is_mock");
        let needs_mock_batch_id = !columns.iter().any(|name| name == "mock_batch_id");

        if needs_occurrence_no {
            self.conn
                .execute(
                    "ALTER TABLE gacha_records ADD COLUMN occurrence_no INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .map_err(|e| e.to_string())?;
        }
        if needs_order {
            self.conn
                .execute(
                    "ALTER TABLE gacha_records ADD COLUMN order_in_timestamp INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .map_err(|e| e.to_string())?;
        }
        if needs_is_mock {
            self.conn
                .execute(
                    "ALTER TABLE gacha_records ADD COLUMN is_mock INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .map_err(|e| e.to_string())?;
        }
        if needs_mock_batch_id {
            self.conn
                .execute(
                    "ALTER TABLE gacha_records ADD COLUMN mock_batch_id TEXT",
                    [],
                )
                .map_err(|e| e.to_string())?;
        }

        // 旧数据按插入顺序补齐重复序号；后续重新导入原始 JSON 时会自然命中这些记录。
        if needs_occurrence_no || needs_order {
            self.conn.execute_batch(
                r#"
                WITH ranked AS (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               PARTITION BY player_id, card_pool_type, time, resource_id,
                                            quality_level, resource_type, count
                               ORDER BY id
                           ) - 1 AS occurrence_no,
                           ROW_NUMBER() OVER (
                               PARTITION BY player_id, card_pool_type, time
                               ORDER BY id
                           ) - 1 AS order_in_timestamp
                    FROM gacha_records
                )
                UPDATE gacha_records
                SET occurrence_no = (SELECT occurrence_no FROM ranked WHERE ranked.id = gacha_records.id),
                    order_in_timestamp = (SELECT order_in_timestamp FROM ranked WHERE ranked.id = gacha_records.id);
                "#,
            ).map_err(|e| e.to_string())?;
        }

        self.conn
            .execute_batch(
                r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_gacha_record_occurrence
            ON gacha_records (
                player_id, card_pool_type, time, resource_id,
                quality_level, resource_type, count, occurrence_no
            );

            INSERT OR IGNORE INTO player_import_info (player_id, last_imported_at, is_inferred)
            SELECT
                gr.player_id,
                MAX(gr.time) AS last_imported_at,
                1 AS is_inferred
            FROM gacha_records gr
            LEFT JOIN player_import_info pii ON gr.player_id = pii.player_id
            WHERE pii.player_id IS NULL AND gr.is_mock = 0
            GROUP BY gr.player_id;

            UPDATE player_import_info
            SET last_imported_at = (
                SELECT MAX(gr.time)
                FROM gacha_records gr
                WHERE gr.player_id = player_import_info.player_id AND gr.is_mock = 0
            )
            WHERE is_inferred = 1
              AND EXISTS (
                  SELECT 1 FROM gacha_records gr
                  WHERE gr.player_id = player_import_info.player_id AND gr.is_mock = 0
              );

            DELETE FROM player_import_info
            WHERE is_inferred = 1
              AND NOT EXISTS (
                  SELECT 1 FROM gacha_records gr
                  WHERE gr.player_id = player_import_info.player_id AND gr.is_mock = 0
              );
            "#,
            )
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    /// 增量合并抽卡记录。同池同秒允许出现多条完全相同的记录。
    pub fn merge_records(&self, records: &[GachaRecord]) -> Result<MergeStats, String> {
        self.merge_records_transactionally(records, true)
    }

    /// 使用正式合并逻辑计算结果，但回滚所有写入。
    pub fn preview_merge_records(&self, records: &[GachaRecord]) -> Result<MergeStats, String> {
        self.merge_records_transactionally(records, false)
    }

    fn merge_records_transactionally(
        &self,
        records: &[GachaRecord],
        commit: bool,
    ) -> Result<MergeStats, String> {
        if records.is_empty() {
            return Ok(MergeStats {
                imported_count: 0,
                added_count: 0,
                duplicate_count: 0,
                added_ids: Vec::new(),
            });
        }

        let first_player_id = &records[0].player_id;
        if records
            .iter()
            .any(|record| record.player_id != *first_player_id)
        {
            return Err("一次导入中包含多个 UID，无法安全合并".to_string());
        }

        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        let mut occurrence_counts: HashMap<OccurrenceKey, i64> = HashMap::new();
        let mut timestamp_orders: HashMap<(String, String, String), i64> = HashMap::new();
        let mut added_count = 0;
        let mut added_ids = Vec::new();

        for record in records {
            let occurrence_key = (
                record.player_id.clone(),
                record.card_pool_type.clone(),
                record.time.clone(),
                record.resource_id,
                record.quality_level,
                record.resource_type.clone(),
                record.count,
                record.is_mock,
                record.mock_batch_id.clone(),
            );
            let occurrence_no = occurrence_counts.entry(occurrence_key).or_insert(0);
            let current_occurrence_no = *occurrence_no;
            *occurrence_no += 1;

            let order_key = (
                record.player_id.clone(),
                record.card_pool_type.clone(),
                record.time.clone(),
            );
            let order_in_timestamp = timestamp_orders.entry(order_key).or_insert(0);
            let current_order = *order_in_timestamp;
            *order_in_timestamp += 1;

            // Real and mock histories have separate identities. In particular,
            // a matching mock row must never hide a later official import.
            let existing_id: Option<i64> = tx
                .query_row(
                    "SELECT id FROM gacha_records
                     WHERE player_id = ?1 AND card_pool_type = ?2 AND time = ?3
                       AND resource_id = ?4 AND quality_level = ?5 AND resource_type = ?6
                       AND count = ?7 AND is_mock = ?8
                       AND (?8 = 0 OR mock_batch_id = ?9 OR (mock_batch_id IS NULL AND ?9 IS NULL))
                     ORDER BY occurrence_no ASC LIMIT 1 OFFSET ?10",
                    params![
                        record.player_id,
                        record.card_pool_type,
                        record.time,
                        record.resource_id,
                        record.quality_level,
                        record.resource_type,
                        record.count,
                        record.is_mock as i32,
                        record.mock_batch_id,
                        current_occurrence_no,
                    ],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;

            if let Some(existing_id) = existing_id {
                // 名称和歪率属于展示/派生信息，可随当前规则刷新。
                tx.execute(
                    "UPDATE gacha_records
                     SET card_pool_name = ?1, name = ?2, is_off_rate = ?3
                     WHERE id = ?4 AND is_mock = ?5",
                    params![
                        record.card_pool_name,
                        record.name,
                        record.is_off_rate as i32,
                        existing_id,
                        record.is_mock as i32,
                    ],
                )
                .map_err(|e| e.to_string())?;
            } else {
                let next_occurrence_no: i64 = tx
                    .query_row(
                        "SELECT COALESCE(MAX(occurrence_no), -1) + 1 FROM gacha_records
                         WHERE player_id = ?1 AND card_pool_type = ?2 AND time = ?3
                           AND resource_id = ?4 AND quality_level = ?5 AND resource_type = ?6
                           AND count = ?7",
                        params![
                            record.player_id,
                            record.card_pool_type,
                            record.time,
                            record.resource_id,
                            record.quality_level,
                            record.resource_type,
                            record.count,
                        ],
                        |row| row.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT INTO gacha_records
                     (player_id, card_pool_type, card_pool_name, resource_id, quality_level,
                      resource_type, name, count, time, is_off_rate, occurrence_no, order_in_timestamp,
                      is_mock, mock_batch_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                    params![
                        record.player_id,
                        record.card_pool_type,
                        record.card_pool_name,
                        record.resource_id,
                        record.quality_level,
                        record.resource_type,
                        record.name,
                        record.count,
                        record.time,
                        record.is_off_rate as i32,
                        next_occurrence_no,
                        current_order,
                        record.is_mock as i32,
                        record.mock_batch_id,
                    ],
                )
                .map_err(|e| e.to_string())?;
                added_count += 1;
                added_ids.push(tx.last_insert_rowid());
            }
        }
        if commit {
            tx.commit().map_err(|e| e.to_string())?;
        } else {
            tx.rollback().map_err(|e| e.to_string())?;
        }

        Ok(MergeStats {
            imported_count: records.len(),
            added_count,
            duplicate_count: records.len() - added_count,
            added_ids,
        })
    }

    /// 获取所有抽卡记录
    pub fn get_all_records(&self, player_id: Option<&str>) -> Result<Vec<GachaRecord>, String> {
        let sql = if player_id.is_some() {
            "SELECT id, player_id, card_pool_type, card_pool_name, resource_id, quality_level, resource_type, name, count, time, is_off_rate, is_mock, mock_batch_id FROM gacha_records WHERE player_id = ?1 ORDER BY time DESC, order_in_timestamp ASC, id ASC"
        } else {
            "SELECT id, player_id, card_pool_type, card_pool_name, resource_id, quality_level, resource_type, name, count, time, is_off_rate, is_mock, mock_batch_id FROM gacha_records ORDER BY time DESC, order_in_timestamp ASC, id ASC"
        };

        let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
        let map_record = |row: &rusqlite::Row| -> rusqlite::Result<GachaRecord> {
            let card_pool_type: String = row.get(2)?;
            let card_pool_group =
                crate::gacha::fetcher::get_pool_group(&card_pool_type).to_string();
            Ok(GachaRecord {
                id: row.get(0)?,
                player_id: row.get(1)?,
                card_pool_type,
                card_pool_name: row.get(3)?,
                card_pool_group,
                resource_id: row.get(4)?,
                quality_level: row.get(5)?,
                resource_type: row.get(6)?,
                name: row.get(7)?,
                count: row.get(8)?,
                time: row.get(9)?,
                is_off_rate: row.get::<_, i32>(10)? != 0,
                is_mock: row.get::<_, i32>(11)? != 0,
                mock_batch_id: row.get(12)?,
            })
        };

        let records = if let Some(pid) = player_id {
            stmt.query_map(params![pid], map_record)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            stmt.query_map([], map_record)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        };

        Ok(records)
    }

    /// Atomically inserts a five-star and its filler rows. For middle inserts,
    /// post-target fillers preserve the pity of the next existing five-star.
    pub fn insert_mock_batch(
        &self,
        request: &MockInsertRequest,
        before_fillers: &[GachaResource],
        before_filler_time: &str,
        after_fillers: &[GachaResource],
        after_filler_time: &str,
    ) -> Result<Vec<GachaRecord>, String> {
        let hard_pity = hard_pity_for_pool(&request.card_pool_type);
        if request.pulls < 1 || request.pulls > hard_pity {
            return Err(format!("抽数必须在 1 到 {hard_pity} 之间"));
        }
        if request.resource.quality_level != 5 {
            return Err("只能插入五星目标记录".to_string());
        }
        let plan = self.mock_insert_plan(
            &request.player_id,
            &request.card_pool_type,
            &request.time,
            request.pulls,
        )?;
        if before_fillers.len() != plan.before_filler_count()
            || after_fillers.len() != plan.after_filler_count()
        {
            return Err("补足记录数量不正确".to_string());
        }
        validate_resource_for_pool(&request.card_pool_type, &request.resource)?;
        for resource in before_fillers.iter().chain(after_fillers) {
            validate_resource_for_pool(&request.card_pool_type, resource)?;
            if !matches!(resource.quality_level, 3 | 4) {
                return Err("补足记录只能使用三星或四星资源".to_string());
            }
        }
        validate_filler_guarantee(before_fillers, plan.three_star_streak_before, 0)?;
        validate_filler_guarantee(after_fillers, 0, plan.three_star_prefix_after)?;

        let target_is_off = is_off_rate(&request.card_pool_type, &request.resource);
        self.validate_limited_sequence(
            &request.player_id,
            &request.card_pool_type,
            &request.time,
            None,
            target_is_off,
        )?;

        let batch_id = format!(
            "mock-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_nanos()
        );
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        let mut inserted_ids =
            Vec::with_capacity(plan.required_draws as usize + plan.after_filler_count());
        for (index, resource) in before_fillers.iter().enumerate() {
            inserted_ids.push(insert_mock_row(
                &tx,
                &request.player_id,
                &request.card_pool_type,
                resource,
                before_filler_time,
                &batch_id,
                index as i64,
            )?);
        }
        // Insert post-target compensation before the target row. When the next
        // five-star shares this timestamp, reverse-ID draw ordering still puts
        // the new target before its compensation and the existing five-star.
        for (index, resource) in after_fillers.iter().enumerate() {
            inserted_ids.push(insert_mock_row(
                &tx,
                &request.player_id,
                &request.card_pool_type,
                resource,
                after_filler_time,
                &batch_id,
                index as i64,
            )?);
        }
        inserted_ids.push(insert_mock_row(
            &tx,
            &request.player_id,
            &request.card_pool_type,
            &request.resource,
            &request.time,
            &batch_id,
            0,
        )?);
        tx.commit().map_err(|e| e.to_string())?;

        let all = self.get_all_records(Some(&request.player_id))?;
        let id_set: std::collections::HashSet<i64> = inserted_ids.into_iter().collect();
        Ok(all
            .into_iter()
            .filter(|record| record.id.is_some_and(|id| id_set.contains(&id)))
            .collect())
    }

    /// Updates an editable mock row and moves both filler segments with a mock five-star.
    pub fn update_mock_record(&self, request: &MockUpdateRequest) -> Result<(), String> {
        validate_resource_for_pool(&request.card_pool_type, &request.resource)?;
        let (player_id, old_pool_type, old_time, old_quality, is_mock, batch_id): (String, String, String, i32, i32, Option<String>) = self.conn.query_row(
            "SELECT player_id, card_pool_type, time, quality_level, is_mock, mock_batch_id FROM gacha_records WHERE id = ?1",
            params![request.id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        ).map_err(|e| e.to_string())?;
        if is_mock == 0 {
            return Err("真实导入记录不可编辑".to_string());
        }
        if old_quality != request.resource.quality_level {
            return Err("不可修改模拟记录的星级".to_string());
        }
        let target_is_off = is_off_rate(&request.card_pool_type, &request.resource);
        if request.resource.quality_level == 5 {
            if old_pool_type != request.card_pool_type || old_time != request.time {
                self.validate_removed_limited_five(&player_id, &old_pool_type, request.id)?;
            }
            self.validate_limited_sequence(
                &player_id,
                &request.card_pool_type,
                &request.time,
                Some(request.id),
                target_is_off,
            )?;
        }
        let bounded_after_filler_time = if request.resource.quality_level == 5 {
            let next_five_star_time: Option<String> = self
                .conn
                .query_row(
                    "SELECT time FROM gacha_records
                 WHERE player_id = ?1 AND card_pool_type = ?2 AND quality_level = 5
                   AND id != ?3 AND time >= ?4
                 ORDER BY time ASC, id DESC LIMIT 1",
                    params![player_id, request.card_pool_type, request.id, request.time],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            next_five_star_time
                .filter(|time| time < &request.after_filler_time)
                .unwrap_or_else(|| request.after_filler_time.clone())
        } else {
            request.after_filler_time.clone()
        };
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE gacha_records SET card_pool_type = ?1, card_pool_name = ?2, resource_id = ?3,
             quality_level = ?4, resource_type = ?5, name = ?6, time = ?7, is_off_rate = ?8
             WHERE id = ?9 AND is_mock = 1",
            params![
                request.card_pool_type,
                get_display_pool_name(&request.card_pool_type),
                request.resource.resource_id,
                request.resource.quality_level,
                request.resource.resource_type,
                request.resource.name,
                request.time,
                target_is_off as i32,
                request.id,
            ],
        )
        .map_err(|e| e.to_string())?;
        if old_quality == 5 && (old_time != request.time || old_pool_type != request.card_pool_type)
        {
            let batch_id = batch_id.ok_or_else(|| "五星 mock 记录缺少批次信息".to_string())?;
            move_mock_fillers(
                &tx,
                &batch_id,
                &player_id,
                &request.card_pool_type,
                &old_time,
                &request.filler_time,
                &bounded_after_filler_time,
            )?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn required_mock_draws(
        &self,
        player_id: &str,
        pool_type: &str,
        time: &str,
        target_pity: i32,
    ) -> Result<i32, String> {
        Ok(self
            .mock_insert_plan(player_id, pool_type, time, target_pity)?
            .required_draws)
    }

    /// Calculates required rows and adjacent three-star streaks from current DB state.
    /// The same plan is recalculated during insertion to reject stale callers.
    pub fn mock_insert_plan(
        &self,
        player_id: &str,
        pool_type: &str,
        time: &str,
        target_pity: i32,
    ) -> Result<MockInsertPlan, String> {
        let hard_pity = hard_pity_for_pool(pool_type);
        if !(1..=hard_pity).contains(&target_pity) {
            return Err(format!("抽数必须在 1 到 {hard_pity} 之间"));
        }
        let existing_pity = self.pity_before(player_id, pool_type, time)?;
        let required_draws = target_pity - existing_pity;
        if required_draws < 1 {
            return Err(format!(
                "该时间点前已经垫了 {existing_pity} 抽，五星抽数必须至少为 {}",
                existing_pity + 1
            ));
        }
        let next_five_star_time = self
            .conn
            .query_row(
                "SELECT time FROM gacha_records
             WHERE player_id = ?1 AND card_pool_type = ?2 AND quality_level = 5 AND time >= ?3
             ORDER BY time ASC, id DESC LIMIT 1",
                params![player_id, pool_type, time],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let three_star_streak_before = self.consecutive_three_stars(
            player_id,
            pool_type,
            time,
            "time < ?3 ORDER BY time DESC, id ASC",
        )?;
        let three_star_prefix_after = self.consecutive_three_stars(
            player_id,
            pool_type,
            time,
            "time >= ?3 ORDER BY time ASC, id DESC",
        )?;
        Ok(MockInsertPlan {
            required_draws,
            existing_pity,
            next_five_star_time,
            three_star_streak_before,
            three_star_prefix_after,
        })
    }

    fn consecutive_three_stars(
        &self,
        player_id: &str,
        pool_type: &str,
        time: &str,
        order_clause: &str,
    ) -> Result<usize, String> {
        let sql = format!(
            "SELECT quality_level FROM gacha_records
             WHERE player_id = ?1 AND card_pool_type = ?2 AND {order_clause}"
        );
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let qualities = stmt
            .query_map(params![player_id, pool_type, time], |row| {
                row.get::<_, i32>(0)
            })
            .map_err(|e| e.to_string())?;
        let mut streak = 0;
        for quality in qualities {
            if quality.map_err(|e| e.to_string())? != 3 {
                break;
            }
            streak += 1;
        }
        Ok(streak)
    }

    fn pity_before(&self, player_id: &str, pool_type: &str, time: &str) -> Result<i32, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT quality_level FROM gacha_records
             WHERE player_id = ?1 AND card_pool_type = ?2 AND time < ?3
             ORDER BY time DESC, order_in_timestamp ASC, id ASC",
            )
            .map_err(|e| e.to_string())?;
        let qualities = stmt
            .query_map(params![player_id, pool_type, time], |row| {
                row.get::<_, i32>(0)
            })
            .map_err(|e| e.to_string())?;
        let mut pity = 0;
        for quality in qualities {
            if quality.map_err(|e| e.to_string())? == 5 {
                break;
            }
            pity += 1;
        }
        Ok(pity)
    }

    /// Returns the before/after filler counts associated with a mock five-star.
    pub fn mock_filler_segment_counts(&self, id: i64) -> Result<(usize, usize), String> {
        let (quality, is_mock, batch_id, target_time): (i32, i32, Option<String>, String) = self
            .conn
            .query_row(
                "SELECT quality_level, is_mock, mock_batch_id, time
                 FROM gacha_records WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|e| e.to_string())?;
        if is_mock == 0 {
            return Err("真实导入记录不可编辑".to_string());
        }
        if quality != 5 {
            return Ok((0, 0));
        }
        let batch_id = batch_id.ok_or_else(|| "五星 mock 记录缺少批次信息".to_string())?;
        let (before, after): (i64, i64) = self
            .conn
            .query_row(
                "SELECT
                   SUM(CASE WHEN time < ?2 THEN 1 ELSE 0 END),
                   SUM(CASE WHEN time >= ?2 THEN 1 ELSE 0 END)
                 FROM gacha_records
                 WHERE is_mock = 1 AND mock_batch_id = ?1 AND quality_level != 5",
                params![batch_id, target_time],
                |row| {
                    Ok((
                        row.get::<_, Option<i64>>(0)?.unwrap_or(0),
                        row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    ))
                },
            )
            .map_err(|e| e.to_string())?;
        Ok((before as usize, after as usize))
    }

    pub fn delete_mock_record(&self, id: i64) -> Result<usize, String> {
        let (quality, is_mock, batch_id): (i32, i32, Option<String>) = self
            .conn
            .query_row(
                "SELECT quality_level, is_mock, mock_batch_id FROM gacha_records WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|e| e.to_string())?;
        if is_mock == 0 {
            return Err("真实导入记录不可删除".to_string());
        }
        if quality == 5 {
            let batch_id = batch_id.ok_or_else(|| "五星 mock 记录缺少批次信息".to_string())?;
            self.conn
                .execute(
                    "DELETE FROM gacha_records WHERE is_mock = 1 AND mock_batch_id = ?1",
                    params![batch_id],
                )
                .map_err(|e| e.to_string())
        } else {
            self.conn
                .execute(
                    "DELETE FROM gacha_records WHERE id = ?1 AND is_mock = 1",
                    params![id],
                )
                .map_err(|e| e.to_string())
        }
    }

    fn validate_removed_limited_five(
        &self,
        player_id: &str,
        pool_type: &str,
        excluded_id: i64,
    ) -> Result<(), String> {
        if !is_limited_char_pool(pool_type) {
            return Ok(());
        }
        let previous: Option<i32> = self
            .conn
            .query_row(
                "SELECT is_off_rate FROM gacha_records
             WHERE player_id = ?1 AND card_pool_type = ?2 AND quality_level = 5 AND id != ?3
               AND (
                 time < (SELECT time FROM gacha_records WHERE id = ?3)
                 OR (time = (SELECT time FROM gacha_records WHERE id = ?3) AND id > ?3)
               )
             ORDER BY time DESC, id ASC LIMIT 1",
                params![player_id, pool_type, excluded_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let next: Option<i32> = self
            .conn
            .query_row(
                "SELECT is_off_rate FROM gacha_records
             WHERE player_id = ?1 AND card_pool_type = ?2 AND quality_level = 5 AND id != ?3
               AND (
                 time > (SELECT time FROM gacha_records WHERE id = ?3)
                 OR (time = (SELECT time FROM gacha_records WHERE id = ?3) AND id < ?3)
               )
             ORDER BY time ASC, id DESC LIMIT 1",
                params![player_id, pool_type, excluded_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if previous == Some(1) && next == Some(1) {
            return Err("移动该五星后会使原位置两次歪连续，违反限定角色池保底规则".to_string());
        }
        Ok(())
    }

    fn validate_limited_sequence(
        &self,
        player_id: &str,
        pool_type: &str,
        time: &str,
        excluded_id: Option<i64>,
        target_is_off: bool,
    ) -> Result<(), String> {
        if !is_limited_char_pool(pool_type) || !target_is_off {
            return Ok(());
        }
        let (previous, next): (Option<i32>, Option<i32>) = if let Some(excluded_id) = excluded_id {
            let previous = self
                .conn
                .query_row(
                    "SELECT is_off_rate FROM gacha_records
                     WHERE player_id = ?1 AND card_pool_type = ?2 AND quality_level = 5
                       AND id != ?3 AND (time < ?4 OR (time = ?4 AND id > ?3))
                     ORDER BY time DESC, id ASC LIMIT 1",
                    params![player_id, pool_type, excluded_id, time],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            let next = self
                .conn
                .query_row(
                    "SELECT is_off_rate FROM gacha_records
                     WHERE player_id = ?1 AND card_pool_type = ?2 AND quality_level = 5
                       AND id != ?3 AND (time > ?4 OR (time = ?4 AND id < ?3))
                     ORDER BY time ASC, id DESC LIMIT 1",
                    params![player_id, pool_type, excluded_id, time],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            (previous, next)
        } else {
            let previous = self
                .conn
                .query_row(
                    "SELECT is_off_rate FROM gacha_records
                     WHERE player_id = ?1 AND card_pool_type = ?2 AND quality_level = 5
                       AND time < ?3
                     ORDER BY time DESC, id ASC LIMIT 1",
                    params![player_id, pool_type, time],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            let next = self
                .conn
                .query_row(
                    "SELECT is_off_rate FROM gacha_records
                     WHERE player_id = ?1 AND card_pool_type = ?2 AND quality_level = 5
                       AND time >= ?3
                     ORDER BY time ASC, id DESC LIMIT 1",
                    params![player_id, pool_type, time],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            (previous, next)
        };
        if previous == Some(1) {
            return Err("插入位置前一个五星已经歪了，下一次五星必须为 UP 角色".to_string());
        }
        if next == Some(1) {
            return Err("插入后会与后一个歪五星连续，违反限定角色池保底规则".to_string());
        }
        Ok(())
    }

    /// 获取所有玩家 ID
    pub fn get_player_ids(&self) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT player_id FROM gacha_records")
            .map_err(|e| e.to_string())?;
        let ids = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }

    pub fn get_record_summaries(&self) -> Result<Vec<RecordSummary>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT gr.player_id, COUNT(*), MIN(gr.time), MAX(gr.time),
                        pii.last_imported_at, pii.is_inferred
                 FROM gacha_records gr
                 LEFT JOIN player_import_info pii ON gr.player_id = pii.player_id
                 GROUP BY gr.player_id
                 ORDER BY gr.player_id",
            )
            .map_err(|e| e.to_string())?;
        let summaries = stmt
            .query_map([], |row| {
                Ok(RecordSummary {
                    player_id: row.get(0)?,
                    record_count: row.get::<_, i64>(1)? as usize,
                    earliest_time: row.get(2)?,
                    latest_time: row.get(3)?,
                    last_imported_at: row.get(4)?,
                    is_inferred: row.get::<_, Option<i32>>(5)?.map(|v| v != 0),
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|result| result.ok())
            .collect();
        Ok(summaries)
    }

    /// 记录一次所有官方卡池均成功返回的完整同步。
    pub fn update_import_info(&self, player_id: &str) -> Result<(), String> {
        let now = current_datetime();
        self.conn
            .execute(
                "INSERT INTO player_import_info (player_id, last_imported_at, is_inferred)
                 VALUES (?1, ?2, 0)
                 ON CONFLICT(player_id) DO UPDATE SET
                    last_imported_at = excluded.last_imported_at,
                    is_inferred = 0",
                params![player_id, now],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn confirmed_pool_boundaries(&self, player_id: &str) -> Result<HashSet<String>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT b.card_pool_type
             FROM pool_history_boundaries b
             WHERE b.player_id = ?1
               AND b.earliest_time = (
                   SELECT MIN(r.time) FROM gacha_records r
                   WHERE r.player_id = b.player_id AND r.card_pool_type = b.card_pool_type AND r.is_mock = 0
               )
               AND b.earliest_time_count = (
                   SELECT COUNT(*) FROM gacha_records r
                   WHERE r.player_id = b.player_id AND r.card_pool_type = b.card_pool_type
                     AND r.time = b.earliest_time AND r.is_mock = 0
               )"
        ).map_err(|e| e.to_string())?;
        let confirmed = stmt
            .query_map(params![player_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        Ok(confirmed)
    }

    pub fn set_pool_boundary_confirmed(
        &self,
        player_id: &str,
        pool_type: &str,
        confirmed: bool,
    ) -> Result<(), String> {
        if !confirmed {
            self.conn.execute(
                "DELETE FROM pool_history_boundaries WHERE player_id = ?1 AND card_pool_type = ?2",
                params![player_id, pool_type],
            ).map_err(|e| e.to_string())?;
            return Ok(());
        }

        let earliest_time: String = self.conn.query_row(
            "SELECT MIN(time) FROM gacha_records WHERE player_id = ?1 AND card_pool_type = ?2 AND is_mock = 0",
            params![player_id, pool_type],
            |row| row.get::<_, Option<String>>(0),
        ).map_err(|e| e.to_string())?
            .ok_or_else(|| "该卡池没有可确认的记录".to_string())?;
        let earliest_time_count: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM gacha_records
             WHERE player_id = ?1 AND card_pool_type = ?2 AND time = ?3 AND is_mock = 0",
                // Only official history can establish or invalidate this boundary.
                params![player_id, pool_type, earliest_time],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "INSERT INTO pool_history_boundaries
             (player_id, card_pool_type, earliest_time, earliest_time_count, confirmed_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(player_id, card_pool_type) DO UPDATE SET
               earliest_time = excluded.earliest_time,
               earliest_time_count = excluded.earliest_time_count,
               confirmed_at = excluded.confirmed_at",
                params![
                    player_id,
                    pool_type,
                    earliest_time,
                    earliest_time_count,
                    current_datetime()
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn create_backup(&self) -> Result<Option<String>, String> {
        let Some(db_path) = &self.path else {
            return Ok(None);
        };
        let app_data_dir = db_path
            .parent()
            .ok_or_else(|| "无法确定数据库备份目录".to_string())?;
        let backup_dir = app_data_dir.join("backups");
        std::fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败: {e}"))?;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("生成备份时间戳失败: {e}"))?
            .as_millis();
        let backup_path = backup_dir.join(format!("gacha-before-delete-{timestamp}.db"));
        let backup_path_text = backup_path.to_string_lossy().into_owned();
        self.conn
            .execute("VACUUM main INTO ?1", params![backup_path_text])
            .map_err(|e| format!("删除前备份失败，未清空任何数据: {e}"))?;
        Ok(Some(backup_path.to_string_lossy().into_owned()))
    }

    /// 删除前创建完整数据库备份，再清空指定玩家或全部记录。
    pub fn clear_records(&self, player_id: Option<&str>) -> Result<ClearRecordsResult, String> {
        let record_count: usize = if let Some(pid) = player_id {
            self.conn
                .query_row(
                    "SELECT COUNT(*) FROM gacha_records WHERE player_id = ?1",
                    params![pid],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|e| e.to_string())? as usize
        } else {
            self.conn
                .query_row("SELECT COUNT(*) FROM gacha_records", [], |row| {
                    row.get::<_, i64>(0)
                })
                .map_err(|e| e.to_string())? as usize
        };

        if record_count == 0 {
            if let Some(pid) = player_id {
                self.conn
                    .execute(
                        "DELETE FROM player_import_info WHERE player_id = ?1",
                        params![pid],
                    )
                    .map_err(|e| e.to_string())?;
                self.conn
                    .execute(
                        "DELETE FROM pool_history_boundaries WHERE player_id = ?1",
                        params![pid],
                    )
                    .map_err(|e| e.to_string())?;
            } else {
                self.conn
                    .execute("DELETE FROM player_import_info", [])
                    .map_err(|e| e.to_string())?;
                self.conn
                    .execute("DELETE FROM pool_history_boundaries", [])
                    .map_err(|e| e.to_string())?;
            }
            return Ok(ClearRecordsResult {
                deleted_count: 0,
                backup_path: None,
            });
        }

        let backup_path = self.create_backup()?;
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        let deleted_count = if let Some(pid) = player_id {
            let deleted_count = tx
                .execute(
                    "DELETE FROM gacha_records WHERE player_id = ?1",
                    params![pid],
                )
                .map_err(|e| e.to_string())?;
            tx.execute(
                "DELETE FROM player_import_info WHERE player_id = ?1",
                params![pid],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "DELETE FROM pool_history_boundaries WHERE player_id = ?1",
                params![pid],
            )
            .map_err(|e| e.to_string())?;
            deleted_count
        } else {
            let deleted_count = tx
                .execute("DELETE FROM gacha_records", [])
                .map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM player_import_info", [])
                .map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM pool_history_boundaries", [])
                .map_err(|e| e.to_string())?;
            deleted_count
        };
        tx.commit().map_err(|e| e.to_string())?;

        Ok(ClearRecordsResult {
            deleted_count,
            backup_path,
        })
    }

    /// 保存游戏设置
    pub fn save_settings(&self, settings: &GameSettings) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM game_settings", [])
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "INSERT INTO game_settings (game_dir) VALUES (?1)",
                params![settings.game_dir],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 获取游戏设置
    pub fn get_settings(&self) -> Result<GameSettings, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT game_dir FROM game_settings LIMIT 1")
            .map_err(|e| e.to_string())?;
        let settings = stmt
            .query_row([], |row| {
                Ok(GameSettings {
                    game_dir: row.get(0)?,
                })
            })
            .unwrap_or_default();
        Ok(settings)
    }

    pub fn get_nanoka_cache(&self, cache_key: &str) -> Result<Option<CachedJson>, String> {
        match self.conn.query_row(
            "SELECT json, updated_at FROM nanoka_cache WHERE cache_key = ?1",
            params![cache_key],
            |row| {
                Ok(CachedJson {
                    json: row.get(0)?,
                    updated_at: row.get(1)?,
                })
            },
        ) {
            Ok(entry) => Ok(Some(entry)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn get_latest_nanoka_cache(&self, prefix: &str) -> Result<Option<CachedJson>, String> {
        let pattern = format!("{prefix}%");
        match self.conn.query_row(
            "SELECT json, updated_at FROM nanoka_cache WHERE cache_key LIKE ?1 ORDER BY updated_at DESC LIMIT 1",
            params![pattern],
            |row| {
                Ok(CachedJson {
                    json: row.get(0)?,
                    updated_at: row.get(1)?,
                })
            },
        ) {
            Ok(entry) => Ok(Some(entry)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn set_nanoka_cache(
        &self,
        cache_key: &str,
        json: &str,
        updated_at: i64,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO nanoka_cache (cache_key, json, updated_at) VALUES (?1, ?2, ?3)\
                 ON CONFLICT(cache_key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
                params![cache_key, json, updated_at],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

fn pool_five_star_resource_type(pool_type: &str) -> Option<&'static str> {
    match pool_type {
        "1" | "3" | "5" | "6" | "7" | "8" | "10" | "12" => Some("role"),
        "2" | "4" | "9" | "11" | "13" => Some("weapon"),
        _ => None,
    }
}

fn validate_resource_for_pool(pool_type: &str, resource: &GachaResource) -> Result<(), String> {
    let expected =
        pool_five_star_resource_type(pool_type).ok_or_else(|| "不支持的卡池类型".to_string())?;
    if resource.quality_level == 5 && resource.resource_type != expected {
        return Err(if expected == "role" {
            "该卡池只能选择五星角色".to_string()
        } else {
            "该卡池只能选择五星武器".to_string()
        });
    }
    if resource.quality_level == 5
        && matches!(pool_type, "3" | "5" | "6" | "7")
        && !STANDARD_FIVE_STAR_CHAR_IDS.contains(&resource.resource_id)
    {
        return Err("该卡池只能选择常驻五星角色".to_string());
    }
    Ok(())
}

fn is_off_rate(pool_type: &str, resource: &GachaResource) -> bool {
    resource.quality_level == 5
        && resource.resource_type == "role"
        && is_limited_char_pool(pool_type)
        && STANDARD_FIVE_STAR_CHAR_IDS.contains(&resource.resource_id)
}

fn validate_filler_guarantee(
    fillers: &[GachaResource],
    initial_three_star_streak: usize,
    following_three_star_prefix: usize,
) -> Result<(), String> {
    // Include adjacent real records so a locally valid generated sequence cannot
    // create ten consecutive three-stars at either insertion boundary.
    let mut streak = initial_three_star_streak;
    for resource in fillers {
        if resource.quality_level == 3 {
            streak += 1;
            if streak > 9 {
                return Err("补足记录违反每 10 抽至少出现一个四星或以上物品的规则".to_string());
            }
        } else {
            streak = 0;
        }
    }
    if streak + following_three_star_prefix > 9 {
        return Err("补足记录与后续记录衔接后违反四星保底规则".to_string());
    }
    Ok(())
}

fn insert_mock_row(
    tx: &Transaction<'_>,
    player_id: &str,
    pool_type: &str,
    resource: &GachaResource,
    time: &str,
    batch_id: &str,
    preferred_order: i64,
) -> Result<i64, String> {
    let occurrence_no: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(occurrence_no), -1) + 1 FROM gacha_records
         WHERE player_id = ?1 AND card_pool_type = ?2 AND time = ?3
           AND resource_id = ?4 AND quality_level = ?5 AND resource_type = ?6 AND count = 1",
            params![
                player_id,
                pool_type,
                time,
                resource.resource_id,
                resource.quality_level,
                resource.resource_type
            ],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let current_max_order: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(order_in_timestamp), -1) FROM gacha_records
         WHERE player_id = ?1 AND card_pool_type = ?2 AND time = ?3",
            params![player_id, pool_type, time],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let order_in_timestamp = current_max_order.max(preferred_order - 1) + 1;
    tx.execute(
        "INSERT INTO gacha_records
         (player_id, card_pool_type, card_pool_name, resource_id, quality_level,
          resource_type, name, count, time, is_off_rate, occurrence_no,
          order_in_timestamp, is_mock, mock_batch_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?9, ?10, ?11, 1, ?12)",
        params![
            player_id,
            pool_type,
            get_display_pool_name(pool_type),
            resource.resource_id,
            resource.quality_level,
            resource.resource_type,
            resource.name,
            time,
            is_off_rate(pool_type, resource) as i32,
            occurrence_no,
            order_in_timestamp,
            batch_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(tx.last_insert_rowid())
}

fn move_mock_fillers(
    tx: &Transaction<'_>,
    batch_id: &str,
    player_id: &str,
    pool_type: &str,
    old_target_time: &str,
    before_time: &str,
    after_time: &str,
) -> Result<(), String> {
    // Legacy batches contain only pre-target rows. New batches are split by
    // their position relative to the old five-star, avoiding a schema migration.
    let rows: Vec<(i64, i64, i32, String, i32, String)> = {
        let mut stmt = tx
            .prepare(
                "SELECT id, resource_id, quality_level, resource_type, count, time
             FROM gacha_records
             WHERE is_mock = 1 AND mock_batch_id = ?1 AND quality_level != 5
             ORDER BY id ASC",
            )
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map(params![batch_id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        mapped
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    if rows.is_empty() {
        return Ok(());
    }

    let temporary_time = format!("__mock_move__{batch_id}");
    tx.execute(
        "UPDATE gacha_records SET time = ?1, occurrence_no = id, order_in_timestamp = id
         WHERE is_mock = 1 AND mock_batch_id = ?2 AND quality_level != 5",
        params![temporary_time, batch_id],
    )
    .map_err(|e| e.to_string())?;

    for (move_after_target, target_time) in [(false, before_time), (true, after_time)] {
        let segment: Vec<_> = rows
            .iter()
            .filter(|row| (row.5.as_str() >= old_target_time) == move_after_target)
            .collect();
        if segment.is_empty() {
            continue;
        }
        let first_order_in_timestamp: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(order_in_timestamp), -1) + 1 FROM gacha_records
             WHERE player_id = ?1 AND card_pool_type = ?2 AND time = ?3",
                params![player_id, pool_type, target_time],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let mut occurrences: HashMap<(i64, i32, String, i32), i64> = HashMap::new();

        for (offset, (id, resource_id, quality, resource_type, count, _)) in
            segment.into_iter().enumerate()
        {
            let order_in_timestamp = first_order_in_timestamp + offset as i64;
            let key = (*resource_id, *quality, resource_type.clone(), *count);
            let occurrence_no = if let Some(next) = occurrences.get_mut(&key) {
                let current = *next;
                *next += 1;
                current
            } else {
                let first: i64 = tx.query_row(
                    "SELECT COALESCE(MAX(occurrence_no), -1) + 1 FROM gacha_records
                     WHERE player_id = ?1 AND card_pool_type = ?2 AND time = ?3
                       AND resource_id = ?4 AND quality_level = ?5 AND resource_type = ?6 AND count = ?7",
                    params![player_id, pool_type, target_time, resource_id, quality, resource_type, count],
                    |row| row.get(0),
                ).map_err(|e| e.to_string())?;
                occurrences.insert(key, first + 1);
                first
            };
            tx.execute(
                "UPDATE gacha_records
                 SET card_pool_type = ?1, card_pool_name = ?2, time = ?3,
                     occurrence_no = ?4, order_in_timestamp = ?5
                 WHERE id = ?6 AND is_mock = 1",
                params![
                    pool_type,
                    get_display_pool_name(pool_type),
                    target_time,
                    occurrence_no,
                    order_in_timestamp,
                    id,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_database() -> Database {
        let db = Database {
            conn: Connection::open_in_memory().unwrap(),
            path: None,
        };
        db.init_tables().unwrap();
        db.migrate().unwrap();
        db
    }

    fn record(pool_type: &str, resource_id: i64, time: &str) -> GachaRecord {
        GachaRecord {
            id: None,
            player_id: "10001".to_string(),
            card_pool_type: pool_type.to_string(),
            card_pool_name: format!("卡池 {pool_type}"),
            card_pool_group: "测试池".to_string(),
            resource_id,
            quality_level: 3,
            resource_type: "weapon".to_string(),
            name: format!("武器 {resource_id}"),
            count: 1,
            time: time.to_string(),
            is_off_rate: false,
            is_mock: false,
            mock_batch_id: None,
        }
    }

    fn resource(
        resource_id: i64,
        name: &str,
        quality_level: i32,
        resource_type: &str,
    ) -> GachaResource {
        GachaResource {
            resource_id,
            name: name.to_string(),
            quality_level,
            resource_type: resource_type.to_string(),
        }
    }

    #[test]
    fn beginner_role_pools_only_accept_the_five_standard_characters() {
        let jianxin = resource(1301, "鉴心", 5, "role");
        let limited = resource(9999, "限定角色", 5, "role");

        for pool_type in ["3", "5", "6", "7"] {
            assert!(validate_resource_for_pool(pool_type, &jianxin).is_ok());
            assert!(validate_resource_for_pool(pool_type, &limited).is_err());
        }
        assert!(validate_resource_for_pool("1", &limited).is_ok());
    }

    #[test]
    fn confirmed_boundary_expires_when_earlier_official_history_arrives() {
        let db = test_database();
        db.merge_records(&[record("12", 2001, "2026-01-02 00:00:00")])
            .unwrap();
        db.set_pool_boundary_confirmed("10001", "12", true).unwrap();
        assert!(db
            .confirmed_pool_boundaries("10001")
            .unwrap()
            .contains("12"));

        db.merge_records(&[record("12", 2002, "2026-01-01 00:00:00")])
            .unwrap();
        assert!(!db
            .confirmed_pool_boundaries("10001")
            .unwrap()
            .contains("12"));
    }

    #[test]
    fn beginner_pool_uses_50_pity_while_select_pool_keeps_80() {
        let db = test_database();
        let error = db
            .mock_insert_plan("10001", "5", "2026-01-01 00:00:00", 51)
            .unwrap_err();
        assert!(error.contains("1 到 50"));

        let plan = db
            .mock_insert_plan("10001", "6", "2026-01-01 00:00:00", 80)
            .unwrap();
        assert_eq!(plan.required_draws, 80);
    }

    fn valid_filler_resources(
        count: usize,
        initial_three_star_streak: usize,
        following_three_star_prefix: usize,
    ) -> Vec<GachaResource> {
        let mut streak = initial_three_star_streak;
        (0..count)
            .map(|index| {
                let use_four_star = streak >= 9
                    || (index + 1 == count && streak + 1 + following_three_star_prefix > 9);
                if use_four_star {
                    streak = 0;
                    resource(21020013, "教学长刃", 4, "weapon")
                } else {
                    streak += 1;
                    resource(21010013, "训练长刃", 3, "weapon")
                }
            })
            .collect()
    }

    fn five_star_pities(records: &[GachaRecord], pool_type: &str) -> Vec<(String, i32)> {
        let mut records: Vec<_> = records
            .iter()
            .filter(|record| record.card_pool_type == pool_type)
            .collect();
        records.sort_by(|a, b| a.time.cmp(&b.time).then_with(|| b.id.cmp(&a.id)));
        let mut pity = 0;
        let mut result = Vec::new();
        for record in records {
            pity += 1;
            if record.quality_level == 5 {
                result.push((record.name.clone(), pity));
                pity = 0;
            }
        }
        result
    }

    #[test]
    fn importing_the_same_snapshot_twice_adds_nothing() {
        let db = test_database();
        let snapshot = vec![
            record("1", 101, "2026-06-01 12:00:00"),
            record("1", 102, "2026-05-01 12:00:00"),
        ];

        let first = db.merge_records(&snapshot).unwrap();
        let second = db.merge_records(&snapshot).unwrap();

        assert_eq!(first.added_count, 2);
        assert_eq!(first.added_ids.len(), 2);
        assert_ne!(first.added_ids[0], first.added_ids[1]);
        assert_eq!(second.added_count, 0);
        assert!(second.added_ids.is_empty());
        assert_eq!(second.duplicate_count, 2);
        assert_eq!(db.get_all_records(Some("10001")).unwrap().len(), 2);
    }

    #[test]
    fn preview_merge_matches_import_without_writing_records() {
        let db = test_database();
        let existing = record("1", 101, "2026-06-01 12:00:00");
        db.merge_records(&[existing.clone()]).unwrap();
        let snapshot = vec![
            existing,
            record("1", 102, "2026-05-01 12:00:00"),
            record("2", 201, "2026-04-01 12:00:00"),
        ];

        let preview = db.preview_merge_records(&snapshot).unwrap();
        assert_eq!(preview.imported_count, 3);
        assert_eq!(preview.added_count, 2);
        assert_eq!(preview.duplicate_count, 1);
        assert_eq!(db.get_all_records(Some("10001")).unwrap().len(), 1);

        let imported = db.merge_records(&snapshot).unwrap();
        assert_eq!(imported.added_count, preview.added_count);
        assert_eq!(imported.duplicate_count, preview.duplicate_count);
        assert_eq!(db.get_all_records(Some("10001")).unwrap().len(), 3);
    }

    #[test]
    fn overlapping_snapshots_keep_old_and_new_edges() {
        let db = test_database();
        let old = vec![
            record("1", 101, "2026-06-01 12:00:00"),
            record("1", 102, "2026-01-01 12:00:00"),
        ];
        let new = vec![
            record("1", 103, "2026-07-01 12:00:00"),
            record("1", 101, "2026-06-01 12:00:00"),
        ];

        db.merge_records(&old).unwrap();
        let result = db.merge_records(&new).unwrap();

        assert_eq!(result.added_count, 1);
        assert_eq!(result.duplicate_count, 1);
        assert_eq!(db.get_all_records(Some("10001")).unwrap().len(), 3);
    }

    #[test]
    fn disjoint_snapshots_and_different_pools_are_all_preserved() {
        let db = test_database();
        db.merge_records(&[
            record("1", 101, "2026-01-01 12:00:00"),
            record("2", 101, "2026-01-01 12:00:00"),
        ])
        .unwrap();

        let result = db
            .merge_records(&[record("1", 102, "2026-07-01 12:00:00")])
            .unwrap();
        let records = db.get_all_records(Some("10001")).unwrap();

        assert_eq!(result.added_count, 1);
        assert_eq!(records.len(), 3);
        assert_eq!(
            records.iter().filter(|r| r.card_pool_type == "1").count(),
            2
        );
        assert_eq!(
            records.iter().filter(|r| r.card_pool_type == "2").count(),
            1
        );
    }

    #[test]
    fn identical_records_in_the_same_second_keep_the_highest_multiplicity() {
        let db = test_database();
        let duplicate = record("1", 101, "2026-06-01 12:00:00");

        db.merge_records(&[duplicate.clone(), duplicate.clone()])
            .unwrap();
        let result = db
            .merge_records(&[duplicate.clone(), duplicate.clone(), duplicate])
            .unwrap();

        assert_eq!(result.added_count, 1);
        assert_eq!(result.duplicate_count, 2);
        assert_eq!(db.get_all_records(Some("10001")).unwrap().len(), 3);
    }

    #[test]
    fn clearing_one_player_preserves_other_players() {
        let db = test_database();
        let first = record("1", 101, "2026-01-01 12:00:00");
        let mut second = record("1", 102, "2026-02-01 12:00:00");
        second.player_id = "20002".to_string();
        db.merge_records(&[first]).unwrap();
        db.merge_records(&[second]).unwrap();

        let result = db.clear_records(Some("10001")).unwrap();

        assert_eq!(result.deleted_count, 1);
        assert_eq!(db.get_all_records(Some("10001")).unwrap().len(), 0);
        assert_eq!(db.get_all_records(Some("20002")).unwrap().len(), 1);
    }

    #[test]
    fn completed_sync_replaces_inferred_import_time() {
        let db = test_database();
        db.conn
            .execute(
                "INSERT INTO player_import_info (player_id, last_imported_at, is_inferred) VALUES (?1, ?2, 1)",
                params!["10001", "2025-01-01 00:00:00"],
            )
            .unwrap();

        db.update_import_info("10001").unwrap();

        let (last_imported_at, is_inferred): (String, i32) = db
            .conn
            .query_row(
                "SELECT last_imported_at, is_inferred FROM player_import_info WHERE player_id = ?1",
                params!["10001"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_ne!(last_imported_at, "2025-01-01 00:00:00");
        assert_eq!(is_inferred, 0);
    }

    #[test]
    fn migration_infers_import_time_from_real_records_only() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let test_dir = std::env::temp_dir().join(format!("wuwa-gacha-inference-test-{unique}"));
        std::fs::create_dir_all(&test_dir).unwrap();
        let db_path = test_dir.join("gacha.db");
        let db = Database::new(&db_path).unwrap();
        let real = record("1", 101, "2026-01-01 12:00:00");
        let mock = record("1", 102, "2026-07-01 12:00:00");
        db.merge_records(&[real, mock]).unwrap();
        db.conn
            .execute(
                "UPDATE gacha_records SET is_mock = 1, mock_batch_id = 'test' WHERE resource_id = 102",
                [],
            )
            .unwrap();
        db.conn
            .execute("DELETE FROM player_import_info", [])
            .unwrap();
        drop(db);

        let reopened = Database::new(&db_path).unwrap();
        let summary = reopened.get_record_summaries().unwrap().remove(0);
        assert_eq!(
            summary.last_imported_at.as_deref(),
            Some("2026-01-01 12:00:00")
        );
        assert_eq!(summary.is_inferred, Some(true));

        drop(reopened);
        std::fs::remove_dir_all(test_dir).unwrap();
    }

    #[test]
    fn migration_does_not_infer_sync_for_mock_only_player() {
        let db = test_database();
        let mock = record("1", 101, "2026-07-01 12:00:00");
        db.merge_records(&[mock]).unwrap();
        db.conn
            .execute(
                "UPDATE gacha_records SET is_mock = 1, mock_batch_id = 'test'",
                [],
            )
            .unwrap();

        db.migrate().unwrap();

        let count: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM player_import_info", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn clearing_empty_player_removes_orphaned_import_info() {
        let db = test_database();
        db.conn
            .execute(
                "INSERT INTO player_import_info (player_id, last_imported_at, is_inferred) VALUES (?1, ?2, 0)",
                params!["10001", "2026-01-01 00:00:00"],
            )
            .unwrap();

        let result = db.clear_records(Some("10001")).unwrap();

        let count: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM player_import_info", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(result.deleted_count, 0);
        assert_eq!(count, 0);
    }

    #[test]
    fn file_database_is_backed_up_before_records_are_deleted() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let test_dir = std::env::temp_dir().join(format!("wuwa-gacha-backup-test-{unique}"));
        std::fs::create_dir_all(&test_dir).unwrap();
        let db_path = test_dir.join("gacha.db");
        let db = Database::new(&db_path).unwrap();
        db.merge_records(&[record("1", 101, "2026-01-01 12:00:00")])
            .unwrap();

        let result = db.clear_records(None).unwrap();
        let backup_path = PathBuf::from(result.backup_path.unwrap());

        assert_eq!(result.deleted_count, 1);
        assert_eq!(db.get_all_records(None).unwrap().len(), 0);
        assert!(backup_path.exists());
        let backup = Connection::open(&backup_path).unwrap();
        let backup_count: i64 = backup
            .query_row("SELECT COUNT(*) FROM gacha_records", [], |row| row.get(0))
            .unwrap();
        assert_eq!(backup_count, 1);

        drop(backup);
        drop(db);
        std::fs::remove_dir_all(test_dir).unwrap();
    }

    #[test]
    fn nanoka_cache_round_trips_and_returns_latest_prefix_entry() {
        let db = test_database();
        db.set_nanoka_cache("catalog:3.5", "{\"version\":\"3.5\"}", 10)
            .unwrap();
        db.set_nanoka_cache("catalog:3.6", "{\"version\":\"3.6\"}", 20)
            .unwrap();

        assert_eq!(
            db.get_nanoka_cache("catalog:3.5").unwrap(),
            Some(CachedJson {
                json: "{\"version\":\"3.5\"}".to_string(),
                updated_at: 10,
            })
        );
        assert_eq!(
            db.get_latest_nanoka_cache("catalog:")
                .unwrap()
                .unwrap()
                .json,
            "{\"version\":\"3.6\"}"
        );
    }

    #[test]
    fn mock_batch_is_editable_without_exposing_real_records() {
        let db = test_database();
        let request = MockInsertRequest {
            player_id: "10001".to_string(),
            card_pool_type: "1".to_string(),
            resource: resource(1608, "穗穗", 5, "role"),
            pulls: 50,
            time: "2026-01-01 00:00:00".to_string(),
        };
        let fillers = valid_filler_resources(49, 0, 0);
        let inserted = db
            .insert_mock_batch(
                &request,
                &fillers,
                "2025-12-31 23:59:59",
                &[],
                "2026-01-01 00:00:01",
            )
            .unwrap();

        assert_eq!(inserted.len(), 50);
        assert!(inserted.iter().all(|record| record.is_mock));
        assert_eq!(
            inserted
                .iter()
                .filter(|record| record.quality_level == 5)
                .count(),
            1
        );
        assert_eq!(
            inserted
                .iter()
                .filter(|record| record.time == "2025-12-31 23:59:59")
                .count(),
            49
        );

        let filler_ids: Vec<i64> = inserted
            .iter()
            .filter(|record| record.quality_level == 3)
            .take(10)
            .filter_map(|record| record.id)
            .collect();
        for id in filler_ids {
            assert_eq!(db.delete_mock_record(id).unwrap(), 1);
        }
        let remaining = db.get_all_records(Some("10001")).unwrap();
        let stats = crate::gacha::parser::GachaStats::from_records(&remaining);
        let pool = stats
            .pools
            .iter()
            .find(|pool| pool.pool_type == "1")
            .unwrap();
        assert_eq!(remaining.len(), 40);
        assert_eq!(pool.avg_pity, 0.0);

        let five_star_id = remaining
            .iter()
            .find(|record| record.quality_level == 5)
            .unwrap()
            .id
            .unwrap();
        assert_eq!(db.delete_mock_record(five_star_id).unwrap(), 40);
        assert!(db.get_all_records(Some("10001")).unwrap().is_empty());

        db.merge_records(&[record("1", 101, "2026-02-01 00:00:00")])
            .unwrap();
        let real_id = db.get_all_records(Some("10001")).unwrap()[0].id.unwrap();
        assert_eq!(
            db.delete_mock_record(real_id).unwrap_err(),
            "真实导入记录不可删除"
        );
        let update = MockUpdateRequest {
            id: real_id,
            card_pool_type: "1".to_string(),
            resource: resource(101, "真实记录", 3, "weapon"),
            time: "2026-02-01 00:00:00".to_string(),
            filler_time: "2026-01-31 23:59:59".to_string(),
            after_filler_time: "2026-02-01 00:00:01".to_string(),
        };
        assert_eq!(
            db.update_mock_record(&update).unwrap_err(),
            "真实导入记录不可编辑"
        );
    }

    #[test]
    fn limited_character_pool_rejects_consecutive_off_rate_five_stars() {
        let db = test_database();
        let mut previous = record("1", 1104, "2026-01-01 00:00:00");
        previous.quality_level = 5;
        previous.resource_type = "role".to_string();
        previous.name = "维里奈".to_string();
        previous.is_off_rate = true;
        db.merge_records(&[previous]).unwrap();

        let request = MockInsertRequest {
            player_id: "10001".to_string(),
            card_pool_type: "1".to_string(),
            resource: resource(1203, "卡卡罗", 5, "role"),
            pulls: 1,
            time: "2026-02-01 00:00:00".to_string(),
        };
        let error = db
            .insert_mock_batch(
                &request,
                &[],
                "2026-01-31 23:59:59",
                &[],
                "2026-02-01 00:00:01",
            )
            .unwrap_err();
        assert!(error.contains("下一次五星必须为 UP"));
        assert_eq!(db.get_all_records(Some("10001")).unwrap().len(), 1);
    }

    #[test]
    fn all_limited_character_pools_reject_consecutive_off_rate_five_stars() {
        for pool_type in ["1", "8", "10", "12"] {
            let db = test_database();
            let mut previous = record(pool_type, 1104, "2026-01-01 00:00:00");
            previous.quality_level = 5;
            previous.resource_type = "role".to_string();
            previous.is_off_rate = true;
            db.merge_records(&[previous]).unwrap();
            let request = MockInsertRequest {
                player_id: "10001".to_string(),
                card_pool_type: pool_type.to_string(),
                resource: resource(1203, "卡卡罗", 5, "role"),
                pulls: 1,
                time: "2026-02-01 00:00:00".to_string(),
            };

            let error = db
                .insert_mock_batch(
                    &request,
                    &[],
                    "2026-01-31 23:59:59",
                    &[],
                    "2026-02-01 00:00:01",
                )
                .unwrap_err();
            assert!(
                error.contains("下一次五星必须为 UP"),
                "pool {pool_type}: {error}"
            );
        }
    }

    #[test]
    fn limited_pool_validation_uses_reverse_id_order_for_same_second_five_stars() {
        let db = test_database();
        let mut existing_up = record("1", 1608, "2026-02-01 00:00:00");
        existing_up.quality_level = 5;
        existing_up.resource_type = "role".to_string();
        let mut existing_off = record("1", 1104, "2026-02-01 00:00:00");
        existing_off.quality_level = 5;
        existing_off.resource_type = "role".to_string();
        existing_off.is_off_rate = true;
        db.merge_records(&[existing_up, existing_off]).unwrap();
        let request = MockInsertRequest {
            player_id: "10001".to_string(),
            card_pool_type: "1".to_string(),
            resource: resource(1203, "卡卡罗", 5, "role"),
            pulls: 1,
            time: "2026-02-01 00:00:00".to_string(),
        };

        let error = db
            .insert_mock_batch(
                &request,
                &[],
                "2026-01-31 23:59:59",
                &[],
                "2026-02-01 00:00:00",
            )
            .unwrap_err();
        assert!(error.contains("后一个歪五星"));
    }

    #[test]
    fn moving_same_second_up_five_star_cannot_join_two_off_rate_stars() {
        let db = test_database();
        let mut later_off = record("1", 1104, "2026-02-01 00:00:00");
        later_off.quality_level = 5;
        later_off.resource_type = "role".to_string();
        later_off.is_off_rate = true;
        db.merge_records(&[later_off]).unwrap();
        let request = MockInsertRequest {
            player_id: "10001".to_string(),
            card_pool_type: "1".to_string(),
            resource: resource(1608, "穗穗", 5, "role"),
            pulls: 1,
            time: "2026-02-01 00:00:00".to_string(),
        };
        let inserted = db
            .insert_mock_batch(
                &request,
                &[],
                "2026-01-31 23:59:59",
                &[],
                "2026-02-01 00:00:00",
            )
            .unwrap();
        let mock_id = inserted[0].id.unwrap();
        let mut earlier_off = record("1", 1203, "2026-02-01 00:00:00");
        earlier_off.quality_level = 5;
        earlier_off.resource_type = "role".to_string();
        earlier_off.is_off_rate = true;
        db.merge_records(&[earlier_off]).unwrap();

        let error = db
            .update_mock_record(&MockUpdateRequest {
                id: mock_id,
                card_pool_type: "1".to_string(),
                resource: resource(1608, "穗穗", 5, "role"),
                time: "2026-03-01 00:00:00".to_string(),
                filler_time: "2026-02-28 23:59:59".to_string(),
                after_filler_time: "2026-03-01 00:00:01".to_string(),
            })
            .unwrap_err();
        assert!(error.contains("原位置两次歪连续"));
        assert_eq!(
            db.get_all_records(Some("10001"))
                .unwrap()
                .into_iter()
                .find(|record| record.id == Some(mock_id))
                .unwrap()
                .time,
            "2026-02-01 00:00:00"
        );
    }

    #[test]
    fn mock_insert_rejects_fillers_that_break_the_four_star_guarantee_at_boundaries() {
        let db = test_database();
        let mut previous_five = record("3", 1601, "2026-01-01 00:00:00");
        previous_five.quality_level = 5;
        previous_five.resource_type = "role".to_string();
        let mut existing = vec![previous_five];
        for day in 2..=10 {
            existing.push(record("3", 101, &format!("2026-01-{day:02} 00:00:00")));
        }
        db.merge_records(&existing).unwrap();
        let request = MockInsertRequest {
            player_id: "10001".to_string(),
            card_pool_type: "3".to_string(),
            resource: resource(1301, "鉴心", 5, "role"),
            pulls: 11,
            time: "2026-02-01 00:00:00".to_string(),
        };
        let error = db
            .insert_mock_batch(
                &request,
                &[resource(21010013, "训练长刃", 3, "weapon")],
                "2026-01-31 23:59:59",
                &[],
                "2026-02-01 00:00:01",
            )
            .unwrap_err();
        assert!(error.contains("每 10 抽"), "unexpected error: {error}");

        let db = test_database();
        let mut previous_five = record("3", 1601, "2026-01-01 00:00:00");
        previous_five.quality_level = 5;
        previous_five.resource_type = "role".to_string();
        let mut boundary_four = record("3", 201, "2026-01-10 00:00:00");
        boundary_four.quality_level = 4;
        let mut next_five = record("3", 1602, "2026-03-01 00:00:00");
        next_five.quality_level = 5;
        next_five.resource_type = "role".to_string();
        let mut existing = vec![previous_five, boundary_four];
        for day in 2..=10 {
            existing.push(record("3", 101, &format!("2026-02-{day:02} 00:00:00")));
        }
        existing.push(next_five);
        db.merge_records(&existing).unwrap();
        let request = MockInsertRequest {
            player_id: "10001".to_string(),
            card_pool_type: "3".to_string(),
            resource: resource(1301, "鉴心", 5, "role"),
            pulls: 2,
            time: "2026-02-01 00:00:00".to_string(),
        };
        let error = db
            .insert_mock_batch(
                &request,
                &[],
                "2026-01-31 23:59:59",
                &[resource(21010013, "训练长刃", 3, "weapon")],
                "2026-02-01 00:00:01",
            )
            .unwrap_err();
        assert!(error.contains("衔接后"));
    }

    #[test]
    fn late_inserted_mock_rows_are_returned_by_time_not_sqlite_id() {
        let db = test_database();
        db.merge_records(&[record("1", 101, "2026-02-01 00:00:00")])
            .unwrap();
        let request = MockInsertRequest {
            player_id: "10001".to_string(),
            card_pool_type: "1".to_string(),
            resource: resource(1608, "穗穗", 5, "role"),
            pulls: 1,
            time: "2026-01-01 00:00:00".to_string(),
        };
        db.insert_mock_batch(
            &request,
            &[],
            "2025-12-31 23:59:59",
            &[],
            "2026-01-01 00:00:01",
        )
        .unwrap();

        let records = db.get_all_records(Some("10001")).unwrap();
        assert_eq!(records[0].time, "2026-02-01 00:00:00");
        assert_eq!(records[1].time, "2026-01-01 00:00:00");
        assert!(records[1].id > records[0].id);
    }

    #[test]
    fn stale_mock_insert_plan_is_rejected_without_partial_rows() {
        let db = test_database();
        assert_eq!(
            db.required_mock_draws("10001", "3", "2026-02-01 00:00:00", 10)
                .unwrap(),
            10
        );
        db.merge_records(&[record("3", 101, "2026-01-15 00:00:00")])
            .unwrap();
        let request = MockInsertRequest {
            player_id: "10001".to_string(),
            card_pool_type: "3".to_string(),
            resource: resource(1608, "穗穗", 5, "role"),
            pulls: 10,
            time: "2026-02-01 00:00:00".to_string(),
        };
        let stale_fillers = valid_filler_resources(9, 0, 0);

        assert_eq!(
            db.insert_mock_batch(
                &request,
                &stale_fillers,
                "2026-01-31 23:59:59",
                &[],
                "2026-02-01 00:00:01",
            )
            .unwrap_err(),
            "补足记录数量不正确"
        );
        let records = db.get_all_records(Some("10001")).unwrap();
        assert_eq!(records.len(), 1);
        assert!(!records[0].is_mock);
    }

    #[test]
    fn imported_real_record_is_not_deduplicated_against_a_matching_mock_row() {
        let db = test_database();
        let request = MockInsertRequest {
            player_id: "10001".to_string(),
            card_pool_type: "3".to_string(),
            resource: resource(1301, "鉴心", 5, "role"),
            pulls: 2,
            time: "2026-02-01 00:00:00".to_string(),
        };
        db.insert_mock_batch(
            &request,
            &[resource(21010013, "训练长刃", 3, "weapon")],
            "2026-01-31 23:59:59",
            &[],
            "2026-02-01 00:00:01",
        )
        .unwrap();
        let mut imported = record("3", 21010013, "2026-01-31 23:59:59");
        imported.name = "训练长刃".to_string();

        let first = db.merge_records(&[imported.clone()]).unwrap();
        let second = db.merge_records(&[imported]).unwrap();
        assert_eq!(first.added_count, 1);
        assert_eq!(second.added_count, 0);

        let matching: Vec<_> = db
            .get_all_records(Some("10001"))
            .unwrap()
            .into_iter()
            .filter(|record| record.resource_id == 21010013 && record.time == "2026-01-31 23:59:59")
            .collect();
        assert_eq!(matching.len(), 2);
        assert_eq!(matching.iter().filter(|record| record.is_mock).count(), 1);
        assert_eq!(matching.iter().filter(|record| !record.is_mock).count(), 1);
    }

    #[test]
    fn imported_mock_batch_is_idempotent_and_keeps_its_identity() {
        let db = test_database();
        let mut mock = record("3", 21010013, "2026-01-31 23:59:59");
        mock.name = "训练长刃".to_string();
        mock.is_mock = true;
        mock.mock_batch_id = Some("exported-batch".to_string());

        let first = db.merge_records(&[mock.clone(), mock.clone()]).unwrap();
        let second = db.merge_records(&[mock.clone(), mock]).unwrap();
        assert_eq!(first.added_count, 2);
        assert_eq!(second.added_count, 0);

        let records = db.get_all_records(Some("10001")).unwrap();
        assert_eq!(records.len(), 2);
        assert!(records.iter().all(|record| record.is_mock));
        assert!(records
            .iter()
            .all(|record| record.mock_batch_id.as_deref() == Some("exported-batch")));
    }

    #[test]
    fn mock_insert_plan_is_isolated_by_player_and_pool() {
        let db = test_database();
        let mut records = Vec::new();
        for day in 1..=7 {
            records.push(record(
                "3",
                100 + day,
                &format!("2026-01-{day:02} 00:00:00"),
            ));
            records.push(record(
                "4",
                200 + day,
                &format!("2026-01-{day:02} 01:00:00"),
            ));
        }
        let mut other_player = record("3", 999, "2026-01-20 00:00:00");
        other_player.player_id = "20002".to_string();
        records.push(other_player);
        db.merge_records(&records[..14]).unwrap();
        db.merge_records(&records[14..]).unwrap();

        let plan = db
            .mock_insert_plan("10001", "3", "2026-02-01 00:00:00", 10)
            .unwrap();
        assert_eq!(plan.existing_pity, 7);
        assert_eq!(plan.required_draws, 3);
    }

    #[test]
    fn mock_insert_only_fills_the_missing_pity_draws() {
        let db = test_database();
        let mut previous_five = record("1", 1601, "2026-01-01 00:00:00");
        previous_five.quality_level = 5;
        previous_five.resource_type = "role".to_string();
        let mut existing = vec![previous_five];
        for day in 2..=31 {
            let mut draw = record("1", 101, &format!("2026-01-{day:02} 00:00:00"));
            if (day - 1) % 10 == 0 {
                draw.quality_level = 4;
            }
            existing.push(draw);
        }
        db.merge_records(&existing).unwrap();

        assert_eq!(
            db.required_mock_draws("10001", "1", "2026-02-01 00:00:00", 70)
                .unwrap(),
            40
        );
        let request = MockInsertRequest {
            player_id: "10001".to_string(),
            card_pool_type: "1".to_string(),
            resource: resource(1608, "穗穗", 5, "role"),
            pulls: 70,
            time: "2026-02-01 00:00:00".to_string(),
        };
        let fillers = valid_filler_resources(39, 0, 0);
        let inserted = db
            .insert_mock_batch(
                &request,
                &fillers,
                "2026-01-31 23:59:59",
                &[],
                "2026-02-01 00:00:01",
            )
            .unwrap();
        let stats = crate::gacha::parser::GachaStats::from_records(
            &db.get_all_records(Some("10001")).unwrap(),
        );
        let pool = stats
            .pools
            .iter()
            .find(|pool| pool.pool_type == "1")
            .unwrap();

        assert_eq!(inserted.len(), 40);
        assert_eq!(pool.max_pity, 70);
    }

    #[test]
    fn middle_mock_insert_preserves_the_next_five_star_pity() {
        let db = test_database();
        let mut previous_five = record("3", 1601, "2026-01-01 00:00:00");
        previous_five.quality_level = 5;
        previous_five.resource_type = "role".to_string();
        previous_five.name = "前一个五星".to_string();
        let mut next_five = record("3", 1602, "2026-04-01 00:00:00");
        next_five.quality_level = 5;
        next_five.resource_type = "role".to_string();
        next_five.name = "后一个五星".to_string();

        let mut existing = vec![previous_five];
        for day in 2..=31 {
            let mut draw = record("3", 101, &format!("2026-01-{day:02} 00:00:00"));
            if (existing.len() - 1 + 1) % 10 == 0 {
                draw.quality_level = 4;
            }
            existing.push(draw);
        }
        for day in 1..=10 {
            let mut draw = record("3", 102, &format!("2026-02-{day:02} 00:00:00"));
            if (existing.len() - 1 + 1) % 10 == 0 {
                draw.quality_level = 4;
            }
            existing.push(draw);
        }
        for day in 2..=20 {
            let mut draw = record("3", 103, &format!("2026-03-{day:02} 00:00:00"));
            if (day - 1) % 10 == 0 {
                draw.quality_level = 4;
            }
            existing.push(draw);
        }
        existing.push(next_five);
        db.merge_records(&existing).unwrap();

        let plan = db
            .mock_insert_plan("10001", "3", "2026-03-01 00:00:00", 50)
            .unwrap();
        assert_eq!(plan.required_draws, 10);
        assert_eq!(plan.existing_pity, 40);
        assert_eq!(plan.after_filler_count(), 40);

        let request = MockInsertRequest {
            player_id: "10001".to_string(),
            card_pool_type: "3".to_string(),
            resource: resource(1301, "鉴心", 5, "role"),
            pulls: 50,
            time: "2026-03-01 00:00:00".to_string(),
        };
        let before_fillers = vec![resource(21010013, "训练长刃", 3, "weapon"); 9];
        let after_fillers = valid_filler_resources(40, 0, 9);
        let inserted = db
            .insert_mock_batch(
                &request,
                &before_fillers,
                "2026-02-28 23:59:59",
                &after_fillers,
                "2026-03-01 00:00:01",
            )
            .unwrap();

        assert_eq!(inserted.len(), 50);
        let records = db.get_all_records(Some("10001")).unwrap();
        assert_eq!(
            five_star_pities(&records, "3"),
            vec![
                ("前一个五星".to_string(), 1),
                ("鉴心".to_string(), 50),
                ("后一个五星".to_string(), 60),
            ]
        );

        let five_star_id = inserted
            .iter()
            .find(|record| record.quality_level == 5)
            .and_then(|record| record.id)
            .unwrap();
        db.update_mock_record(&MockUpdateRequest {
            id: five_star_id,
            card_pool_type: "3".to_string(),
            resource: resource(1301, "鉴心", 5, "role"),
            time: "2026-03-01 12:00:00".to_string(),
            filler_time: "2026-03-01 11:59:59".to_string(),
            after_filler_time: "2026-03-01 12:00:01".to_string(),
        })
        .unwrap();
        let moved = db.get_all_records(Some("10001")).unwrap();
        assert_eq!(
            moved
                .iter()
                .filter(|record| record.time == "2026-03-01 11:59:59")
                .count(),
            9
        );
        assert_eq!(
            moved
                .iter()
                .filter(|record| record.time == "2026-03-01 12:00:01")
                .count(),
            40
        );
        assert_eq!(
            five_star_pities(&moved, "3")[1..],
            [("鉴心".to_string(), 50), ("后一个五星".to_string(), 60),]
        );

        assert_eq!(db.delete_mock_record(five_star_id).unwrap(), 50);
        let restored = db.get_all_records(Some("10001")).unwrap();
        assert_eq!(
            five_star_pities(&restored, "3")[1],
            ("后一个五星".to_string(), 60)
        );
        assert!(restored.iter().all(|record| !record.is_mock));
    }

    #[test]
    fn middle_mock_insert_preserves_a_next_five_star_in_the_same_second() {
        let db = test_database();
        let mut previous_five = record("3", 1601, "2026-01-01 00:00:00");
        previous_five.quality_level = 5;
        previous_five.resource_type = "role".to_string();
        previous_five.name = "前一个五星".to_string();
        let mut next_five = record("3", 1602, "2026-02-01 00:00:00");
        next_five.quality_level = 5;
        next_five.resource_type = "role".to_string();
        next_five.name = "后一个五星".to_string();
        db.merge_records(&[
            previous_five,
            record("3", 101, "2026-01-10 00:00:00"),
            record("3", 102, "2026-01-20 00:00:00"),
            next_five,
        ])
        .unwrap();

        let plan = db
            .mock_insert_plan("10001", "3", "2026-02-01 00:00:00", 4)
            .unwrap();
        assert_eq!(plan.required_draws, 2);
        assert_eq!(plan.after_filler_count(), 2);
        assert_eq!(
            plan.next_five_star_time.as_deref(),
            Some("2026-02-01 00:00:00")
        );

        let request = MockInsertRequest {
            player_id: "10001".to_string(),
            card_pool_type: "3".to_string(),
            resource: resource(1301, "鉴心", 5, "role"),
            pulls: 4,
            time: "2026-02-01 00:00:00".to_string(),
        };
        db.insert_mock_batch(
            &request,
            &[resource(21010013, "训练长刃", 3, "weapon")],
            "2026-01-31 23:59:59",
            &vec![resource(21010013, "训练长刃", 3, "weapon"); 2],
            "2026-02-01 00:00:00",
        )
        .unwrap();

        assert_eq!(
            five_star_pities(&db.get_all_records(Some("10001")).unwrap(), "3"),
            vec![
                ("前一个五星".to_string(), 1),
                ("鉴心".to_string(), 4),
                ("后一个五星".to_string(), 3),
            ]
        );
    }

    #[test]
    fn middle_insert_pity_invariants_hold_across_boundary_matrix() {
        let cases = [
            (0, 1, 1),
            (0, 80, 80),
            (1, 2, 20),
            (9, 10, 20),
            (10, 50, 60),
            (40, 50, 60),
            (79, 80, 80),
        ];
        for (existing_pity, target_pity, next_pity) in cases {
            let db = test_database();
            let mut previous_five = record("3", 1601, "2026-01-01 00:00:00");
            previous_five.quality_level = 5;
            previous_five.resource_type = "role".to_string();
            previous_five.name = "前一个五星".to_string();
            let mut next_five = record("3", 1602, "2026-01-04 00:00:00");
            next_five.quality_level = 5;
            next_five.resource_type = "role".to_string();
            next_five.name = "后一个五星".to_string();
            let mut existing = vec![previous_five];
            for draw_index in 1..next_pity {
                let before_target = draw_index <= existing_pity;
                let offset = if before_target {
                    draw_index
                } else {
                    draw_index - existing_pity
                };
                let day = if before_target { 1 } else { 3 };
                let mut draw = record(
                    "3",
                    100 + draw_index as i64,
                    &format!("2026-01-{day:02} 00:{:02}:{:02}", offset / 60, offset % 60),
                );
                if draw_index % 10 == 0 {
                    draw.quality_level = 4;
                }
                existing.push(draw);
            }
            existing.push(next_five);
            db.merge_records(&existing).unwrap();
            assert_eq!(
                five_star_pities(&db.get_all_records(Some("10001")).unwrap(), "3")[1].1,
                next_pity
            );

            let plan = db
                .mock_insert_plan("10001", "3", "2026-01-02 00:00:00", target_pity)
                .unwrap();
            let before_fillers = valid_filler_resources(
                plan.before_filler_count(),
                plan.three_star_streak_before,
                0,
            );
            let after_fillers =
                valid_filler_resources(plan.after_filler_count(), 0, plan.three_star_prefix_after);
            let request = MockInsertRequest {
                player_id: "10001".to_string(),
                card_pool_type: "3".to_string(),
                resource: resource(1301, "鉴心", 5, "role"),
                pulls: target_pity,
                time: "2026-01-02 00:00:00".to_string(),
            };
            let inserted = db
                .insert_mock_batch(
                    &request,
                    &before_fillers,
                    "2026-01-01 23:59:59",
                    &after_fillers,
                    "2026-01-02 00:00:01",
                )
                .unwrap();
            let pities = five_star_pities(&db.get_all_records(Some("10001")).unwrap(), "3");
            assert_eq!(inserted.len() as i32, target_pity);
            assert_eq!(pities[1], ("鉴心".to_string(), target_pity));
            assert_eq!(pities[2], ("后一个五星".to_string(), next_pity));
        }
    }

    #[test]
    fn moving_a_mock_five_star_moves_its_fillers_to_one_second_before() {
        let db = test_database();
        let request = MockInsertRequest {
            player_id: "10001".to_string(),
            card_pool_type: "1".to_string(),
            resource: resource(1608, "穗穗", 5, "role"),
            pulls: 10,
            time: "2026-01-01 00:00:00".to_string(),
        };
        let fillers = vec![resource(21010013, "训练长刃", 3, "weapon"); 9];
        let inserted = db
            .insert_mock_batch(
                &request,
                &fillers,
                "2025-12-31 23:59:59",
                &[],
                "2026-01-01 00:00:01",
            )
            .unwrap();
        let five_star_id = inserted
            .iter()
            .find(|record| record.quality_level == 5)
            .unwrap()
            .id
            .unwrap();

        db.update_mock_record(&MockUpdateRequest {
            id: five_star_id,
            card_pool_type: "1".to_string(),
            resource: resource(1608, "穗穗", 5, "role"),
            time: "2026-03-01 00:00:00".to_string(),
            filler_time: "2026-02-28 23:59:59".to_string(),
            after_filler_time: "2026-03-01 00:00:01".to_string(),
        })
        .unwrap();
        let records = db.get_all_records(Some("10001")).unwrap();

        assert_eq!(
            records
                .iter()
                .filter(|record| record.time == "2026-02-28 23:59:59")
                .count(),
            9
        );
        assert_eq!(
            records
                .iter()
                .filter(|record| record.time == "2026-03-01 00:00:00")
                .count(),
            1
        );
    }
}
