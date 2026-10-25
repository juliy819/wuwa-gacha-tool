use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::db::Database;
use crate::onedrive::{self, DeviceLoginInfo, OneDriveStatus, PollResult, UploadResult};
use crate::AppState;

const SYNC_TEMP_DIR_NAME: &str = "sync-temp";
/// 同步窗口内本机持续变化时的最大重决策次数。取云端快照是网络操作，
/// 期间本机可能被导入/清空/历史起点确认改写，每次都要用新状态重新判断。
const MAX_SYNC_RESTARTS: usize = 3;

const FIRST_CONNECT_CONFLICT: &str = "本机和云端都已有数据，首次连接时无法判断应保留哪一版；请先在另一端同步，或清空本机数据后重新拉取";
const BOTH_CHANGED_CONFLICT: &str =
    "本机和云端数据库都已发生变化。为避免覆盖，请先保留其中一端的修改后再同步";
const LOCAL_KEEPS_CHANGING: &str = "本机数据在同步过程中持续变化，已停止本次云同步，请稍后重试";

fn is_sync_snapshot_name(name: &str) -> bool {
    (name.starts_with("sync-local-")
        || name.starts_with("sync-remote-")
        || name.starts_with("sync-verify-"))
        && name.ends_with(".db")
}

/// Removes snapshots left by an interrupted sync. Only the historical
/// snapshot filename patterns are eligible, both in the old root location and
/// in the dedicated temporary directory.
pub fn cleanup_stale_sync_files(app_data_dir: &Path) {
    let directories = [
        app_data_dir.to_path_buf(),
        app_data_dir.join(SYNC_TEMP_DIR_NAME),
    ];
    let mut removed = 0usize;
    for directory in directories {
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if !entry
                .file_type()
                .map(|kind| kind.is_file())
                .unwrap_or(false)
                || !is_sync_snapshot_name(name)
            {
                continue;
            }
            match std::fs::remove_file(&path) {
                Ok(()) => removed += 1,
                Err(error) => log::warn!(
                    target: "app::onedrive",
                    "event=sync_temp_cleanup_failed file={} error={error}",
                    path.display()
                ),
            }
        }
    }
    if removed > 0 {
        log::info!(
            target: "app::onedrive",
            "event=sync_temp_cleanup_completed removed={removed}"
        );
    }
}

struct SyncTempFiles {
    /// 进入同步窗口时本机数据库的快照。
    local: PathBuf,
    /// 云端下载下来的快照。
    remote: PathBuf,
    /// 决策前重新生成的本机快照，用于确认同步窗口内本机没有变化。
    verify: PathBuf,
}

impl SyncTempFiles {
    fn new(directory: &Path, stamp: u128) -> Result<Self, String> {
        std::fs::create_dir_all(directory)
            .map_err(|error| format!("创建同步临时目录失败: {error}"))?;
        Ok(Self {
            local: directory.join(format!("sync-local-{stamp}.db")),
            remote: directory.join(format!("sync-remote-{stamp}.db")),
            verify: directory.join(format!("sync-verify-{stamp}.db")),
        })
    }
}

impl Drop for SyncTempFiles {
    fn drop(&mut self) {
        for path in [&self.local, &self.remote, &self.verify] {
            if let Err(error) = std::fs::remove_file(path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    log::warn!(
                        target: "app::onedrive",
                        "event=sync_temp_remove_failed file={} error={error}",
                        path.display()
                    );
                }
            }
        }
    }
}

#[derive(Debug, Serialize)]
pub struct LoginPollStatus {
    pub connected: bool,
    pub pending: bool,
}

#[derive(Debug, Serialize)]
pub struct OneDriveSyncResult {
    pub added_count: usize,
    pub duplicate_count: usize,
    pub total_count: usize,
    pub uploaded_count: usize,
    pub conflict_retries: u32,
    pub updated_at: String,
    /// 本次用云端快照覆盖本机时丢掉的本机记录数（0 表示没有丢）。
    pub lost_count: usize,
    /// 被丢弃记录的时间范围，用于向用户说明影响。
    pub lost_earliest: Option<String>,
    pub lost_latest: Option<String>,
    /// 覆盖前自动留下的本机整库备份路径。
    pub backup_path: Option<String>,
}

