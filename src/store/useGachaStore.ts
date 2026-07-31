import { create } from 'zustand';
import { gachaApi } from '../services/tauri-api';
import type { GachaRecord, GachaStats, GameSettings, ToastMessage } from '../types';

interface GachaStore {
  records: GachaRecord[];
  stats: GachaStats | null;
  pools: string[];
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
  fetchSettings: () => Promise<void>;
  saveGameDir: (dir: string) => Promise<void>;
  scanGacha: (gameDir: string) => Promise<void>;
  scanGachaByUrl: (url: string) => Promise<void>;
  importJson: (filePath: string) => Promise<void>;
  clearRecords: (playerId?: string) => Promise<void>;
  setActivePlayer: (playerId: string | null) => void;
  refreshAll: () => Promise<void>;
  addToast: (type: ToastMessage['type'], message: string) => void;
  removeToast: (id: string) => void;
}

export const useGachaStore = create<GachaStore>((set, get) => ({
  records: [],
  stats: null,
  pools: [],
  settings: null,
  loading: false,
  scanning: false,
  error: null,
  toastMessages: [],
  activePlayerId: null,
  initialized: false,

  fetchRecords: async () => {
    set({ loading: true, error: null });
    try {
      const { activePlayerId } = get();
      const records = await gachaApi.getAllRecords(activePlayerId || undefined);
      set({ records, loading: false });
    } catch (e) {
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

  fetchPools: async () => {
    try {
      const pools = await gachaApi.getPools();
      set({ pools, initialized: true });
      if (pools.length > 0 && !get().activePlayerId) {
        set({ activePlayerId: pools[0] });
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

      set({
        records: result.records,
        scanning: false,
        activePlayerId: playerId || get().activePlayerId,
      });

      await get().fetchPools();
      if (playerId) {
        await get().fetchStats(playerId);
      }

      get().addToast(
        'success',
        `扫描完成：新增 ${result.added_count} 条，重复 ${result.duplicate_count} 条，当前共 ${result.total_count} 条`,
      );
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

      set({
        records: result.records,
        scanning: false,
        activePlayerId: playerId || get().activePlayerId,
      });

      await get().fetchPools();
      if (playerId) {
        await get().fetchStats(playerId);
      }

      get().addToast(
        'success',
        `扫描完成：新增 ${result.added_count} 条，重复 ${result.duplicate_count} 条，当前共 ${result.total_count} 条`,
      );
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

      set({
        records: result.records,
        scanning: false,
        activePlayerId: playerId || get().activePlayerId,
      });

      await get().fetchPools();
      if (playerId) {
        await get().fetchStats(playerId);
      }

      get().addToast(
        'success',
        `导入完成：新增 ${result.added_count} 条，重复 ${result.duplicate_count} 条，当前共 ${result.total_count} 条`,
      );
    } catch (e) {
      set({ error: String(e), scanning: false });
      get().addToast('error', String(e));
    }
  },

  clearRecords: async (playerId?: string) => {
    try {
      await gachaApi.clearRecords(playerId);
      set({ records: [], stats: null });
      get().addToast('success', '记录已清空');
      await get().fetchPools();
    } catch (e) {
      get().addToast('error', `清空记录失败: ${String(e)}`);
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
