import { useEffect, useMemo, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import {
  getSyncFreshness,
  daysSince,
  SYNC_WARN_DAYS,
  SYNC_DANGER_DAYS,
  type SyncFreshness as SyncFreshnessType,
} from '../lib/utils';
import { useGachaStore } from '../store/useGachaStore';
import { displayUid } from '../lib/shareMode';
import ResonanceIcon from './ResonanceModeIcon';

export default function StatusBar() {
  const [appVersion, setAppVersion] = useState('');
  const summaries = useGachaStore((state) => state.summaries);
  const activePlayerId = useGachaStore((state) => state.activePlayerId);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  const activeSummary = useMemo(
    () => summaries.find((summary) => summary.player_id === activePlayerId),
    [summaries, activePlayerId],
  );

  const recordRange = useMemo(() => {
    if (!activeSummary) return null;
    return `${activeSummary.earliest_time.slice(0, 10)} 至 ${activeSummary.latest_time.slice(0, 10)}`;
  }, [activeSummary]);

  const lastImported = useMemo(() => {
    if (!activeSummary?.last_imported_at) return null;
    const freshness = getSyncFreshness(activeSummary.last_imported_at, activeSummary.is_inferred);
    return {
      date: activeSummary.last_imported_at.slice(0, 10),
      isInferred: activeSummary.is_inferred === true,
      freshness,
      daysAgo: daysSince(activeSummary.last_imported_at),
    };
  }, [activeSummary]);

  const activeRecordCount = activeSummary?.record_count ?? 0;

  // 根据 freshness 返回颜色类
  const stalePalette = (freshness: SyncFreshnessType) => {
    switch (freshness) {
      case 'danger':
        return {
          text: 'text-[#d99a9a]',
          icon: 'text-[#d84848]',
          accent: 'text-[#d84848]',
          label: '可能缺数据',
          hint: `距上次同步已 ${lastImported?.daysAgo ?? 0} 天（超过 ${SYNC_DANGER_DAYS} 天阈值）。官方链接通常只保留近 6 个月，这段时间可能已存在数据遗漏（若期间未抽卡则不会丢数据）。`,
        };
      case 'warn':
        return {
          text: 'text-[#d9bd9a]',
          icon: 'text-[#d09960]',
          accent: 'text-[#d09960]',
          label: '久未同步',
          hint: `距上次同步已 ${lastImported?.daysAgo ?? 0} 天（超过 ${SYNC_WARN_DAYS} 天阈值）。建议尽快同步以免丢失 6 个月临界区的缺口。`,
        };
      default:
        return { text: 'text-tide-dim', icon: 'text-[#c9ab78]', accent: '', label: '', hint: '' };
    }
  };

  const palette = lastImported ? stalePalette(lastImported.freshness) : null;

  return (
    <div
      className="app-status-bar flex items-center justify-between gap-4 px-6 py-1.5 text-xs text-wave"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>Wuwa Gacha Tool{appVersion && ` v${appVersion}`}</span>

        {activePlayerId && (
          <>
            <span className="h-3 w-px bg-white/10" />
            <span className="flex items-center gap-1.5">
              <ResonanceIcon kind="user" size={12} className="text-[#8fc8be]" />
              <span className="tabular-nums text-tide-dim">UID {displayUid(activePlayerId)}</span>
            </span>
            {activeRecordCount > 0 && (
              <>
                <span className="h-3 w-px bg-white/10" />
                <span>{activeRecordCount.toLocaleString()} 条记录</span>
              </>
            )}
            {recordRange && (
              <>
                <span className="h-3 w-px bg-white/10" />
                <span className="flex items-center gap-1.5">
                  <ResonanceIcon kind="calendar" size={12} className="text-[#8fc8be]" />
                  <span className="tabular-nums text-tide-dim">{recordRange}</span>
                </span>
              </>
            )}
            {lastImported && palette && (
              <>
                <span className="h-3 w-px bg-white/10" />
                <span
                  className={`flex items-center gap-1.5 ${lastImported.freshness !== 'fresh' ? palette.text : ''}`}
                  title={lastImported.freshness !== 'fresh' ? palette.hint : undefined}
                >
                  <ResonanceIcon
                    kind="sync"
                    size={12}
                    className={lastImported.freshness === 'fresh' ? 'text-[#c9ab78]' : palette.icon}
                  />
                  <span>最近同步</span>
                  <span
                    className={`tabular-nums ${lastImported.freshness === 'fresh' ? 'text-tide-dim' : palette.text}`}
                  >
                    {lastImported.date}
                  </span>
                  {lastImported.freshness === 'warn' && (
                    <ResonanceIcon kind="warning" size={12} className={palette.icon} />
                  )}
                  {lastImported.freshness === 'danger' && (
                    <ResonanceIcon kind="error" size={12} className={palette.icon} />
                  )}
                  {lastImported.isInferred && (
                    <span
                      className="inline-flex items-center gap-1 rounded border border-[#c9ab78]/25 bg-[#c9ab78]/[0.08] px-1 py-px text-[9px] text-[#c9ab78]"
                      title="升级前已导入数据，同步时间由记录范围推断"
                    >
                      <ResonanceIcon kind="info" size={9} /> 推断
                    </span>
                  )}
                </span>
              </>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <div className="status-ready-dot h-1.5 w-1.5 rounded-full bg-[#7ab88a]" />
          就绪
        </span>
      </div>
    </div>
  );
}
