import { create } from 'zustand';
import { gachaApi } from '../services/tauri-api';
import { playUiFeedback } from '../lib/uiFeedback';
import type { ClearRecordsResult, GachaRecord, GachaStats, GameSettings, RecordSummary, ToastMessage } from '../types';

interface GachaStore {
  records: GachaRecord[];
  recordsLoaded: boolean;
  recordsPlayerId: string | null;
  stats: GachaStats | null;
  pools: string[];
  summaries: RecordSummary[];
  settings: GameSettings | null;
  loading: boolean;
  scanning: boolean;
  error: string | null;
  toastMessages: ToastMessage[];
  activePlayerId: string | null;
  initialized: boolean;

  fetchRecords: () => Promise<void>;
  fetchStats: (playerId?: string) => Promise<void>;
  fetchPools: () => Promise<void>;
  fetchSummaries: () => Promise<void>;
  fetchSettings: () => Promise<void>;
  saveGameDir: (dir: string) => Promise<void>;
  scanGacha: (gameDir: string) => Promise<void>;
  scanGachaByUrl: (url: string) => Promise<void>;
  importJson: (filePath: string) => Promise<void>;
  clearRecords: (playerId?: string) => Promise<ClearRecordsResult | null>;
  setActivePlayer: (playerId: string | null) => void;
  refreshAll: () => Promise<void>;
  addToast: (type: ToastMessage['type'], message: string) => void;
  removeToast: (id: string) => void;
}

let recordsRequestId = 0;

