import { create } from 'zustand';
import { gachaApi } from '../services/tauri-api';
import { MAX_VISIBLE_TOASTS } from '../lib/toast';
import { playUiFeedback } from '../lib/uiFeedback';
import { officialMockOverlapMessage } from '../lib/importConflict';
import { cloudSyncConflictNotice, cloudSyncOverwriteNotices } from '../lib/cloudSync';
import type { ClearRecordsResult, GachaRecord, GachaStats, GameSettings, HomeOverview, ImportCompletionSummary, OneDriveSyncResult, RecordSummary, ToastMessage } from '../types';

interface GachaStore {
  records: GachaRecord[];
  recordsLoaded: boolean;
  recordsPlayerId: string | null;
  stats: GachaStats | null;
  statsPlayerId: string | null;
  pools: string[];
  summaries: RecordSummary[];
  settings: GameSettings | null;
  loading: boolean;
  scanning: boolean;
  error: string | null;
  toastMessages: ToastMessage[];
  lastImportSummary: ImportCompletionSummary | null;
  officialImportConflict: string | null;
  activePlayerId: string | null;
  confirmedBoundaryPoolTypes: string[];
  confirmedBoundaryPlayerId: string | null;
  analyticsRevision: number;
  initialized: boolean;
  cloudSyncStatus: { state: 'idle' | 'checking' | 'updated' | 'current' | 'error'; message: string; updatedAt: number | null };

  fetchRecords: () => Promise<void>;
  fetchStats: (playerId?: string) => Promise<void>;
  fetchHomeOverview: (playerId?: string) => Promise<void>;
  fetchPools: () => Promise<void>;
  fetchSummaries: () => Promise<void>;
  fetchSettings: () => Promise<void>;
  addLogPath: (path: string, label?: string) => Promise<void>;
  removeLogPath: (id: number) => Promise<void>;
  scanGacha: (gameDir: string) => Promise<void>;
  scanGachaByUrl: (url: string, source?: 'url' | 'cloud') => Promise<void>;
  importJson: (filePath: string, expectedFileHash?: string) => Promise<void>;
  clearRecords: (playerId?: string) => Promise<ClearRecordsResult | null>;
  setActivePlayer: (playerId: string | null) => void;
  refreshAll: () => Promise<void>;
  addToast: (type: ToastMessage['type'], message: string) => void;
  removeToast: (id: string) => void;
  dismissImportSummary: () => void;
  showOfficialImportConflict: (message: string | null) => void;
  scheduleCloudSync: () => void;
  setCloudSyncStatus: (state: GachaStore['cloudSyncStatus']['state'], message: string) => void;
  /** 会话级的启动云同步：状态一定收敛到终态，不受页面卸载影响。 */
  syncStartupCloud: () => Promise<void>;
  /** 云端覆盖本机后的告知：丢弃条数、时间范围、覆盖前备份位置。 */
  reportCloudSyncOverwrite: (result: OneDriveSyncResult) => void;
  /** 同步失败的统一收尾：冲突给出可执行指引，其余只体现在状态栏。 */
  reportCloudSyncFailure: (error: unknown) => void;
}

let recordsRequestId = 0;
let statsRequestId = 0;
let homeOverviewRequestId = 0;
let cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
// 启动云同步在一次应用会话里只跑一次。它现在挂在 store 上而不是首页组件里，
// 因此切换 tab 不会重启同步，也不会再出现“状态停在正在同步云端”的情况。
let startupCloudSyncStarted = false;

function scheduleCloudSync() {
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    cloudSyncTimer = null;
    const store = () => useGachaStore.getState();
    store().setCloudSyncStatus('checking', '正在同步云端');
    void gachaApi.getOneDriveStatus()
      .then((status) => status.connected ? gachaApi.syncOneDriveDatabase() : null)
      .then((result) => {
        if (!result) {
          store().setCloudSyncStatus('idle', '未连接 OneDrive');
          return;
        }
        store().reportCloudSyncOverwrite(result);
        store().setCloudSyncStatus(result.added_count > 0 ? 'updated' : 'current', result.added_count > 0 ? `云端已更新 ${result.added_count} 条` : '云端已是最新');
      })
      .catch((error) => store().reportCloudSyncFailure(error));
  }, 1500);
}

