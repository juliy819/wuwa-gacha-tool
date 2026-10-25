import { displayPath } from './shareMode';
import type { OneDriveSyncResult } from '../types';

export interface CloudSyncNotice {
  type: 'success' | 'error' | 'info';
  message: string;
}

function formatLostRange(earliest: string | null, latest: string | null): string {
  if (!earliest) return '';
  const from = earliest.slice(0, 10);
  const to = latest?.slice(0, 10) ?? from;
  return from === to ? `（${from}）` : `（${from} 至 ${to}）`;
}

/**
 * 云端覆盖本机是整库替换，界面不能只报“已是最新”：
 * 必须说清丢掉了多少条本机记录、覆盖了哪个时间段，以及覆盖前的备份在哪。
 * 后端只有在真的执行了覆盖时才返回这些信息。
 */
export function cloudSyncOverwriteNotices(result: OneDriveSyncResult): CloudSyncNotice[] {
  const notices: CloudSyncNotice[] = [];
  if (result.lost_count > 0) {
    notices.push({
      type: 'error',
      message: `云端覆盖本机：丢弃了本机 ${result.lost_count} 条记录${formatLostRange(result.lost_earliest, result.lost_latest)}`
    });
  }
  if (result.backup_path) {
    notices.push({
      type: 'info',
      message: `覆盖前的本机数据已备份：${displayPath(result.backup_path)}`
    });
  }
  return notices;
}

/**
 * 两端都有改动时后端会拒绝同步并要求用户表态；这条错误只在状态栏里显示
 * 会让用户不知道该怎么办，因此额外给出可执行的一句指引。
 */
export function cloudSyncConflictNotice(error: unknown): string | null {
  const message = String(error);
  if (message.includes('首次连接')) {
    return '本机和云端都有数据，无法自动判断保留哪一端；请到设置页的云同步里选择';
  }
  if (message.includes('都已发生变化')) {
    return '本机和云端都有新数据，为避免覆盖已停下；请到设置页的云同步里选择保留哪一端';
  }
  return null;
}