/// 覆盖本机时的告知信息，只有 apply 分支才有内容。
#[derive(Debug, Default)]
struct SyncOverwriteReport {
    lost_earliest: Option<String>,
    lost_latest: Option<String>,
    backup_path: Option<String>,
}

/// 云同步的方向决策。输入全部是“同步窗口内的当前状态”，函数本身不做任何
/// IO，便于用单测覆盖全部分支；任何会覆盖本机的写入都必须发生在这个决策
/// 之后的同一次临界区里。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncAction {
    /// 两端自上次同步以来都没有变化，本机数据库不需要改动。
    Keep,
    /// 云端有更新、本机没变：用云端快照覆盖本机。
    ApplyRemote,
    /// 本机有更新、云端没变：把本机快照推送到云端。
    UploadLocal,
    /// 首次连接且两端都有数据，无法自动判断该保留哪一端。
    FirstConnectConflict,
    /// 两端在最后一次同步之后都发生了变化，交给用户选择。
    BothChangedConflict,
}

fn decide_sync_action(
    baseline_etag: Option<&str>,
    baseline_hash: Option<&str>,
    local_hash: &str,
    local_count: usize,
    remote_etag: &str,
    strategy: Option<&str>,
) -> SyncAction {
    let remote_changed = baseline_etag != Some(remote_etag);
    let local_changed = baseline_hash != Some(local_hash);
    let explicit = matches!(strategy, Some("local") | Some("remote"));
    if baseline_etag.is_none() && local_count > 0 && !explicit {
        return SyncAction::FirstConnectConflict;
    }
    if baseline_etag.is_some() && remote_changed && local_changed && !explicit {
        return SyncAction::BothChangedConflict;
    }
    match strategy {
        Some("remote") => SyncAction::ApplyRemote,
        Some("local") => SyncAction::UploadLocal,
        // 两端都没变时不再无脑重放云端快照：那是一次没有任何收益、
        // 却足以抹掉同步窗口内新写入记录的整库覆盖。
        _ => match (remote_changed, local_changed) {
            (false, false) => SyncAction::Keep,
            (false, true) => SyncAction::UploadLocal,
            (true, false) => SyncAction::ApplyRemote,
            // 只剩“首次连接且本机为空”这一种情况：以云端为准拉取。
            (true, true) => SyncAction::ApplyRemote,
        },
    }
}

fn sync_result(
    total: usize,
    added: usize,
    lost: usize,
    report: SyncOverwriteReport,
) -> OneDriveSyncResult {
    OneDriveSyncResult {
        added_count: added,
        duplicate_count: 0,
        total_count: total,
        uploaded_count: total,
        conflict_retries: 0,
        updated_at: chrono::Utc::now().to_rfc3339(),
        lost_count: lost,
        lost_earliest: report.lost_earliest,
        lost_latest: report.lost_latest,
        backup_path: report.backup_path,
    }
}

/// 云端快照在临时目录里的落点，加上它在 OneDrive 上的版本标识。
#[derive(Debug)]
struct CloudSnapshotRef<'a> {
    etag: &'a str,
    path: &'a Path,
}

