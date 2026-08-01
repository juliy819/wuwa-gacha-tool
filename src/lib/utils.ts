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

/** 计算给定 YYYY-MM-DD HH:mm:ss 字符串距离"今天本地零点"过去了多少天（不含时间部分）。无效日期返回 Infinity。 */
export function daysSince(dateStr: string): number {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr.slice(0, 10));
  if (Number.isNaN(d.getTime())) return Infinity;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const diff = (today.getTime() - d.getTime()) / 86_400_000;
  return Math.max(0, Math.floor(diff));
}

/** 仅对"非推断"的真实导入时间做 freshness 判断。推断时间是由 MAX(record.time) 回填的，不适合拿来动态判断缺口。 */
export function getSyncFreshness(
  lastImportedAt?: string | null,
  isInferred?: boolean | null,
): SyncFreshness {
  if (!lastImportedAt) return 'fresh';
  if (isInferred === true) return 'fresh';
  const n = daysSince(lastImportedAt);
  if (n > SYNC_DANGER_DAYS) return 'danger';
  if (n > SYNC_WARN_DAYS) return 'warn';
  return 'fresh';
}
