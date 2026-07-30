use rusqlite::{params, Connection};
use std::path::Path;

use crate::gacha::parser::{GachaRecord, GameSettings};

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        let db = Self { conn };
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
                    is_off_rate INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS game_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_dir TEXT NOT NULL
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
                    is_off_rate INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO gacha_records_new SELECT * FROM gacha_records;
                DROP TABLE gacha_records;
                ALTER TABLE gacha_records_new RENAME TO gacha_records;
                COMMIT;
            "#).map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    /// 替换抽卡记录：先删除该玩家所有记录，再全量插入
    pub fn replace_records(&self, records: &[GachaRecord]) -> Result<usize, String> {
        if records.is_empty() {
            return Ok(0);
        }
        let player_id = &records[0].player_id;
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM gacha_records WHERE player_id = ?1", params![player_id])
            .map_err(|e| e.to_string())?;
        let mut count = 0;
        for record in records {
            tx.execute(
                "INSERT INTO gacha_records
                 (player_id, card_pool_type, card_pool_name, resource_id, quality_level, resource_type, name, count, time, is_off_rate)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
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
                ],
            ).map_err(|e| e.to_string())?;
            count += 1;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(count)
    }

    /// 获取所有抽卡记录
    pub fn get_all_records(&self, player_id: Option<&str>) -> Result<Vec<GachaRecord>, String> {
        let sql = if player_id.is_some() {
            "SELECT id, player_id, card_pool_type, card_pool_name, resource_id, quality_level, resource_type, name, count, time, is_off_rate FROM gacha_records WHERE player_id = ?1 ORDER BY time DESC"
        } else {
            "SELECT id, player_id, card_pool_type, card_pool_name, resource_id, quality_level, resource_type, name, count, time, is_off_rate FROM gacha_records ORDER BY time DESC"
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

    /// 清空指定玩家的记录
    pub fn clear_records(&self, player_id: Option<&str>) -> Result<(), String> {
        if let Some(pid) = player_id {
            self.conn
                .execute("DELETE FROM gacha_records WHERE player_id = ?1", params![pid])
                .map_err(|e| e.to_string())?;
        } else {
            self.conn
                .execute("DELETE FROM gacha_records", [])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
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
}
