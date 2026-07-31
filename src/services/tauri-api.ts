import { invoke } from '@tauri-apps/api/core';
import type { GachaImportResult, GachaRecord, GachaStats, GameSettings } from '../types';

export const gachaApi = {
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

  // 从本地 JSON 文件导入抽卡数据
  importGachaJson: (filePath: string): Promise<GachaImportResult> => {
    return invoke('import_gacha_json', { filePath });
  },

  // 获取所有记录
  getAllRecords: (playerId?: string): Promise<GachaRecord[]> => {
    return invoke('get_all_records', { playerId });
  },

  // 获取所有玩家 ID
  getPools: (): Promise<string[]> => {
    return invoke('get_pools');
  },

  // 获取统计数据
  getStats: (playerId?: string): Promise<GachaStats> => {
    return invoke('get_stats', { playerId });
  },

  // 清空记录
  clearRecords: (playerId?: string): Promise<void> => {
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
};
