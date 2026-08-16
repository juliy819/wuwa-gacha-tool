import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { recordsPath } from '../lib/recordNavigation';
import type { GachaRecord, GachaStats, PoolInfo } from '../types';
import { QUALITY } from '../types';
import AnimatedCounter from './AnimatedCounter';
import GlowCard from './GlowCard';
import ResourceIcon from './ResourceIcon';
import ResonanceIcon from './ResonanceModeIcon';

interface HomeDashboardProps {
  stats: GachaStats;
  records: GachaRecord[];
  confirmedBoundaryPools?: ReadonlySet<string>;
}

interface FiveStarResult {
  id: string;
  recordId?: number;
  poolType: string;
  resourceId: number;
  name: string;
  poolName: string;
  pity: number;
  isLowerBound: boolean;
  time: string;
  isOffRate: boolean;
}

const CORE_POOL_TYPES = new Set(['1', '2', '3', '4']);
const PITY_MILESTONES = [20, 40, 60, 80];
// 新旅 / 忆旅唤取池：仅有实际抽取记录时才显示
const OPTIONAL_POOL_TYPES = new Set(['8', '9', '12', '13']);
const RATIO_DIAL_TICKS = Array.from({ length: 16 }, (_, index) => index * 22.5);

function buildRecentFiveStars(
  records: GachaRecord[],
  confirmedBoundaryPools: ReadonlySet<string>,
): FiveStarResult[] {
  const pityByPool = new Map<string, number>();
  const poolsWithFiveStar = new Set<string>();
  const results: FiveStarResult[] = [];

  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    const pity = (pityByPool.get(record.card_pool_type) ?? 0) + 1;
    pityByPool.set(record.card_pool_type, pity);

    if (record.quality_level === QUALITY.FIVE_STAR) {
      const isLowerBound = !poolsWithFiveStar.has(record.card_pool_type)
        && !confirmedBoundaryPools.has(record.card_pool_type);
      poolsWithFiveStar.add(record.card_pool_type);
      results.push({
        id: `${record.card_pool_type}-${record.time}-${record.resource_id}-${index}`,
        recordId: record.id,
        poolType: record.card_pool_type,
        resourceId: record.resource_id,
        name: record.name,
        poolName: record.card_pool_name,
        pity,
        isLowerBound,
        time: record.time,
        isOffRate: record.is_off_rate,
      });
      pityByPool.set(record.card_pool_type, 0);
    }
  }

  return results.reverse().slice(0, 6);
}

function SummaryMetric({
  label,
  value,
  detail,
  icon,
  accent = false,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className="summary-metric min-w-0 px-4 py-3.5"
    >
      <div className="flex items-center gap-2 text-xs text-wave">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${accent ? 'text-[#d8bd84]' : 'text-tide'}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-wave-dim truncate">{detail}</div>
      <span className="summary-metric-node" aria-hidden="true" />
    </div>
  );
}

function RatioDial({ rate, wins, total }: { rate: number; wins: number; total: number }) {
  const safeRate = Math.min(Math.max(rate, 0), 100);
  return (
    <div className="ratio-dial-layout">
      <div className="ratio-dial" aria-label={`不歪率 ${safeRate.toFixed(1)}%`}>
        <svg viewBox="0 0 140 140" aria-hidden="true">
          <circle cx="70" cy="70" r="52" fill="none" stroke="#d4d4d4" strokeOpacity="0.08" strokeWidth="8" />
          <circle
            className="ratio-dial-progress"
            cx="70"
            cy="70"
            r="52"
            fill="none"
            pathLength="100"
            stroke="#8fc8be"
            strokeWidth="8"
            strokeLinecap="butt"
            transform="rotate(-90 70 70)"
            style={{ strokeDasharray: `${safeRate} ${100 - safeRate}` }}
          />
          <circle cx="70" cy="70" r="39" fill="none" stroke="#d8bd84" strokeOpacity="0.16" strokeWidth="1" strokeDasharray="2 5" />
          {RATIO_DIAL_TICKS.map((angle) => (
            <path key={angle} d="M70 8V14" transform={`rotate(${angle} 70 70)`} stroke={angle % 90 === 0 ? '#d8bd84' : '#d4d4d4'} strokeOpacity={angle % 90 === 0 ? 0.6 : 0.2} />
          ))}
        </svg>
        <div className="ratio-dial-value">
          <span>{total > 0 ? safeRate.toFixed(1) : '-'}</span>
          {total > 0 ? <small>%</small> : null}
        </div>
      </div>
      <div className="ratio-dial-legend">
        <div><span className="ratio-legend-mark ratio-legend-win" />不歪 <strong>{wins}</strong></div>
        <div><span className="ratio-legend-mark ratio-legend-off" />总五星 <strong>{total}</strong></div>
      </div>
    </div>
  );
}

