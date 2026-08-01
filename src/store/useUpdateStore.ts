import { create } from 'zustand';
import { check, type Update } from '@tauri-apps/plugin-updater';

const NOTIFIED_KEY = 'wuwa-update-last-notified';
// 单个 endpoint 的请求超时（毫秒），防止代理建连后挂起导致无限转圈
const CHECK_TIMEOUT = 10000;

interface UpdateStore {
  availableUpdate: Update | null;
  checking: boolean;
  autoCheck: () => Promise<void>;
  manualCheck: () => Promise<Update | null>;
  clearAvailable: () => void;
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  availableUpdate: null,
  checking: false,

  // 启动时静默检查：仅 Toast 提示一次，不弹模态框
  autoCheck: async () => {
    if (get().checking) return;
    set({ checking: true });
    try {
      const update = await check({ timeout: CHECK_TIMEOUT });
      if (update) {
        set({ availableUpdate: update });
        // 同一版本只 Toast 提示一次
        const lastNotified = localStorage.getItem(NOTIFIED_KEY);
        if (lastNotified !== update.version) {
          localStorage.setItem(NOTIFIED_KEY, update.version);
          // 延迟导入避免循环依赖
          const { useGachaStore } = await import('./useGachaStore');
          useGachaStore.getState().addToast('info', `发现新版本 v${update.version}，可在设置中更新`);
        }
      }
    } catch {
      // 静默失败，不打扰用户
    } finally {
      set({ checking: false });
    }
  },

  // 设置页手动检查：返回 update 供页面弹模态框
  // 返回 null 表示当前已是最新版本；抛出异常表示检查失败（网络/代理问题）
  manualCheck: async () => {
    set({ checking: true });
    try {
      const update = await check({ timeout: CHECK_TIMEOUT });
      if (update) {
        set({ availableUpdate: update });
      }
      return update;
    } finally {
      set({ checking: false });
    }
  },

  clearAvailable: () => set({ availableUpdate: null }),
}));