/// 一次同步尝试的结果。所有会写本机数据库的动作（覆盖、覆盖前备份、更新基线）
/// 都在 [`evaluate_sync_attempt`] 内部完成，调用方只负责网络传输与重试。
#[derive(Debug)]
enum SyncAttempt {
    /// 快照之后本机变了：旧判断作废，用新状态重新决策。
    ChangedLocally {
        local_hash: String,
        local_count: usize,
    },
    Keep {
        total: usize,
    },
    Applied {
        total: usize,
        added: usize,
        lost: usize,
        report: SyncOverwriteReport,
    },
    Upload {
        etag: String,
        bytes: Vec<u8>,
        snapshot_hash: String,
        total: usize,
    },
    Conflict(&'static str),
}

/// 校验本机新鲜度、决定同步方向，并完成所有会写本机数据库的动作。
///
/// 云端快照是网络操作，下载期间用户完全可能刚导入完记录，因此覆盖本机之前
/// 必须用「此刻」的本机快照重新判断。校验、决策和写入都放在这一个函数里，
/// 调用方必须持 `state.db` 锁调用，从而不存在“校验通过之后又被插进一次导入”
/// 的窗口。拆成独立函数也让这条竞态路径可以用单测直接覆盖。
fn evaluate_sync_attempt(
    db: &Database,
    verify_snapshot: &Path,
    baseline_etag: Option<&str>,
    baseline_hash: Option<&str>,
    local_hash: &str,
    local_count: usize,
    cloud: &CloudSnapshotRef<'_>,
    strategy: Option<&str>,
) -> Result<SyncAttempt, String> {
    db.create_sync_snapshot(verify_snapshot)?;
    let current_hash = hash_file(verify_snapshot)?;
    if current_hash != local_hash {
        return Ok(SyncAttempt::ChangedLocally {
            local_hash: current_hash,
            local_count: db.record_count()?,
        });
    }
    Ok(
        match decide_sync_action(
            baseline_etag,
            baseline_hash,
            local_hash,
            local_count,
            cloud.etag,
            strategy,
        ) {
            SyncAction::Keep => SyncAttempt::Keep { total: local_count },
            SyncAction::ApplyRemote => {
                let preview = db.preview_sync_apply(cloud.path)?;
                let backup_path = if local_count > 0 {
                    db.create_sync_backup()?
                } else {
                    None
                };
                db.apply_sync_snapshot(cloud.path)?;
                let total = db.record_count()?;
                db.create_sync_snapshot(verify_snapshot)?;
                db.save_cloud_sync_baseline(cloud.etag, &hash_file(verify_snapshot)?)?;
                log::warn!(
                    target: "app::onedrive",
                    "event=sync_applied_remote local_before={} remote_total={} lost={} backup={}",
                    local_count,
                    total,
                    preview.lost_count,
                    backup_path.is_some()
                );
                SyncAttempt::Applied {
                    total,
                    added: total.saturating_sub(local_count),
                    lost: preview.lost_count,
                    report: SyncOverwriteReport {
                        lost_earliest: preview.lost_earliest,
                        lost_latest: preview.lost_latest,
                        backup_path,
                    },
                }
            }
            SyncAction::UploadLocal => SyncAttempt::Upload {
                etag: cloud.etag.to_string(),
                bytes: std::fs::read(verify_snapshot).map_err(|e| e.to_string())?,
                snapshot_hash: local_hash.to_string(),
                total: local_count,
            },
            SyncAction::FirstConnectConflict => SyncAttempt::Conflict(FIRST_CONNECT_CONFLICT),
            SyncAction::BothChangedConflict => SyncAttempt::Conflict(BOTH_CHANGED_CONFLICT),
        },
    )
}

fn save_cloud_baseline(
    state: &State<'_, AppState>,
    etag: &str,
    snapshot_hash: &str,
) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(|e| e.to_string())?
        .save_cloud_sync_baseline(etag, snapshot_hash)
}

#[tauri::command]
pub async fn get_onedrive_status(state: State<'_, AppState>) -> Result<OneDriveStatus, String> {
    let auth = state.onedrive.lock().await;
    Ok(onedrive::status(&auth))
}

#[tauri::command]
pub async fn start_onedrive_login(state: State<'_, AppState>) -> Result<DeviceLoginInfo, String> {
    let mut auth = state.onedrive.lock().await;
    onedrive::start_login(&state.http, &mut auth).await
}

#[tauri::command]
pub async fn poll_onedrive_login(state: State<'_, AppState>) -> Result<LoginPollStatus, String> {
    let mut auth = state.onedrive.lock().await;
    match onedrive::poll_login(&state.http, &mut auth).await? {
        PollResult::Pending => Ok(LoginPollStatus {
            connected: false,
            pending: true,
        }),
        PollResult::Connected => Ok(LoginPollStatus {
            connected: true,
            pending: false,
        }),
    }
}

#[tauri::command]
pub async fn cancel_onedrive_login(state: State<'_, AppState>) -> Result<(), String> {
    state.onedrive.lock().await.pending = None;
    Ok(())
}

#[tauri::command]
pub async fn disconnect_onedrive(state: State<'_, AppState>) -> Result<(), String> {
    let mut auth = state.onedrive.lock().await;
    onedrive::disconnect(&mut auth)
}

