use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::gacha::parser::{ClearRecordsResult, GachaRecord, GameSettings, RecordSummary};

pub struct Database {
    conn: Connection,
    path: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MergeStats {
    pub imported_count: usize,
    pub added_count: usize,
    pub duplicate_count: usize,
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
                    order_in_timestamp INTEGER NOT NULL DEFAULT 0
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
                ",
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 数据库迁移
    fn migrate(&self) -> Result<(), String> {
        // 检查 is_off_rate 列是否存在
        let has_column: bool = self.conn
            .prepare("PRAGMA table_info(gacha_records)")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .any(|name| name == "is_off_rate");

        if !has_column {
            self.conn
                .execute("ALTER TABLE gacha_records ADD COLUMN is_off_rate INTEGER NOT NULL DEFAULT 0", [])
                .map_err(|e| e.to_string())?;
        }

        // 旧表有 UNIQUE(player_id, resource_id, time) 约束，会吞掉同秒重复记录
        // 检查是否还有该约束，如果有则重建表
        let has_unique: bool = self.conn
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='gacha_records'")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .next()
            .map(|sql| sql.contains("UNIQUE"))
            .unwrap_or(false);

        if has_unique {
            self.conn.execute_batch(r#"
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
            "#).map_err(|e| e.to_string())?;
        }

        let columns: Vec<String> = self.conn
            .prepare("PRAGMA table_info(gacha_records)")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get(1))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        let needs_occurrence_no = !columns.iter().any(|name| name == "occurrence_no");
        let needs_order = !columns.iter().any(|name| name == "order_in_timestamp");

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

        self.conn.execute_batch(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_gacha_record_occurrence
            ON gacha_records (
                player_id, card_pool_type, time, resource_id,
                quality_level, resource_type, count, occurrence_no
            );
            "#,
        ).map_err(|e| e.to_string())?;

        Ok(())
    }

    /// 增量合并抽卡记录。同池同秒允许出现多条完全相同的记录。
    pub fn merge_records(&self, records: &[GachaRecord]) -> Result<MergeStats, String> {
        if records.is_empty() {
            return Ok(MergeStats {
                imported_count: 0,
                added_count: 0,
                duplicate_count: 0,
            });
        }

        let first_player_id = &records[0].player_id;
        if records.iter().any(|record| record.player_id != *first_player_id) {
            return Err("一次导入中包含多个 UID，无法安全合并".to_string());
        }

        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut occurrence_counts: HashMap<(String, String, String, i64, i32, String, i32), i64> =
            HashMap::new();
        let mut timestamp_orders: HashMap<(String, String, String), i64> = HashMap::new();
        let mut added_count = 0;

        for record in records {
            let occurrence_key = (
                record.player_id.clone(),
                record.card_pool_type.clone(),
                record.time.clone(),
                record.resource_id,
                record.quality_level,
                record.resource_type.clone(),
                record.count,
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

            let inserted = tx.execute(
                "INSERT OR IGNORE INTO gacha_records
                 (player_id, card_pool_type, card_pool_name, resource_id, quality_level,
                  resource_type, name, count, time, is_off_rate, occurrence_no, order_in_timestamp)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
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
                    current_occurrence_no,
                    current_order,
                ],
            ).map_err(|e| e.to_string())?;

            if inserted == 1 {
                added_count += 1;
            } else {
                // 名称和歪率属于展示/派生信息，可随当前规则刷新。
                tx.execute(
                    "UPDATE gacha_records
                     SET card_pool_name = ?1, name = ?2, is_off_rate = ?3
                     WHERE player_id = ?4 AND card_pool_type = ?5 AND time = ?6
                       AND resource_id = ?7 AND quality_level = ?8 AND resource_type = ?9
                       AND count = ?10 AND occurrence_no = ?11",
                    params![
                        record.card_pool_name,
                        record.name,
                        record.is_off_rate as i32,
                        record.player_id,
                        record.card_pool_type,
                        record.time,
                        record.resource_id,
                        record.quality_level,
                        record.resource_type,
                        record.count,
                        current_occurrence_no,
                    ],
                ).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;

        Ok(MergeStats {
            imported_count: records.len(),
            added_count,
            duplicate_count: records.len() - added_count,
        })
    }

    /// 获取所有抽卡记录
    pub fn get_all_records(&self, player_id: Option<&str>) -> Result<Vec<GachaRecord>, String> {
        let sql = if player_id.is_some() {
            "SELECT id, player_id, card_pool_type, card_pool_name, resource_id, quality_level, resource_type, name, count, time, is_off_rate FROM gacha_records WHERE player_id = ?1 ORDER BY time DESC, order_in_timestamp ASC, id ASC"
        } else {
            "SELECT id, player_id, card_pool_type, card_pool_name, resource_id, quality_level, resource_type, name, count, time, is_off_rate FROM gacha_records ORDER BY time DESC, order_in_timestamp ASC, id ASC"
        };

        let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
        let map_record = |row: &rusqlite::Row| -> rusqlite::Result<GachaRecord> {
            let card_pool_type: String = row.get(2)?;
            let card_pool_group = crate::gacha::fetcher::get_pool_group(&card_pool_type).to_string();
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

    /// 获取所有玩家 ID
    pub fn get_player_ids(&self) -> Result<Vec<String>, String> {
        let mut stmt = self.conn
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
        let mut stmt = self.conn.prepare(
            "SELECT player_id, COUNT(*), MIN(time), MAX(time)
             FROM gacha_records
             GROUP BY player_id
             ORDER BY player_id",
        ).map_err(|e| e.to_string())?;
        let summaries = stmt
            .query_map([], |row| {
                Ok(RecordSummary {
                    player_id: row.get(0)?,
                    record_count: row.get::<_, i64>(1)? as usize,
                    earliest_time: row.get(2)?,
                    latest_time: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|result| result.ok())
            .collect();
        Ok(summaries)
    }

    fn create_backup(&self) -> Result<Option<String>, String> {
        let Some(db_path) = &self.path else {
            return Ok(None);
        };
        let app_data_dir = db_path
            .parent()
            .ok_or_else(|| "无法确定数据库备份目录".to_string())?;
        let backup_dir = app_data_dir.join("backups");
        std::fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("创建备份目录失败: {e}"))?;
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
                .query_row("SELECT COUNT(*) FROM gacha_records", [], |row| row.get::<_, i64>(0))
                .map_err(|e| e.to_string())? as usize
        };

        if record_count == 0 {
            return Ok(ClearRecordsResult {
                deleted_count: 0,
                backup_path: None,
            });
        }

        let backup_path = self.create_backup()?;
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let deleted_count = if let Some(pid) = player_id {
            tx.execute("DELETE FROM gacha_records WHERE player_id = ?1", params![pid])
                .map_err(|e| e.to_string())?
        } else {
            tx.execute("DELETE FROM gacha_records", [])
                .map_err(|e| e.to_string())?
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
        let mut stmt = self.conn
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

    pub fn set_nanoka_cache(&self, cache_key: &str, json: &str, updated_at: i64) -> Result<(), String> {
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
        }
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
        assert_eq!(second.added_count, 0);
        assert_eq!(second.duplicate_count, 2);
        assert_eq!(db.get_all_records(Some("10001")).unwrap().len(), 2);
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
        ]).unwrap();

        let result = db.merge_records(&[
            record("1", 102, "2026-07-01 12:00:00"),
        ]).unwrap();
        let records = db.get_all_records(Some("10001")).unwrap();

        assert_eq!(result.added_count, 1);
        assert_eq!(records.len(), 3);
        assert_eq!(records.iter().filter(|r| r.card_pool_type == "1").count(), 2);
        assert_eq!(records.iter().filter(|r| r.card_pool_type == "2").count(), 1);
    }

    #[test]
    fn identical_records_in_the_same_second_keep_the_highest_multiplicity() {
        let db = test_database();
        let duplicate = record("1", 101, "2026-06-01 12:00:00");

        db.merge_records(&[duplicate.clone(), duplicate.clone()]).unwrap();
        let result = db.merge_records(&[
            duplicate.clone(),
            duplicate.clone(),
            duplicate,
        ]).unwrap();

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
    fn file_database_is_backed_up_before_records_are_deleted() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let test_dir = std::env::temp_dir().join(format!("wuwa-gacha-backup-test-{unique}"));
        std::fs::create_dir_all(&test_dir).unwrap();
        let db_path = test_dir.join("gacha.db");
        let db = Database::new(&db_path).unwrap();
        db.merge_records(&[record("1", 101, "2026-01-01 12:00:00")]).unwrap();

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
        db.set_nanoka_cache("catalog:3.5", "{\"version\":\"3.5\"}", 10).unwrap();
        db.set_nanoka_cache("catalog:3.6", "{\"version\":\"3.6\"}", 20).unwrap();

        assert_eq!(
            db.get_nanoka_cache("catalog:3.5").unwrap(),
            Some(CachedJson {
                json: "{\"version\":\"3.5\"}".to_string(),
                updated_at: 10,
            })
        );
        assert_eq!(
            db.get_latest_nanoka_cache("catalog:").unwrap().unwrap().json,
            "{\"version\":\"3.6\"}"
        );
    }
}
