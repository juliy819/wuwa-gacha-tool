//! Versioned, provider-neutral sync payloads.
//!
//! This module deliberately does not read or write SQLite. Callers must pass
//! the decoded records through `Database::merge_records`, keeping sync and
//! official imports on the same transactional identity rules.

use crate::gacha::fetcher::{get_display_pool_name, get_pool_group};
use crate::gacha::parser::GachaRecord;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const SYNC_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEnvelope {
    pub schema_version: u32,
    pub uid: String,
    pub records: Vec<SyncRecord>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRecord {
    pub pool: String,
    pub time: String,
    pub resource_id: i64,
    pub quality: i32,
    pub resource_type: String,
    pub count: i32,
    pub occurrence_no: i64,
    pub order_in_timestamp: i64,
    pub pool_name: String,
    pub name: String,
    pub off_rate: bool,
    #[serde(default)]
    pub is_mock: bool,
    #[serde(default)]
    pub mock_batch_id: Option<String>,
}

impl SyncEnvelope {
    pub fn from_records(
        uid: &str,
        records: &[GachaRecord],
        updated_at: String,
    ) -> Result<Self, String> {
        if uid.is_empty() || records.iter().any(|record| record.player_id != uid) {
            return Err("同步数据必须只包含一个 UID".to_string());
        }
        let mut payload: Vec<_> = records.iter().map(SyncRecord::from_record).collect();
        let mut occurrences = HashMap::<String, i64>::new();
        let mut timestamp_orders = HashMap::<String, i64>::new();
        for record in &mut payload {
            let identity = format!(
                "{}\0{}\0{}\0{}\0{}\0{}\0{}\0{:?}",
                record.pool,
                record.time,
                record.resource_id,
                record.quality,
                record.resource_type,
                record.count,
                record.is_mock,
                record.mock_batch_id
            );
            record.occurrence_no = *occurrences.get(&identity).unwrap_or(&0);
            *occurrences.entry(identity).or_insert(0) += 1;
            let timestamp = format!("{}\0{}", record.pool, record.time);
            record.order_in_timestamp = *timestamp_orders.get(&timestamp).unwrap_or(&0);
            *timestamp_orders.entry(timestamp).or_insert(0) += 1;
        }
        payload.sort_by(|a, b| {
            a.time
                .cmp(&b.time)
                .then(a.pool.cmp(&b.pool))
                .then(a.order_in_timestamp.cmp(&b.order_in_timestamp))
                .then(a.occurrence_no.cmp(&b.occurrence_no))
                .then(a.resource_id.cmp(&b.resource_id))
        });
        Ok(Self {
            schema_version: SYNC_SCHEMA_VERSION,
            uid: uid.to_string(),
            records: payload,
            updated_at,
        })
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != SYNC_SCHEMA_VERSION {
            return Err(format!("不支持的同步数据版本: {}", self.schema_version));
        }
        if self.uid.is_empty()
            || self.uid.len() > 64
            || !self.uid.bytes().all(|value| value.is_ascii_digit())
        {
            return Err("同步数据缺少 UID".to_string());
        }
        chrono::DateTime::parse_from_rfc3339(&self.updated_at)
            .map_err(|_| "同步数据的更新时间格式无效".to_string())?;
        if self.records.len() > 200_000 {
            return Err("同步数据记录数量超过限制".to_string());
        }
        let mut occurrences = std::collections::HashSet::new();
        let mut orders = std::collections::HashSet::new();
        let mut occurrence_groups = HashMap::<String, Vec<i64>>::new();
        let mut order_groups = HashMap::<String, Vec<i64>>::new();
        for record in &self.records {
            if record.pool.is_empty() || record.time.is_empty() || record.resource_type.is_empty() {
                return Err("同步数据包含缺少卡池、时间或资源类型的记录".to_string());
            }
            chrono::NaiveDateTime::parse_from_str(&record.time, "%Y-%m-%d %H:%M:%S")
                .map_err(|_| "同步数据包含无效的记录时间".to_string())?;
            if !(1..=13).contains(&record.pool.parse::<i32>().unwrap_or_default())
                || !(3..=5).contains(&record.quality)
                || !matches!(record.resource_type.as_str(), "role" | "weapon")
                || record.resource_id < 1
                || record.name.len() > 256
                || record.pool_name.len() > 64
            {
                return Err("同步数据包含非法的卡池或资源字段".to_string());
            }
            if !record.is_mock && record.mock_batch_id.is_some() {
                return Err("官方记录不能携带模拟批次标识".to_string());
            }
            if record.occurrence_no < 0
                || record.order_in_timestamp < 0
                || !(1..=100).contains(&record.count)
            {
                return Err("同步数据包含非法的记录编号或数量".to_string());
            }
            let identity = format!(
                "{}\0{}\0{}\0{}\0{}\0{}\0{}\0{:?}",
                record.pool,
                record.time,
                record.resource_id,
                record.quality,
                record.resource_type,
                record.count,
                record.is_mock,
                record.mock_batch_id
            );
            occurrence_groups
                .entry(identity)
                .or_default()
                .push(record.occurrence_no);
            order_groups
                .entry(timestamp_key(record))
                .or_default()
                .push(record.order_in_timestamp);
            let occurrence = format!(
                "{}\0{}\0{}\0{}\0{}\0{}\0{}\0{:?}\0{}",
                record.pool,
                record.time,
                record.resource_id,
                record.quality,
                record.resource_type,
                record.count,
                record.is_mock,
                record.mock_batch_id,
                record.occurrence_no
            );
            if !occurrences.insert(occurrence) {
                return Err("同步数据包含重复的 occurrence 编号".to_string());
            }
            if !orders.insert((
                record.pool.clone(),
                record.time.clone(),
                record.order_in_timestamp,
            )) {
                return Err("同步数据包含冲突的同秒顺序".to_string());
            }
        }
        for values in occurrence_groups
            .values_mut()
            .chain(order_groups.values_mut())
        {
            values.sort_unstable();
            if values
                .iter()
                .enumerate()
                .any(|(index, value)| *value != index as i64)
            {
                return Err("同步数据的记录编号不连续".to_string());
            }
        }
        Ok(())
    }

    pub fn into_records(self) -> Result<Vec<GachaRecord>, String> {
        self.validate()?;
        let uid = self.uid;
        Ok(self
            .records
            .into_iter()
            .map(|record| record.into_record(&uid))
            .collect())
    }

    /// Merges a local snapshot with the last ETag-protected cloud snapshot.
    /// Cloud order is the tie-breaker for an overlapping timestamp; local-only
    /// records are appended deterministically and all positions are normalized.
    pub fn merge_with_cloud(&self, cloud: &Self, updated_at: String) -> Result<Self, String> {
        self.validate()?;
        cloud.validate()?;
        if self.uid != cloud.uid {
            return Err("本地与云端 UID 不一致，拒绝合并".to_string());
        }
        let mut selected = HashMap::<String, SyncRecord>::new();
        for record in &self.records {
            selected.insert(record_key(record), record.clone());
        }
        for record in &cloud.records {
            selected.insert(record_key(record), record.clone());
        }
        let mut timestamps = HashMap::<String, Vec<String>>::new();
        for record in &cloud.records {
            timestamps
                .entry(timestamp_key(record))
                .or_default()
                .push(record_key(record));
        }
        for record in &self.records {
            let keys = timestamps.entry(timestamp_key(record)).or_default();
            let key = record_key(record);
            if !keys.contains(&key) {
                keys.push(key);
            }
        }
        let mut merged = Vec::with_capacity(selected.len());
        let mut timestamp_keys: Vec<_> = timestamps.into_iter().collect();
        timestamp_keys.sort_by(|a, b| a.0.cmp(&b.0));
        for (_, keys) in timestamp_keys {
            for (order, key) in keys.into_iter().enumerate() {
                if let Some(mut record) = selected.remove(&key) {
                    record.order_in_timestamp = order as i64;
                    merged.push(record);
                }
            }
        }
        let result = Self {
            schema_version: SYNC_SCHEMA_VERSION,
            uid: self.uid.clone(),
            records: merged,
            updated_at,
        };
        result.validate()?;
        Ok(result)
    }
}

fn timestamp_key(record: &SyncRecord) -> String {
    format!("{}\0{}", record.pool, record.time)
}

fn record_key(record: &SyncRecord) -> String {
    format!(
        "{}\0{}\0{}\0{}\0{}\0{}\0{}\0{:?}\0{}",
        record.pool,
        record.time,
        record.resource_id,
        record.quality,
        record.resource_type,
        record.count,
        record.is_mock,
        record.mock_batch_id,
        record.occurrence_no
    )
}

impl SyncRecord {
    fn from_record(record: &GachaRecord) -> Self {
        Self {
            pool: record.card_pool_type.clone(),
            time: record.time.clone(),
            resource_id: record.resource_id,
            quality: record.quality_level,
            resource_type: record.resource_type.clone(),
            count: record.count,
            occurrence_no: 0,
            order_in_timestamp: 0,
            pool_name: record.card_pool_name.clone(),
            name: record.name.clone(),
            off_rate: record.is_off_rate,
            is_mock: record.is_mock,
            mock_batch_id: record.mock_batch_id.clone(),
        }
    }

    fn into_record(self, uid: &str) -> GachaRecord {
        GachaRecord {
            id: None,
            player_id: uid.to_string(),
            card_pool_type: self.pool.clone(),
            card_pool_name: if self.pool_name.is_empty() {
                get_display_pool_name(&self.pool).to_string()
            } else {
                self.pool_name
            },
            card_pool_group: get_pool_group(&self.pool).to_string(),
            resource_id: self.resource_id,
            quality_level: self.quality,
            resource_type: self.resource_type,
            name: self.name,
            count: self.count,
            time: self.time,
            is_off_rate: self.off_rate,
            is_mock: self.is_mock,
            mock_batch_id: self.mock_batch_id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: i64, time: &str) -> GachaRecord {
        GachaRecord {
            id: Some(id),
            player_id: "106485288".into(),
            card_pool_type: "1".into(),
            card_pool_name: "角色活动唤取".into(),
            card_pool_group: "UP角色池".into(),
            resource_id: id,
            quality_level: 3,
            resource_type: "weapon".into(),
            name: format!("r{id}"),
            count: 1,
            time: time.into(),
            is_off_rate: false,
            is_mock: false,
            mock_batch_id: None,
        }
    }

    #[test]
    fn payload_round_trip_preserves_identity_fields() {
        let source = record(100, "2026-01-01 00:00:01");
        let payload = SyncEnvelope::from_records(
            "106485288",
            &[source.clone()],
            "2026-09-02T00:00:00Z".into(),
        )
        .unwrap();
        let json = serde_json::to_string(&payload).unwrap();
        let decoded: SyncEnvelope = serde_json::from_str(&json).unwrap();
        let restored = decoded.into_records().unwrap().pop().unwrap();
        assert_eq!(restored.player_id, source.player_id);
        assert_eq!(restored.resource_id, source.resource_id);
        assert_eq!(restored.card_pool_type, source.card_pool_type);
        assert_eq!(restored.count, source.count);
    }

    #[test]
    fn rejects_mixed_uid_and_unknown_version() {
        let mut other = record(101, "2026-01-01 00:00:02");
        other.player_id = "106485289".into();
        assert!(
            SyncEnvelope::from_records("106485288", &[other], "2026-09-02T00:00:00Z".into())
                .is_err()
        );
        let mut payload =
            SyncEnvelope::from_records("106485288", &[], "2026-09-02T00:00:00Z".into()).unwrap();
        payload.schema_version = 2;
        assert!(payload.validate().is_err());
    }

    #[test]
    fn assigns_distinct_occurrences_and_rejects_conflicting_order() {
        let duplicate = record(100, "2026-01-01 00:00:01");
        let payload = SyncEnvelope::from_records(
            "106485288",
            &[duplicate.clone(), duplicate],
            "2026-09-02T00:00:00Z".into(),
        )
        .unwrap();
        assert_eq!(
            payload
                .records
                .iter()
                .map(|r| r.occurrence_no)
                .collect::<Vec<_>>(),
            vec![0, 1]
        );
        let mut conflict = payload;
        conflict.records[1].order_in_timestamp = 0;
        assert!(conflict.validate().is_err());
    }

    #[test]
    fn cloud_merge_uses_max_duplicate_multiplicity_and_convergent_order() {
        let duplicate = record(100, "2026-01-01 00:00:01");
        let local_only = record(101, "2026-01-01 00:00:01");
        let local = SyncEnvelope::from_records(
            "106485288",
            &[duplicate.clone(), duplicate.clone(), local_only],
            "2026-09-02T00:00:00Z".into(),
        )
        .unwrap();
        let cloud =
            SyncEnvelope::from_records("106485288", &[duplicate], "2026-09-02T00:00:01Z".into())
                .unwrap();
        let merged = local
            .merge_with_cloud(&cloud, "2026-09-02T00:00:02Z".into())
            .unwrap();
        assert_eq!(merged.records.len(), 3);
        assert_eq!(
            merged
                .records
                .iter()
                .filter(|r| r.resource_id == 100)
                .count(),
            2
        );
        assert_eq!(
            merged
                .records
                .iter()
                .map(|r| r.order_in_timestamp)
                .collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        let repeated = merged
            .merge_with_cloud(&merged, "2026-09-02T00:00:03Z".into())
            .unwrap();
        assert_eq!(
            repeated.records.iter().map(record_key).collect::<Vec<_>>(),
            merged.records.iter().map(record_key).collect::<Vec<_>>()
        );
    }

    #[test]
    fn cloud_merge_rejects_different_uid() {
        let local =
            SyncEnvelope::from_records("106485288", &[], "2026-09-02T00:00:00Z".into()).unwrap();
        let cloud =
            SyncEnvelope::from_records("106485289", &[], "2026-09-02T00:00:01Z".into()).unwrap();
        assert!(local
            .merge_with_cloud(&cloud, "2026-09-02T00:00:02Z".into())
            .is_err());
    }
}