fn hash_file(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

/// 整库同步。方向由本机数据库与云端快照的版本关系决定：
///
/// * 决策所用的本机状态在**下载之前**读取，而下载可能耗时数秒，因此每次
///   决策前都会在临界区里重新生成快照比对；只要本机在窗口内变过，就丢弃
///   旧判断、用新状态重新决策，绝不用过期判断覆盖本机数据库。
/// * 两端都没变时不做任何写入，避免无意义的整库覆盖。
/// * 覆盖本机前自动备份，并把“丢掉多少条、哪个时间段”返回给界面。
#[tauri::command]
pub async fn sync_onedrive_database(
    state: State<'_, AppState>,
    _player_id: String,
    strategy: Option<String>,
) -> Result<OneDriveSyncResult, String> {
    let _sync_guard = state.sync_operation.lock().await;
    let token = {
        let mut auth = state.onedrive.lock().await;
        onedrive::access_token(&state.http, &mut auth).await?
    };
    let folder = onedrive::ensure_sync_directories(&state.http, &token).await?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let temp_files = SyncTempFiles::new(&state.app_data_dir.join(SYNC_TEMP_DIR_NAME), stamp)?;

    // 1) 本机快照 + 上次同步基线，一次临界区内读完。
    let (baseline_etag, baseline_hash) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.create_sync_snapshot(&temp_files.local)?;
        db.cloud_sync_baseline()?
    };
    let mut local_hash = hash_file(&temp_files.local)?;
    let mut local_count = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.record_count()?
    };

    // 2) 下载云端快照（网络窗口，本机数据库在这段时间里仍可被写入）。
    let remote = onedrive::download_snapshot(&state.http, &token, &folder).await?;
    let Some((remote_etag, remote_bytes)) = remote else {
        // 云端还没有快照：以本机为准创建，基线记录的是真正上传的那份内容。
        let bytes = std::fs::read(&temp_files.local).map_err(|e| e.to_string())?;
        return match onedrive::upload_snapshot(&state.http, &token, &folder, bytes, None).await? {
            UploadResult::Conflict => Err("云端数据库刚刚被其他设备创建，请重新同步".to_string()),
            UploadResult::Uploaded(etag) => {
                save_cloud_baseline(&state, &etag, &local_hash)?;
                Ok(sync_result(
                    local_count,
                    0,
                    0,
                    SyncOverwriteReport::default(),
                ))
            }
        };
    };
    std::fs::write(&temp_files.remote, &remote_bytes).map_err(|e| e.to_string())?;

    for attempt in 0..MAX_SYNC_RESTARTS {
        // 3) 临界区：先确认本机自步骤 1 以来没有变化，再用“此刻”的状态决策；
        //    所有会写本机数据库的动作都在这次持锁调用里完成。
        let outcome = {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            evaluate_sync_attempt(
                &db,
                &temp_files.verify,
                baseline_etag.as_deref(),
                baseline_hash.as_deref(),
                &local_hash,
                local_count,
                &CloudSnapshotRef {
                    etag: &remote_etag,
                    path: &temp_files.remote,
                },
                strategy.as_deref(),
            )?
        };
        match outcome {
            SyncAttempt::ChangedLocally {
                local_hash: fresh_hash,
                local_count: fresh_count,
            } => {
                local_hash = fresh_hash;
                local_count = fresh_count;
                log::warn!(
                    target: "app::onedrive",
                    "event=sync_local_changed_during_sync attempt={} local_total={}",
                    attempt + 1,
                    local_count
                );
                if attempt + 1 >= MAX_SYNC_RESTARTS {
                    return Err(LOCAL_KEEPS_CHANGING.to_string());
                }
            }
            SyncAttempt::Keep { total } => {
                return Ok(sync_result(total, 0, 0, SyncOverwriteReport::default()))
            }
            SyncAttempt::Applied {
                total,
                added,
                lost,
                report,
            } => return Ok(sync_result(total, added, lost, report)),
            SyncAttempt::Upload {
                etag,
                bytes,
                snapshot_hash,
                total,
            } => {
                return match onedrive::upload_snapshot(
                    &state.http,
                    &token,
                    &folder,
                    bytes,
                    Some(&etag),
                )
                .await?
                {
                    UploadResult::Conflict => Err("云端数据库已变化，请重新同步".to_string()),
                    UploadResult::Uploaded(new_etag) => {
                        // 基线记录的必须是真正上传的那份内容：若上传期间本机
                        // 又写入新数据，下次同步会因为哈希不同而重新上传，
                        // 而不是被误判成“已同步”。
                        save_cloud_baseline(&state, &new_etag, &snapshot_hash)?;
                        Ok(sync_result(total, 0, 0, SyncOverwriteReport::default()))
                    }
                };
            }
            SyncAttempt::Conflict(message) => return Err(message.to_string()),
        }
    }
    Err(LOCAL_KEEPS_CHANGING.to_string())
}