export const useGachaStore = create<GachaStore>((set, get) => ({
  records: [],
  recordsLoaded: false,
  recordsPlayerId: null,
  stats: null,
  pools: [],
  summaries: [],
  settings: null,
  loading: false,
  scanning: false,
  error: null,
  toastMessages: [],
  activePlayerId: null,
  initialized: false,

  fetchRecords: async () => {
    const requestId = ++recordsRequestId;
    const requestedPlayerId = get().activePlayerId;
    set({ loading: true, error: null });
    try {
      const records = await gachaApi.getAllRecords(requestedPlayerId || undefined);
      if (requestId !== recordsRequestId) return;
      set({ records, recordsLoaded: true, recordsPlayerId: requestedPlayerId, loading: false });
    } catch (e) {
      if (requestId !== recordsRequestId) return;
      set({ error: String(e), loading: false });
      // 不弹 toast，空数据是正常状态
    }
  },

  fetchStats: async (playerId?: string) => {
    try {
      const stats = await gachaApi.getStats(playerId);
      set({ stats });
    } catch {
      // 静默失败，空数据时不需要提示
    }
  },

  fetchSummaries: async () => {
    try {
      const summaries = await gachaApi.getRecordSummaries();
      set({ summaries });
    } catch (e) {
      throw e;
    }
  },

  fetchPools: async () => {
    try {
      const pools = await gachaApi.getPools();
      set({ pools, initialized: true });
      const { activePlayerId } = get();
      if (!activePlayerId || !pools.includes(activePlayerId)) {
        set({ activePlayerId: pools[0] ?? null });
      }
    } catch {
      set({ initialized: true });
      // 静默失败
    }
  },

  fetchSettings: async () => {
    try {
      const settings = await gachaApi.getGameDir();
      set({ settings });
    } catch {
      // 首次使用没有设置，静默处理
    }
  },

  saveGameDir: async (dir: string) => {
    try {
      await gachaApi.saveGameDir(dir);
      set({ settings: { game_dir: dir } });
      get().addToast('success', '游戏目录已保存');
    } catch (e) {
      get().addToast('error', `保存失败: ${String(e)}`);
      throw e;
    }
  },

  scanGacha: async (gameDir: string) => {
    set({ scanning: true, error: null });
    try {
      const result = await gachaApi.fetchGachaData(gameDir);
      const playerId = result.player_id;

      recordsRequestId += 1;
      set({
        records: result.records,
        recordsLoaded: true,
        recordsPlayerId: playerId || get().activePlayerId,
        loading: false,
        error: null,
        scanning: false,
        activePlayerId: playerId || get().activePlayerId,
      });

      await Promise.all([get().fetchPools(), get().fetchSummaries().catch(() => {})]);
      if (playerId) {
        await get().fetchStats(playerId);
      }

      get().addToast(
        'success',
        `扫描完成：新增 ${result.added_count} 条，重复 ${result.duplicate_count} 条，当前共 ${result.total_count} 条`,
      );
      void playUiFeedback('scan-complete');
      if (result.failed_pools.length > 0) {
        get().addToast('info', `${result.failed_pools.length} 个卡池获取失败，已保留原有数据`);
      }
    } catch (e) {
      set({ error: String(e), scanning: false });
      get().addToast('error', String(e));
    }
  },

  scanGachaByUrl: async (url: string) => {
    set({ scanning: true, error: null });
    try {
      const result = await gachaApi.fetchGachaDataByUrl(url);
      const playerId = result.player_id;

      recordsRequestId += 1;
      set({
        records: result.records,
        recordsLoaded: true,
        recordsPlayerId: playerId || get().activePlayerId,
        loading: false,
        error: null,
        scanning: false,
        activePlayerId: playerId || get().activePlayerId,
      });

      await Promise.all([get().fetchPools(), get().fetchSummaries().catch(() => {})]);
      if (playerId) {
        await get().fetchStats(playerId);
      }

      get().addToast(
        'success',
        `扫描完成：新增 ${result.added_count} 条，重复 ${result.duplicate_count} 条，当前共 ${result.total_count} 条`,
      );
      void playUiFeedback('scan-complete');
      if (result.failed_pools.length > 0) {
        get().addToast('info', `${result.failed_pools.length} 个卡池获取失败，已保留原有数据`);
      }
    } catch (e) {
      set({ error: String(e), scanning: false });
      get().addToast('error', String(e));
    }
  },

  importJson: async (filePath: string) => {
    set({ scanning: true, error: null });
    try {
      const result = await gachaApi.importGachaJson(filePath);
      const playerId = result.player_id;

      recordsRequestId += 1;
      set({
        records: result.records,
        recordsLoaded: true,
        recordsPlayerId: playerId || get().activePlayerId,
        loading: false,
        error: null,
        scanning: false,
        activePlayerId: playerId || get().activePlayerId,
      });

      await Promise.all([get().fetchPools(), get().fetchSummaries().catch(() => {})]);
      if (playerId) {
        await get().fetchStats(playerId);
      }

      get().addToast(
        'success',
        `导入完成：新增 ${result.added_count} 条，重复 ${result.duplicate_count} 条，当前共 ${result.total_count} 条`,
      );
      void playUiFeedback('data-rebuilt');
    } catch (e) {
      set({ error: String(e), scanning: false });
      get().addToast('error', String(e));
    }
  },

  clearRecords: async (playerId?: string) => {
    try {
      const result = await gachaApi.clearRecords(playerId);
      const { activePlayerId } = get();
      if (!playerId || playerId === activePlayerId) {
        recordsRequestId += 1;
        set({
          records: [],
          recordsLoaded: true,
          recordsPlayerId: activePlayerId,
          stats: null,
          loading: false,
          error: null,
        });
      }
      get().addToast('success', `已清空 ${result.deleted_count} 条记录`);
      if (result.backup_path) {
        get().addToast('info', `删除前备份已保存：${result.backup_path}`);
      }
      await Promise.all([get().fetchPools(), get().fetchSummaries().catch(() => {})]);
      return result;
    } catch (e) {
      get().addToast('error', `清空记录失败: ${String(e)}`);
      return null;
    }
  },

  setActivePlayer: (playerId: string | null) => {
    set({ activePlayerId: playerId });
    if (playerId) {
      get().fetchStats(playerId);
    }
  },

  refreshAll: async () => {
    const { activePlayerId } = get();
    await Promise.all([
      get().fetchSettings(),
      get().fetchPools(),
      get().fetchRecords(),
      get().fetchSummaries().catch(() => {}),
    ]);
    if (activePlayerId) {
      await get().fetchStats(activePlayerId);
    }
  },

  addToast: (type, message) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
    set(s => ({ toastMessages: [...s.toastMessages, { id, type, message }] }));
    setTimeout(() => {
      get().removeToast(id);
    }, 3000);
  },

  removeToast: (id) => {
    set(s => ({ toastMessages: s.toastMessages.filter(m => m.id !== id) }));
  },
}));
