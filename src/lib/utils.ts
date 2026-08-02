export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** 久未同步 → 两档阈值。
 * - >120 天（约 4 个月）：warn 档，提醒尽快同步（仍在官方 6 个月保留期内，风险较低）
 * - >180 天（约 6 个月）：danger 档，官方链接已大概率覆盖不到该时间段，可能存在数据遗漏（非绝对 — 可能那段时间根本没抽卡）
 */
export const SYNC_WARN_DAYS = 120;
export const SYNC_DANGER_DAYS = 180;

export type SyncFreshness = 'fresh' | 'warn' | 'danger';

/** 按本地日历日期计算间隔天数，避免夏令时和时区偏移造成边界误判。无效日期返回 Infinity。 */
export function daysSince(dateStr: string, today = new Date()): number {
  if (!dateStr) return Infinity;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!match) return Infinity;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dateUtc = Date.UTC(year, month - 1, day);
  const parsed = new Date(dateUtc);
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return Infinity;

  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = (todayUtc - dateUtc) / 86_400_000;
  return Math.max(0, Math.floor(diff));
}

/** 推断时间仍参与风险判断；isInferred 只控制界面标记，不应掩盖历史数据缺口。 */
export function getSyncFreshness(
  lastImportedAt?: string | null,
  _isInferred?: boolean | null,
  today = new Date(),
): SyncFreshness {
  if (!lastImportedAt) return 'fresh';
  const n = daysSince(lastImportedAt, today);
  if (n > SYNC_DANGER_DAYS) return 'danger';
  if (n > SYNC_WARN_DAYS) return 'warn';
  return 'fresh';
}