/// Deprecated compatibility alias for clients released before the database-wide sync rename.
#[tauri::command]
pub async fn sync_onedrive_uid(
    state: State<'_, AppState>,
    player_id: String,
) -> Result<OneDriveSyncResult, String> {
    sync_onedrive_database(state, player_id, None).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_removes_legacy_and_new_snapshot_files_only() {
        let root =
            std::env::temp_dir().join(format!("wuwa-sync-cleanup-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(SYNC_TEMP_DIR_NAME)).unwrap();
        for path in [
            root.join("sync-local-1.db"),
            root.join("sync-remote-2.db"),
            root.join("sync-verify-6.db"),
            root.join(SYNC_TEMP_DIR_NAME).join("sync-local-3.db"),
            root.join(SYNC_TEMP_DIR_NAME).join("sync-remote-4.db"),
            root.join(SYNC_TEMP_DIR_NAME).join("sync-verify-5.db"),
        ] {
            std::fs::write(path, b"snapshot").unwrap();
        }
        std::fs::write(root.join("sync-local-not-a-db.txt"), b"keep").unwrap();
        std::fs::write(root.join("other.db"), b"keep").unwrap();

        cleanup_stale_sync_files(&root);

        assert!(!root.join("sync-local-1.db").exists());
        assert!(!root.join("sync-remote-2.db").exists());
        assert!(!root.join("sync-verify-6.db").exists());
        assert!(!root
            .join(SYNC_TEMP_DIR_NAME)
            .join("sync-local-3.db")
            .exists());
        assert!(!root
            .join(SYNC_TEMP_DIR_NAME)
            .join("sync-remote-4.db")
            .exists());
        assert!(!root
            .join(SYNC_TEMP_DIR_NAME)
            .join("sync-verify-5.db")
            .exists());
        assert!(root.join("sync-local-not-a-db.txt").exists());
        assert!(root.join("other.db").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    /// 只本机有变化时，绝不能因为“云端也没变”而用云端快照覆盖本机
    /// —— 这正是线上丢掉刚导入记录的那条路径。
    #[test]
    fn local_only_changes_are_uploaded_never_overwritten_from_cloud() {
        assert_eq!(
            decide_sync_action(
                Some("etag-1"),
                Some("hash-old"),
                "hash-new",
                120,
                "etag-1",
                None
            ),
            SyncAction::UploadLocal
        );
        assert_eq!(
            decide_sync_action(
                Some("etag-1"),
                Some("hash-old"),
                "hash-new",
                120,
                "etag-1",
                Some("local")
            ),
            SyncAction::UploadLocal
        );
    }

    #[test]
    fn unchanged_both_sides_never_rewrite_the_local_database() {
        assert_eq!(
            decide_sync_action(
                Some("etag-1"),
                Some("hash-1"),
                "hash-1",
                120,
                "etag-1",
                None
            ),
            SyncAction::Keep
        );
        // 只有显式选择“使用云端”时才允许在两端都没变的情况下重放快照。
        assert_eq!(
            decide_sync_action(
                Some("etag-1"),
                Some("hash-1"),
                "hash-1",
                120,
                "etag-1",
                Some("remote")
            ),
            SyncAction::ApplyRemote
        );
    }

    #[test]
    fn remote_only_changes_are_pulled_to_local() {
        assert_eq!(
            decide_sync_action(
                Some("etag-1"),
                Some("hash-1"),
                "hash-1",
                120,
                "etag-2",
                None
            ),
            SyncAction::ApplyRemote
        );
    }

    #[test]
    fn both_sides_changed_ask_the_user_instead_of_overwriting() {
        assert_eq!(
            decide_sync_action(
                Some("etag-1"),
                Some("hash-1"),
                "hash-2",
                120,
                "etag-2",
                None
            ),
            SyncAction::BothChangedConflict
        );
        // 只有用户显式表态后才放行，且方向按用户选择执行。
        assert_eq!(
            decide_sync_action(
                Some("etag-1"),
                Some("hash-1"),
                "hash-2",
                120,
                "etag-2",
                Some("local")
            ),
            SyncAction::UploadLocal
        );
        assert_eq!(
            decide_sync_action(
                Some("etag-1"),
                Some("hash-1"),
                "hash-2",
                120,
                "etag-2",
                Some("remote")
            ),
            SyncAction::ApplyRemote
        );
    }

    #[test]
    fn first_connect_with_both_sides_populated_asks_the_user() {
        assert_eq!(
            decide_sync_action(None, None, "hash-local", 120, "etag-1", None),
            SyncAction::FirstConnectConflict
        );
        assert_eq!(
            decide_sync_action(None, None, "hash-local", 120, "etag-1", Some("local")),
            SyncAction::UploadLocal
        );
        assert_eq!(
            decide_sync_action(None, None, "hash-local", 120, "etag-1", Some("remote")),
            SyncAction::ApplyRemote
        );
    }

    #[test]
    fn first_connect_with_empty_local_pulls_the_cloud_snapshot() {
        assert_eq!(
            decide_sync_action(None, None, "hash-empty", 0, "etag-1", None),
            SyncAction::ApplyRemote
        );
    }

    // ===== 下面是“同步窗口内本机变化”的确定性回归测试：不需要网络，
    // ===== 也不用手工制造冲突，直接构造当时的数据库状态与云端快照。

    use crate::gacha::parser::GachaRecord;
    use std::path::PathBuf;

    fn sync_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wuwa-sync-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sync_test_record(resource_id: i64, time: &str) -> GachaRecord {
        GachaRecord {
            id: None,
            player_id: "10001".to_string(),
            card_pool_type: "1".to_string(),
            card_pool_name: "角色活动唤取".to_string(),
            card_pool_group: "UP角色池".to_string(),
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

    fn sync_test_database(dir: &Path, name: &str, times: &[&str]) -> Database {
        // 数据与配置必须分文件：生产环境里 baseline 写在 app-state.db，
        // 若放在同一个文件里，保存基线本身就会改变快照哈希（测试假象）。
        let db = Database::new_with_state(
            &dir.join(format!("{name}.db")),
            &dir.join(format!("{name}-state.db")),
        )
        .unwrap();
        let records: Vec<GachaRecord> = times
            .iter()
            .enumerate()
            .map(|(index, time)| sync_test_record(101 + index as i64, time))
            .collect();
        db.merge_records(&records).unwrap();
        db
    }

    /// 线上事故的回归测试：下载云端快照期间导入的记录，绝不能被云端快照覆盖。
    #[test]
    fn records_imported_during_the_sync_window_are_uploaded_never_overwritten() {
        let dir = sync_test_dir("window-import");
        let db = sync_test_database(
            &dir,
            "local",
            &["2026-01-01 12:00:00", "2026-01-02 12:00:00"],
        );

        // 同步开始：本机快照 + 当时的云端快照（内容相同），并记下基线。
        let local_snapshot = dir.join("sync-local.db");
        db.create_sync_snapshot(&local_snapshot).unwrap();
        let local_hash = hash_file(&local_snapshot).unwrap();
        let local_count = db.record_count().unwrap();
        let cloud_path = dir.join("sync-remote.db");
        db.create_sync_snapshot(&cloud_path).unwrap();
        db.save_cloud_sync_baseline("etag-1", &local_hash).unwrap();
        assert_eq!(local_count, 2);

        // 下载云端快照的这段时间里，用户导入了一条新记录。
        db.merge_records(&[sync_test_record(999, "2026-01-03 12:00:00")])
            .unwrap();
        assert_eq!(db.record_count().unwrap(), 3);

        let verify = dir.join("sync-verify.db");
        let cloud = CloudSnapshotRef {
            etag: "etag-1",
            path: &cloud_path,
        };

        // 第一次判定发现本机变了：旧结论作废，不得写本机数据库。
        let first = evaluate_sync_attempt(
            &db,
            &verify,
            Some("etag-1"),
            Some(&local_hash),
            &local_hash,
            local_count,
            &cloud,
            None,
        )
        .unwrap();
        match first {
            SyncAttempt::ChangedLocally {
                local_count: current,
                ..
            } => assert_eq!(current, 3),
            other => panic!("本机已变化时应当重新决策，实际得到 {other:?}"),
        }
        assert_eq!(
            db.record_count().unwrap(),
            3,
            "发现本机变化时不允许改动本机数据"
        );

        // 用新鲜状态重新决策：本机有新记录 → 上传，而不是用云端覆盖。
        let fresh_hash = hash_file(&verify).unwrap();
        let second = evaluate_sync_attempt(
            &db,
            &verify,
            Some("etag-1"),
            Some(&local_hash),
            &fresh_hash,
            3,
            &cloud,
            None,
        )
        .unwrap();
        match second {
            SyncAttempt::Upload { total, .. } => assert_eq!(total, 3),
            other => panic!("本机有新记录时应当上传本机快照，实际得到 {other:?}"),
        }
        assert_eq!(db.record_count().unwrap(), 3, "那条刚导入的记录必须还在");

        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 两端都没变时不动本机数据库。即使基线/云端快照比本机更旧（历史上被写坏过
    /// 的那种状态），也不允许无收益地整库覆盖。
    #[test]
    fn unchanged_both_sides_never_rewrites_the_local_database() {
        let dir = sync_test_dir("keep");
        let db = sync_test_database(
            &dir,
            "local",
            &[
                "2026-01-01 12:00:00",
                "2026-01-02 12:00:00",
                "2026-01-03 12:00:00",
            ],
        );
        let local_snapshot = dir.join("sync-local.db");
        db.create_sync_snapshot(&local_snapshot).unwrap();
        let local_hash = hash_file(&local_snapshot).unwrap();
        let local_count = db.record_count().unwrap();

        let stale = sync_test_database(&dir, "stale", &["2026-01-01 12:00:00"]);
        let cloud_path = dir.join("sync-remote.db");
        stale.create_sync_snapshot(&cloud_path).unwrap();
        db.save_cloud_sync_baseline("etag-1", &local_hash).unwrap();

        let verify = dir.join("sync-verify.db");
        let outcome = evaluate_sync_attempt(
            &db,
            &verify,
            Some("etag-1"),
            Some(&local_hash),
            &local_hash,
            local_count,
            &CloudSnapshotRef {
                etag: "etag-1",
                path: &cloud_path,
            },
            None,
        )
        .unwrap();

        match outcome {
            SyncAttempt::Keep { total } => assert_eq!(total, 3),
            other => panic!("两端都没变时不应写入本机数据库，实际得到 {other:?}"),
        }
        assert_eq!(db.record_count().unwrap(), 3);
        assert!(
            !db.backup_dir().unwrap().exists(),
            "没有发生覆盖时不该产生备份"
        );

        drop(stale);
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 云端更新的正常拉取：覆盖前留备份，并把会丢掉的条数与时间段报出来。
    #[test]
    fn pulling_a_newer_cloud_snapshot_backs_up_and_reports_what_is_lost() {
        let dir = sync_test_dir("pull");
        let db = sync_test_database(
            &dir,
            "local",
            &[
                "2026-01-01 12:00:00",
                "2026-01-02 12:00:00",
                "2026-01-03 12:00:00",
            ],
        );
        let local_snapshot = dir.join("sync-local.db");
        db.create_sync_snapshot(&local_snapshot).unwrap();
        let local_hash = hash_file(&local_snapshot).unwrap();
        let local_count = db.record_count().unwrap();
        db.save_cloud_sync_baseline("etag-1", &local_hash).unwrap();

        // 云端被另一端更新成只有前两条，etag 也变了。
        let cloud_db = sync_test_database(
            &dir,
            "cloud",
            &["2026-01-01 12:00:00", "2026-01-02 12:00:00"],
        );
        let cloud_path = dir.join("sync-remote.db");
        cloud_db.create_sync_snapshot(&cloud_path).unwrap();

        let verify = dir.join("sync-verify.db");
        let outcome = evaluate_sync_attempt(
            &db,
            &verify,
            Some("etag-1"),
            Some(&local_hash),
            &local_hash,
            local_count,
            &CloudSnapshotRef {
                etag: "etag-2",
                path: &cloud_path,
            },
            None,
        )
        .unwrap();

        match outcome {
            SyncAttempt::Applied {
                total,
                added,
                lost,
                report,
            } => {
                assert_eq!(total, 2);
                assert_eq!(added, 0);
                assert_eq!(lost, 1);
                assert_eq!(report.lost_earliest.as_deref(), Some("2026-01-03 12:00:00"));
                assert_eq!(report.lost_latest.as_deref(), Some("2026-01-03 12:00:00"));
                let backup = report.backup_path.expect("覆盖前必须留下备份");
                assert!(Path::new(&backup).is_file());
                assert!(backup.contains("gacha-data-before-sync-"));
            }
            other => panic!("云端更新时应当拉取，实际得到 {other:?}"),
        }
        assert_eq!(db.record_count().unwrap(), 2);

        drop(cloud_db);
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 两端都变了：停下来并交给用户，不做任何写入、也不留备份。
    #[test]
    fn both_sides_changed_stop_without_touching_the_database() {
        let dir = sync_test_dir("both-changed");
        let db = sync_test_database(&dir, "local", &["2026-01-01 12:00:00"]);
        let local_snapshot = dir.join("sync-local.db");
        db.create_sync_snapshot(&local_snapshot).unwrap();
        let local_hash = hash_file(&local_snapshot).unwrap();
        db.save_cloud_sync_baseline("etag-1", &local_hash).unwrap();
        // 本机新增一条。
        db.merge_records(&[sync_test_record(999, "2026-02-01 12:00:00")])
            .unwrap();

        // 云端也变了。
        let cloud_db = sync_test_database(&dir, "cloud", &["2026-01-01 12:00:00"]);
        db.merge_records(&[sync_test_record(998, "2026-03-01 12:00:00")])
            .unwrap();
        let cloud_path = dir.join("sync-remote.db");
        cloud_db.create_sync_snapshot(&cloud_path).unwrap();

        let verify = dir.join("sync-verify.db");
        let cloud = CloudSnapshotRef {
            etag: "etag-2",
            path: &cloud_path,
        };
        // 先按新鲜状态生成本机快照，得到本机变化后的哈希。
        db.create_sync_snapshot(&verify).unwrap();
        let fresh_hash = hash_file(&verify).unwrap();

        let outcome = evaluate_sync_attempt(
            &db,
            &verify,
            Some("etag-1"),
            Some(&local_hash),
            &fresh_hash,
            db.record_count().unwrap(),
            &cloud,
            None,
        )
        .unwrap();
        match outcome {
            SyncAttempt::Conflict(message) => assert!(message.contains("都已发生变化")),
            other => panic!("两端都变了应当交给用户，实际得到 {other:?}"),
        }
        assert_eq!(db.record_count().unwrap(), 3);
        assert!(!db.backup_dir().unwrap().exists());

        drop(cloud_db);
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 用户显式选择“使用云端”后允许覆盖，但同样必须留备份、报丢弃范围。
    #[test]
    fn explicit_remote_strategy_overwrites_with_a_backup() {
        let dir = sync_test_dir("explicit-remote");
        let db = sync_test_database(
            &dir,
            "local",
            &["2026-01-01 12:00:00", "2026-01-02 12:00:00"],
        );
        let local_snapshot = dir.join("sync-local.db");
        db.create_sync_snapshot(&local_snapshot).unwrap();
        let local_hash = hash_file(&local_snapshot).unwrap();
        db.save_cloud_sync_baseline("etag-1", &local_hash).unwrap();
        db.merge_records(&[sync_test_record(999, "2026-02-01 12:00:00")])
            .unwrap();

        let cloud_db = sync_test_database(&dir, "cloud", &["2026-01-01 12:00:00"]);
        let cloud_path = dir.join("sync-remote.db");
        cloud_db.create_sync_snapshot(&cloud_path).unwrap();

        let verify = dir.join("sync-verify.db");
        db.create_sync_snapshot(&verify).unwrap();
        let fresh_hash = hash_file(&verify).unwrap();
        let outcome = evaluate_sync_attempt(
            &db,
            &verify,
            Some("etag-1"),
            Some(&local_hash),
            &fresh_hash,
            3,
            &CloudSnapshotRef {
                etag: "etag-2",
                path: &cloud_path,
            },
            Some("remote"),
        )
        .unwrap();

        match outcome {
            SyncAttempt::Applied {
                total,
                lost,
                report,
                ..
            } => {
                assert_eq!(total, 1);
                assert_eq!(lost, 2);
                assert!(report.backup_path.is_some());
            }
            other => panic!("显式选择云端时应当覆盖，实际得到 {other:?}"),
        }
        assert_eq!(db.record_count().unwrap(), 1);

        drop(cloud_db);
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
