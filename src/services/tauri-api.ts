import { invoke } from '@tauri-apps/api/core';
import type { ClearRecordsResult, DeleteMockResult, GachaImportResult, GachaRecord, GachaResource, GachaStats, GameDirValidation, GameSettings, InsertMockGachaRequest, RecordSummary, UpdateMockGachaRequest } from '../types';

export const gachaApi = {
  getResourceIcon: (resourceId: number): Promise<string> => {
    return invoke('get_resource_icon', { resourceId });
  },

  getGachaResources: (): Promise<GachaResource[]> => {
    return invoke('get_gacha_resources');
  },

  insertMockGacha: (request: InsertMockGachaRequest): Promise<GachaRecord[]> => {
    return invoke('insert_mock_gacha', { request });
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
  importGachaJson: (filePath: string): Promise<GachaImportResult> => {
    return invoke('import_gacha_json', { filePath });
  },

  // 获取所有记录
  getAllRecords: (playerId?: string): Promise<GachaRecord[]> => {
    return invoke('get_all_records', { playerId });
  },

  // 导出指定玩家的抽卡数据为 JSON 文件
  exportGachaJson: (playerId: string, filePath: string): Promise<void> => {
    return invoke('export_gacha_json', { playerId, filePath });
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
