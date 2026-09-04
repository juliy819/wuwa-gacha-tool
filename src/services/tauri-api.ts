import { invoke } from '@tauri-apps/api/core';
import type { CharacterPullInsight, ClearRecordsResult, CloudSyncApplyResult, CloudSyncEnvelope, DeleteMockResult, GachaImportPreview, GachaImportResult, GachaInsights, GachaRecord, GachaResource, GachaStats, GameDirValidation, GameSettings, HomeOverview, InsertMockGachaRequest, OcrComponentStatus, OcrComponentUpdate, OcrImportResult, OcrScreenshotResult, OneDriveDeviceLogin, OneDriveLoginPollStatus, OneDriveStatus, OneDriveSyncResult, PoolBoundaryStatus, RecordSummary, ResourceAcquisitionInsight, UpdateMockGachaRequest, ResourcePackStatus } from '../types';

export const gachaApi = {
  openLogDirectory: (): Promise<string> => {
    return invoke('open_log_directory');
  },

  openBackupDirectory: (): Promise<string> => {
    return invoke('open_backup_directory');
  },

  getResourceIcon: (resourceId: number): Promise<string> => {
    return invoke('get_resource_icon', { resourceId });
  },

  prepareSyncPayload: (playerId: string): Promise<CloudSyncEnvelope> => {
    return invoke('prepare_sync_payload', { playerId });
  },

  applyCloudSyncPayload: (playerId: string, cloudPayload: string): Promise<CloudSyncApplyResult> => {
    return invoke('apply_cloud_sync_payload', { playerId, cloudPayload });
  },
  getOneDriveStatus: (): Promise<OneDriveStatus> => invoke('get_onedrive_status'),
  startOneDriveLogin: (): Promise<OneDriveDeviceLogin> => invoke('start_onedrive_login'),
  pollOneDriveLogin: (): Promise<OneDriveLoginPollStatus> => invoke('poll_onedrive_login'),
  cancelOneDriveLogin: (): Promise<void> => invoke('cancel_onedrive_login'),
  disconnectOneDrive: (): Promise<void> => invoke('disconnect_onedrive'),
  syncOneDriveDatabase: (playerId = '', strategy?: 'local' | 'remote'): Promise<OneDriveSyncResult> => invoke('sync_onedrive_database', { playerId, strategy }),
  /** @deprecated use syncOneDriveDatabase; retained for callers from older UI modules. */
  syncOneDriveUid: (playerId: string): Promise<OneDriveSyncResult> => invoke('sync_onedrive_database', { playerId }),
  getResourcePortrait: (resourceId: number): Promise<string> => {
    return invoke('get_resource_portrait', { resourceId });
  },

  getResourcePackStatus: (): Promise<ResourcePackStatus> => invoke('get_resource_pack_status'),
  refreshResourcePack: (): Promise<ResourcePackStatus> => invoke('refresh_resource_pack'),

  getGachaResources: (): Promise<GachaResource[]> => {
    return invoke('get_gacha_resources');
  },

  recognizeGachaScreenshots: (paths: string[]): Promise<OcrScreenshotResult> => {
    return invoke('recognize_gacha_screenshots', { request: { paths } });
  },

  getOcrComponentStatus: (): Promise<OcrComponentStatus> => {
    return invoke('get_ocr_component_status');
  },

  checkOcrComponentUpdate: (): Promise<OcrComponentUpdate> => {
    return invoke('check_ocr_component_update');
  },

  installOcrComponent: (): Promise<OcrComponentStatus> => {
    return invoke('install_ocr_component');
  },

  removeOcrComponent: (): Promise<OcrComponentStatus> => {
    return invoke('remove_ocr_component');
  },

  importOcrGachaRows: (rows: InsertMockGachaRequest[], allowDateOverlap = false): Promise<OcrImportResult> => {
    return invoke('import_ocr_gacha_rows', { request: { rows, allow_date_overlap: allowDateOverlap } });
  },

  insertMockGacha: (request: InsertMockGachaRequest): Promise<GachaRecord[]> => {
    return invoke('insert_mock_gacha', { request });
  },
  insertMockFillers: (request: { player_id: string; card_pool_type: string; count: number; time: string }): Promise<GachaRecord[]> => invoke('insert_mock_fillers', { request }),

  completePoolBoundary: (playerId: string, poolType: string, targetPulls: number): Promise<GachaRecord[]> => {
    return invoke('complete_pool_boundary', { request: { player_id: playerId, card_pool_type: poolType, target_pulls: targetPulls } });
  },

  updateMockGacha: (request: UpdateMockGachaRequest): Promise<void> => {
    return invoke('update_mock_gacha', { request });
  },

  deleteMockGacha: (id: number): Promise<DeleteMockResult> => {
    return invoke('delete_mock_gacha', { id });
  },

  // 解码日志获取 URL
  decodeLog: (gameDir: string): Promise<string> => {
    return invoke('decode_log', { gameDir });
  },

  // 从游戏目录解码获取抽卡数据
  fetchGachaData: (gameDir: string): Promise<GachaImportResult> => {
    return invoke('fetch_gacha_data', { gameDir });
  },

  // 直接通过抽卡链接获取抽卡数据
  fetchGachaDataByUrl: (url: string): Promise<GachaImportResult> => {
    return invoke('fetch_gacha_data_by_url', { url });
  },

  openCloudGachaWindow: (): Promise<void> => {
    return invoke('open_cloud_gacha_window');
  },

  closeCloudGachaWindow: (): Promise<void> => {
    return invoke('close_cloud_gacha_window');
  },

  // 从本地 JSON 文件导入抽卡数据
  importGachaJson: (filePath: string, expectedFileHash?: string): Promise<GachaImportResult> => {
    return invoke('import_gacha_json', { filePath, expectedFileHash });
  },

  previewGachaJsonImport: (filePath: string): Promise<GachaImportPreview> => {
    return invoke('preview_gacha_json_import', { filePath });
  },

  // 获取所有记录
  getAllRecords: (playerId?: string): Promise<GachaRecord[]> => {
    return invoke('get_all_records', { playerId });
  },

  // 导出指定玩家的抽卡数据为 JSON 文件
  exportGachaJson: (playerId: string, filePath: string, startDate?: string, endDate?: string): Promise<void> => {
    return invoke('export_gacha_json', { playerId, filePath, startDate, endDate });
  },

  // 获取所有玩家 ID
  getPools: (): Promise<string[]> => {
    return invoke('get_pools');
  },

  // 获取玩家记录摘要
  getRecordSummaries: (): Promise<RecordSummary[]> => {
    return invoke('get_record_summaries');
  },

  // 获取统计数据
  getStats: (playerId?: string): Promise<GachaStats> => {
    return invoke('get_stats', { playerId });
  },

  getHomeOverview: (playerId?: string): Promise<HomeOverview> => {
    return invoke('get_home_overview', { playerId });
  },

  getGachaInsights: (playerId: string, includeMock: boolean, startDate?: string, endDate?: string): Promise<GachaInsights> => {
    return invoke('get_gacha_insights', { playerId, includeMock, startDate, endDate });
  },

  getCharacterPullInsights: (playerId?: string, includeMock = false): Promise<CharacterPullInsight[]> => {
    return invoke('get_character_pull_insights', { playerId, includeMock });
  },
  getResourceAcquisitionInsights: (playerId?: string, includeMock = false): Promise<ResourceAcquisitionInsight[]> => {
    return invoke('get_resource_acquisition_insights', { playerId, includeMock });
  },

  getPoolBoundaryStatuses: (playerId: string): Promise<PoolBoundaryStatus[]> => {
    return invoke('get_pool_boundary_statuses', { playerId });
  },

  setPoolBoundaryConfirmed: (playerId: string, poolType: string, confirmed: boolean): Promise<void> => {
    return invoke('set_pool_boundary_confirmed', { playerId, poolType, confirmed });
  },

  // 清空记录
  clearRecords: (playerId?: string): Promise<ClearRecordsResult> => {
    return invoke('clear_records', { playerId });
  },

  // 保存游戏目录
  saveGameDir: (gameDir: string): Promise<void> => {
    return invoke('save_game_dir', { gameDir });
  },

  // 获取游戏目录
  getGameDir: (): Promise<GameSettings> => {
    return invoke('get_game_dir');
  },

  validateGameDir: (gameDir: string): Promise<GameDirValidation> => {
    return invoke('validate_game_dir', { gameDir });
  },

  // 按代理顺序下载安装包并启动安装程序
  downloadAndInstallUpdate: (officialUrl: string, version: string): Promise<void> => {
    return invoke('download_and_install_update', { officialUrl, version });
  },
};