export const useGachaStore = create<GachaStore>((set, get) => ({
  records: [],
  recordsLoaded: false,
  recordsPlayerId: null,
  stats: null,
  statsPlayerId: null,
  pools: [],
  summaries: [],
  settings: null,
  loading: false,
  scanning: false,
  error: null,
  toastMessages: [],
  lastImportSummary: null,
  officialImportConflict: null,
  activePlayerId: null,
  confirmedBoundaryPoolTypes: [],
  confirmedBoundaryPlayerId: null,
  analyticsRevision: 0,
  initialized: false,
  cloudSyncStatus: { state: 'idle', message: '未同步', updatedAt: null },

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
    const requestId = ++statsRequestId;
    const requestedPlayerId = playerId ?? get().activePlayerId;
    try {
      const stats = await gachaApi.getStats(requestedPlayerId ?? undefined);
      if (requestId !== statsRequestId) return;
      set({ stats, statsPlayerId: requestedPlayerId });
    } catch {
      if (requestId !== statsRequestId) return;
      set({ stats: null, statsPlayerId: requestedPlayerId });
      // 静默失败，空数据时不需要提示
    }
  },

  fetchHomeOverview: async (playerId?: string) => {
    const requestId = ++homeOverviewRequestId;
    const requestedPlayerId = playerId ?? get().activePlayerId;
    set({ loading: true, error: null });
    try {
      const overview: HomeOverview = await gachaApi.getHomeOverview(requestedPlayerId ?? undefined);
      if (requestId !== homeOverviewRequestId) return;
      set({
        records: overview.records,
        recordsLoaded: true,
        recordsPlayerId: requestedPlayerId,
        stats: overview.stats,
        statsPlayerId: requestedPlayerId,
        confirmedBoundaryPlayerId: requestedPlayerId,
        loading: false,
      });
      set({ confirmedBoundaryPoolTypes: overview.confirmed_boundary_pool_types });
    } catch (e) {
      if (requestId !== homeOverviewRequestId) return;
      set({ error: String(e), loading: false });
    }
  },

  fetchSummaries: async () => {
    try {
      const summaries = await gachaApi.getRecordSummaries();
      set((state) => ({ summaries, analyticsRevision: state.analyticsRevision + 1 }));
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

  addLogPath: async (path: string, label?: string) => {
    try {
      await gachaApi.addLogPath(path, label);
      await get().fetchSettings();
      get().addToast('success', 'Client.log 路径已添加');
    } catch (e) {
      get().addToast('error', `添加失败: ${String(e)}`);
      throw e;
    }
  },

  removeLogPath: async (id: number) => {
    try {
      await gachaApi.removeLogPath(id);
      await get().fetchSettings();
      get().addToast('success', '已移除该路径');
    } catch (e) {
      get().addToast('error', `移除失败: ${String(e)}`);
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
        lastImportSummary: { ...result, source: 'game-dir', completed_at: Date.now() },
        confirmedBoundaryPlayerId: null,
      });

      await Promise.all([get().fetchPools(), get().fetchSummaries().catch(() => {})]);
      if (playerId) {
        await get().fetchStats(playerId);
      }
      scheduleCloudSync();

      void playUiFeedback('scan-complete');
    } catch (e) {
      set({ error: String(e), scanning: false });
      const conflict = officialMockOverlapMessage(e);
      if (conflict) set({ officialImportConflict: conflict });
      else get().addToast('error', String(e));
    }
  },

  scanGachaByUrl: async (url: string, source = 'url') => {
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
        lastImportSummary: { ...result, source, completed_at: Date.now() },
        confirmedBoundaryPlayerId: null,
      });

      await Promise.all([get().fetchPools(), get().fetchSummaries().catch(() => {})]);
      if (playerId) {
        await get().fetchStats(playerId);
      }
      scheduleCloudSync();

      void playUiFeedback('scan-complete');
    } catch (e) {
      set({ error: String(e), scanning: false });
      const conflict = officialMockOverlapMessage(e);
      if (conflict) set({ officialImportConflict: conflict });
      else get().addToast('error', String(e));
    }
  },

  importJson: async (filePath: string, expectedFileHash?: string) => {
    set({ scanning: true, error: null });
    try {
      const result = await gachaApi.importGachaJson(filePath, expectedFileHash);
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
        lastImportSummary: { ...result, source: 'json', completed_at: Date.now() },
        confirmedBoundaryPlayerId: null,
      });

      await Promise.all([get().fetchPools(), get().fetchSummaries().catch(() => {})]);
      if (playerId) {
        await get().fetchStats(playerId);
      }
      scheduleCloudSync();

      void playUiFeedback('data-rebuilt');
    } catch (e) {
      set({ error: String(e), scanning: false });
      const conflict = officialMockOverlapMessage(e);
      if (conflict) set({ officialImportConflict: conflict });
      else get().addToast('error', String(e));
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
          statsPlayerId: activePlayerId,
          loading: false,
          error: null,
        });
      }
      get().addToast('success', `已清空 ${result.deleted_count} 条记录`);
      if (result.backup_path) {
        get().addToast('info', `删除前备份已保存：${result.backup_path}`);
      }
      await Promise.all([get().fetchPools(), get().fetchSummaries().catch(() => {})]);
      scheduleCloudSync();
      return result;
    } catch (e) {
      get().addToast('error', `清空记录失败: ${String(e)}`);
      return null;
    }
  },

  setActivePlayer: (playerId: string | null) => {
    set({ activePlayerId: playerId });
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
      // 走 fetchHomeOverview 而不是 fetchStats：它同时刷新
      // confirmedBoundaryPoolTypes，否则首页和记录页的「≥」下界标记会停留在
      // 刷新前的状态，和刚拉回来的记录对不上。
      await get().fetchHomeOverview(activePlayerId);
    }
  },

  addToast: (type, message) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
    // 自动消失的计时交给 Toast 组件：它要在指针悬停时暂停并保留剩余时长，
    // store 里的裸 setTimeout 做不到，而且会让时长在 store 和 CSS 各存一份。
    set(s => ({ toastMessages: [...s.toastMessages, { id, type, message }].slice(-MAX_VISIBLE_TOASTS) }));
  },

  removeToast: (id) => {
    set(s => ({ toastMessages: s.toastMessages.filter(m => m.id !== id) }));
  },

  dismissImportSummary: () => set({ lastImportSummary: null }),
  showOfficialImportConflict: (message) => set({ officialImportConflict: message }),
  scheduleCloudSync: () => scheduleCloudSync(),
  setCloudSyncStatus: (state, message) => set({ cloudSyncStatus: { state, message, updatedAt: Date.now() } }),

  reportCloudSyncOverwrite: (result) => {
    for (const notice of cloudSyncOverwriteNotices(result)) {
      get().addToast(notice.type, notice.message);
    }
  },

  reportCloudSyncFailure: (error) => {
    const conflict = cloudSyncConflictNotice(error);
    if (conflict) get().addToast('info', conflict);
    get().setCloudSyncStatus('error', conflict ? '云端同步存在冲突' : '云端同步失败');
  },

  /**
   * 启动同步以前写在首页组件里，靠组件内的 cancelled 标记丢弃结果：切到别的
   * tab 会让这次同步的终态永远写不回来，界面就停在“正在同步云端”。现在它
   * 属于 store，无论页面是否卸载都会写终态；一次会话只跑一次，切 tab 也不再
   * 重新发起（云端快照下载耗时数秒，重复触发只会放大同步窗口）。
   */
  syncStartupCloud: async () => {
    if (startupCloudSyncStarted) return;
    startupCloudSyncStarted = true;
    try {
      const status = await gachaApi.getOneDriveStatus();
      if (!status.connected) {
        get().setCloudSyncStatus('idle', '未连接 OneDrive');
        return;
      }
      get().setCloudSyncStatus('checking', '正在同步云端');
      const result = await gachaApi.syncOneDriveDatabase('');
      await Promise.all([get().fetchPools(), get().fetchSummaries().catch(() => {})]);
      const playerId = get().activePlayerId;
      if (playerId) await get().fetchHomeOverview(playerId);
      if (result.added_count > 0) {
        get().addToast('success', `已从 OneDrive 更新 ${result.added_count} 条记录`);
      }
      get().reportCloudSyncOverwrite(result);
      get().setCloudSyncStatus(
        result.added_count > 0 ? 'updated' : 'current',
        result.added_count > 0 ? `云端已更新 ${result.added_count} 条` : '云端已是最新'
      );
    } catch (error) {
      // 启动同步失败不打扰用户：离线时应用仍要可用，细节留在状态栏和设置页。
      get().reportCloudSyncFailure(error);
    }
  },
}));