function PityRow({ pool, onOpen }: { pool: PoolInfo; onOpen: () => void }) {
  const limit = 80;
  const progress = Math.min((pool.current_pity / limit) * 100, 100);
  const remaining = Math.max(limit - pool.current_pity, 0);
  const isHigh = pool.current_pity >= 66;

  return (
    <button type="button" onClick={onOpen} className="pity-row group w-full border-b border-white/[0.05] py-3 text-left" title={`查看${pool.pool_name}记录`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-tide truncate">{pool.pool_name}</div>
          <div className="mt-1 text-[11px] text-wave-dim">
            {pool.count} 抽 · {pool.five_star_count} 个五星
            {pool.avg_pity > 0 ? ` · 平均 ${pool.avg_pity.toFixed(1)} 抽` : ''}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className={`text-xl font-semibold tabular-nums ${isHigh ? 'text-[#d8bd84]' : 'text-tide'}`}>
            {pool.current_pity}
          </span>
          <span className="ml-1 text-xs text-wave">/ {limit}</span>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <div className="pity-track relative h-3 flex-1 overflow-hidden" aria-label={`当前 ${pool.current_pity} 抽，保底 ${limit} 抽`}>
          <div
            className={`pity-signal absolute inset-y-[3px] left-0 origin-left ${isHigh ? 'pity-signal-high' : ''}`}
            style={{ width: '100%', transform: `scaleX(${progress / 100})` }}
          />
          {PITY_MILESTONES.map((milestone) => (
            <span
              key={milestone}
              className={`pity-milestone-node ${pool.current_pity >= milestone ? 'pity-milestone-node-reached' : ''}`}
              style={{ left: `${(milestone / limit) * 100}%` }}
              aria-hidden="true"
            />
          ))}
          <span
            className={`pity-measure-point ${isHigh ? 'pity-measure-point-high' : ''}`}
            style={{ left: `${progress}%`, opacity: pool.current_pity > 0 ? 1 : 0 }}
          />
        </div>
        <span className="w-16 text-right text-[11px] text-wave">
          剩 {remaining} 抽
        </span>
      </div>
    </button>
  );
}

export default function HomeDashboard({ stats, records, confirmedBoundaryPools = new Set() }: HomeDashboardProps) {
  const navigate = useNavigate();
  const openRecords = (poolType: string, recordId?: number) => {
    const target = recordsPath({ poolType, recordId, sortOrder: recordId === undefined ? 'desc' : undefined, source: recordId === undefined ? 'home-pity' : 'home-five-star' });
    navigate(target.pathname, { state: target.state });
  };
  const recentFiveStars = useMemo(
    () => buildRecentFiveStars(records, confirmedBoundaryPools),
    [confirmedBoundaryPools, records],
  );
  const recordRange = useMemo(() => {
    if (records.length === 0) return null;
    return {
      earliest: records[records.length - 1].time.slice(0, 10),
      latest: records[0].time.slice(0, 10),
    };
  }, [records]);
  const visiblePools = useMemo(
    () => stats.pools.filter((pool) =>
      CORE_POOL_TYPES.has(pool.pool_type)
      || (OPTIONAL_POOL_TYPES.has(pool.pool_type) && pool.count > 0)),
    [stats.pools],
  );
  const eventRoleFiveStars = stats.pools
    .filter((pool) => ['1', '8', '10'].includes(pool.pool_type))
    .reduce((sum, pool) => sum + pool.five_star_count, 0);
  const notOffRateCount = Math.max(eventRoleFiveStars - stats.off_rate_count, 0);

  return (
    <div className="dashboard-enter home-dashboard space-y-4">
      <section
        className="resonance-metrics grid grid-cols-2 gap-px overflow-hidden md:grid-cols-3 xl:grid-cols-6"
      >
        <SummaryMetric label="累计唤取" value={<AnimatedCounter value={stats.total_draws} shimmer pulse milestone />} detail={`${stats.total_four_star} 个四星`} icon={<ResonanceIcon kind="spark" size={14} />} />
        <SummaryMetric label="五星数量" value={<AnimatedCounter value={stats.total_five_star} pulse milestone />} detail="已导入记录中的五星" icon={<ResonanceIcon kind="trophy" size={14} />} accent />
        <SummaryMetric label="五星概率" value={<AnimatedCounter value={stats.five_star_rate} formatter={(v) => `${v.toFixed(2)}%`} pulse />} detail="占全部已导入记录" icon={<ResonanceIcon kind="target" size={14} />} />
        <SummaryMetric label="平均五星抽数" value={<AnimatedCounter value={stats.avg_five_star_pity} formatter={(v) => (v > 0 ? `${v.toFixed(1)} 抽` : '-')} />} detail="仅统计可确认五星间隔" icon={<ResonanceIcon kind="chart" size={14} />} />
        <SummaryMetric label="每个 UP 角色" value={<AnimatedCounter value={stats.avg_up_role_pulls} formatter={(v) => (v > 0 ? `${v.toFixed(1)} 抽` : '-')} />} detail="完整 UP 周期均值" icon={<ResonanceIcon kind="user" size={14} />} accent />
        <SummaryMetric label="每把 UP 武器" value={<AnimatedCounter value={stats.avg_up_weapon_pulls} formatter={(v) => (v > 0 ? `${v.toFixed(1)} 抽` : '-')} />} detail="完整五星周期均值" icon={<ResonanceIcon kind="weapon" size={14} />} accent />
      </section>

      <div className="home-dashboard-primary grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
        <GlowCard
          className="resonance-panel px-5 py-4"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="panel-heading flex items-center gap-2 text-sm font-medium text-tide">
                <ResonanceIcon kind="activity" size={15} /> 当前垫抽
              </h2>
              <p className="mt-1 text-[11px] text-wave-dim">各类卡池独立累计，不跨池合并</p>
            </div>
            <span className="tech-chip px-2 py-1 text-[10px] text-wave">五星保底 80</span>
          </div>
          <div className="home-pity-grid mt-2 grid grid-cols-2 gap-x-6">
            {visiblePools.map((pool) => <PityRow key={pool.pool_type} pool={pool} onOpen={() => openRecords(pool.pool_type)} />)}
          </div>
        </GlowCard>

        <GlowCard
          className="resonance-panel p-5"
        >
          <h2 className="panel-heading flex items-center gap-2 text-sm font-medium text-tide">
            <ResonanceIcon kind="target" size={15} /> UP 角色池表现
          </h2>
          <p className="mt-1 text-[11px] text-wave-dim">仅统计 UP 角色池中的五星结果</p>

          <RatioDial rate={stats.win_rate_5050} wins={notOffRateCount} total={eventRoleFiveStars} />

          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-white/[0.06] bg-white/[0.06]">
            <div className="submetric-cell p-3">
              <div className="text-[11px] text-wave">不歪次数</div>
              <div className="mt-1 text-xl font-semibold text-[#8fc8be]">{notOffRateCount}</div>
            </div>
            <div className="submetric-cell p-3">
              <div className="text-[11px] text-wave">歪的次数</div>
              <div className="mt-1 text-xl font-semibold text-[#d99a9a]">{stats.off_rate_count}</div>
            </div>
          </div>
        </GlowCard>
      </div>

      <GlowCard
        className="resonance-panel p-5"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="panel-heading flex items-center gap-2 text-sm font-medium text-tide">
              <ResonanceIcon kind="trophy" size={15} /> 最近五星
            </h2>
            <p className="mt-1 text-[11px] text-wave-dim">未确认历史起点的首个五星以 ≥ 标记抽数下界</p>
          </div>
          <span className="text-[11px] text-wave">
            {recordRange ? `数据截至 ${recordRange.latest}` : `最近 ${recentFiveStars.length} 条`}
          </span>
        </div>

        {recentFiveStars.length > 0 ? (
          <div className="recent-five-grid mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-white/[0.06] bg-white/[0.06] md:grid-cols-2 xl:grid-cols-3">
            {recentFiveStars.map((item) => (
              <button type="button" key={item.id} onClick={() => openRecords(item.poolType, item.recordId)} className="five-star-entry group flex min-w-0 items-center gap-3 px-4 py-3 text-left" title="在记录页中定位">
                <div className="record-resource-frame record-resource-frame-five relative h-11 w-11 shrink-0 overflow-hidden rounded-md border border-[#d8bd84]/25 bg-[#d8bd84]/[0.07]">
                  <ResourceIcon
                    resourceId={item.resourceId}
                    alt={item.name}
                    defer
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                    fallback={(
                      <div className="absolute inset-0 flex items-center justify-center text-[#d8bd84]">
                        <ResonanceIcon kind="trophy" size={18} />
                      </div>
                    )}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-tide">{item.name}</span>
                    {item.isOffRate && <span className="shrink-0 rounded bg-[#c77f7f]/10 px-1.5 py-0.5 text-[10px] text-[#d99a9a]">歪</span>}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-wave">{item.poolName} · {item.time.slice(0, 10)}</div>
                </div>
                <div className="flex shrink-0 items-baseline gap-0.5 rounded border border-[#d8bd84]/15 bg-[#d8bd84]/[0.05] px-2 py-1 text-sm font-semibold tabular-nums text-[#d8bd84]">
                  <span>{item.isLowerBound ? '≥' : ''}{item.pity}</span>
                  <span className="text-[10px] font-normal">抽</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="resonance-inline-empty mt-4 rounded-md border border-dashed border-white/[0.08] py-8 text-center text-sm text-wave">
            暂无五星记录
          </div>
        )}
      </GlowCard>
    </div>
  );
}
