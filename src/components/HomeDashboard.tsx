import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarRange,
  CircleDot,
  Crosshair,
  Swords,
  Sparkles,
  Trophy,
  UserRoundCheck,
} from 'lucide-react';
import type { GachaRecord, GachaStats, PoolInfo } from '../types';
import { QUALITY } from '../types';
import AnimatedCounter from './AnimatedCounter';
import GlowCard from './GlowCard';
import ResourceIcon from './ResourceIcon';

interface HomeDashboardProps {
  stats: GachaStats;
  records: GachaRecord[];
}

interface FiveStarResult {
  id: string;
  resourceId: number;
  name: string;
  poolName: string;
  pity: number;
  time: string;
  isOffRate: boolean;
}

const CORE_POOL_TYPES = new Set(['1', '2', '3', '4']);
// 新旅 / 忆旅唤取池：仅有实际抽取记录时才显示
const OPTIONAL_POOL_TYPES = new Set(['8', '9', '12', '13']);

function buildRecentFiveStars(records: GachaRecord[]): FiveStarResult[] {
  const pityByPool = new Map<string, number>();
  const results: FiveStarResult[] = [];

  [...records]
    .sort((a, b) => {
      const timeOrder = a.time.localeCompare(b.time);
      return timeOrder !== 0 ? timeOrder : (b.id ?? 0) - (a.id ?? 0);
    })
    .forEach((record, index) => {
      const pity = (pityByPool.get(record.card_pool_type) ?? 0) + 1;
      pityByPool.set(record.card_pool_type, pity);

      if (record.quality_level === QUALITY.FIVE_STAR) {
        results.push({
          id: `${record.card_pool_type}-${record.time}-${record.resource_id}-${index}`,
          resourceId: record.resource_id,
          name: record.name,
          poolName: record.card_pool_name,
          pity,
          time: record.time,
          isOffRate: record.is_off_rate,
        });
        pityByPool.set(record.card_pool_type, 0);
      }
    });

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
    <div className="min-w-0 bg-[#242424] px-4 py-3.5 transition-colors duration-200 hover:bg-[#252525]">
      <div className="flex items-center gap-2 text-xs text-wave">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${accent ? 'text-[#d8bd84]' : 'text-tide'}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-wave-dim truncate">{detail}</div>
    </div>
  );
}

function PityRow({ pool }: { pool: PoolInfo }) {
  const limit = 80;
  const progress = Math.min((pool.current_pity / limit) * 100, 100);
  const remaining = Math.max(limit - pool.current_pity, 0);
  const isHigh = pool.current_pity >= 66;

  return (
    <div className="py-3 border-b border-white/[0.05]">
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
        <div
          className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]"
          style={{
            backgroundImage: 'repeating-linear-gradient(90deg, transparent 0, transparent calc(12.5% - 1px), rgba(255,255,255,0.08) calc(12.5% - 1px), rgba(255,255,255,0.08) 12.5%)',
          }}
        >
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className={`h-full rounded-full ${isHigh ? 'bg-[#d8bd84]' : 'bg-[#6faaa0]'}`}
          />
        </div>
        <span className="w-16 text-right text-[11px] text-wave">
          剩 {remaining} 抽
        </span>
      </div>
    </div>
  );
}

export default function HomeDashboard({ stats, records }: HomeDashboardProps) {
  const recentFiveStars = useMemo(() => buildRecentFiveStars(records), [records]);
  const recordRange = useMemo(() => {
    if (records.length === 0) return null;
    const times = records.map((record) => record.time).sort((a, b) => a.localeCompare(b));
    return {
      earliest: times[0].slice(0, 10),
      latest: times[times.length - 1].slice(0, 10),
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
    <div className="space-y-4">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.06] md:grid-cols-3 xl:grid-cols-6"
      >
        <SummaryMetric label="累计唤取" value={<AnimatedCounter value={stats.total_draws} shimmer pulse milestone />} detail={`${stats.total_four_star} 个四星`} icon={<Sparkles size={13} />} />
        <SummaryMetric label="五星数量" value={<AnimatedCounter value={stats.total_five_star} pulse milestone />} detail="已导入记录中的五星" icon={<Trophy size={13} />} accent />
        <SummaryMetric label="五星概率" value={<AnimatedCounter value={stats.five_star_rate} formatter={(v) => `${v.toFixed(2)}%`} pulse />} detail="占全部已导入记录" icon={<CircleDot size={13} />} />
        <SummaryMetric label="平均五星抽数" value={<AnimatedCounter value={stats.avg_five_star_pity} formatter={(v) => (v > 0 ? `${v.toFixed(1)} 抽` : '-')} />} detail="各卡池分别计算后汇总" icon={<BarChart3 size={13} />} />
        <SummaryMetric label="每个 UP 角色" value={<AnimatedCounter value={stats.avg_up_role_pulls} formatter={(v) => (v > 0 ? `${v.toFixed(1)} 抽` : '-')} />} detail="UP 角色池整体投入" icon={<UserRoundCheck size={13} />} accent />
        <SummaryMetric label="每把 UP 武器" value={<AnimatedCounter value={stats.avg_up_weapon_pulls} formatter={(v) => (v > 0 ? `${v.toFixed(1)} 抽` : '-')} />} detail="UP 武器池整体投入" icon={<Swords size={13} />} accent />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.04 }}
        className="flex flex-col gap-3 rounded-lg border border-white/[0.06] bg-[#222222] px-4 py-3 md:flex-row md:items-center md:justify-between"
      >
        <div className="flex min-w-0 items-center gap-2 text-xs text-tide-dim">
          <CalendarRange size={14} className="shrink-0 text-[#8fc8be]" />
          {recordRange ? (
            <span>
              已导入记录：<span className="tabular-nums text-tide">{recordRange.earliest}</span>
              <span className="mx-1.5 text-wave">至</span>
              <span className="tabular-nums text-tide">{recordRange.latest}</span>
            </span>
          ) : (
            <span>正在读取记录日期</span>
          )}
        </div>
        <div className="flex min-w-0 items-start gap-2 text-[11px] leading-5 text-[#c9ab78] md:max-w-[560px] md:justify-end">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>官方抽卡链接仅保留近约 6 个月；两次同步间隔超过 6 个月，较早记录可能丢失且无法补回。</span>
        </div>
      </motion.section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
        <GlowCard
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06 }}
          className="rounded-lg border border-white/[0.06] bg-[#242424] px-5 py-4"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-medium text-tide">
                <Activity size={14} /> 当前垫抽
              </h2>
              <p className="mt-1 text-[11px] text-wave-dim">各类卡池独立累计，不跨池合并</p>
            </div>
            <span className="rounded border border-white/[0.07] px-2 py-1 text-[10px] text-wave">五星保底 80</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-6">
            {visiblePools.map((pool) => <PityRow key={pool.pool_type} pool={pool} />)}
          </div>
        </GlowCard>

        <GlowCard
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-lg border border-white/[0.06] bg-[#242424] p-5"
        >
          <h2 className="flex items-center gap-2 text-sm font-medium text-tide">
            <Crosshair size={14} /> UP 角色池表现
          </h2>
          <p className="mt-1 text-[11px] text-wave-dim">仅统计 UP 角色池中的五星结果</p>

          <div className="mt-6 border-l-2 border-[#6faaa0] pl-4">
            <div className="text-[11px] text-wave">不歪率</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-[#8fc8be]">
              {eventRoleFiveStars > 0 ? `${stats.win_rate_5050.toFixed(1)}%` : '-'}
            </div>
            <div className="mt-1 text-xs text-wave">
              不歪 {notOffRateCount} 次 / 共 {eventRoleFiveStars} 次五星
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-white/[0.06] bg-white/[0.06]">
            <div className="bg-[#202020] p-3">
              <div className="text-[11px] text-wave">不歪次数</div>
              <div className="mt-1 text-xl font-semibold text-[#8fc8be]">{notOffRateCount}</div>
            </div>
            <div className="bg-[#202020] p-3">
              <div className="text-[11px] text-wave">歪的次数</div>
              <div className="mt-1 text-xl font-semibold text-[#d99a9a]">{stats.off_rate_count}</div>
            </div>
          </div>
        </GlowCard>
      </div>

      <GlowCard
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14 }}
        className="rounded-lg border border-white/[0.06] bg-[#242424] p-5"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-medium text-tide">
              <Trophy size={14} /> 最近五星
            </h2>
            <p className="mt-1 text-[11px] text-wave-dim">抽数按各自卡池独立计算</p>
          </div>
          <span className="text-[11px] text-wave">
            {recordRange ? `数据截至 ${recordRange.latest}` : `最近 ${recentFiveStars.length} 条`}
          </span>
        </div>

        {recentFiveStars.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-white/[0.06] bg-white/[0.06] md:grid-cols-2 xl:grid-cols-3">
            {recentFiveStars.map((item) => (
              <div key={item.id} className="flex min-w-0 items-center gap-3 bg-[#202020] px-4 py-3">
                <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md border border-[#d8bd84]/25 bg-[#d8bd84]/[0.07]">
                  <ResourceIcon
                    resourceId={item.resourceId}
                    alt={item.name}
                    className="h-full w-full object-cover"
                    fallback={(
                      <div className="absolute inset-0 flex items-center justify-center text-[#d8bd84]">
                        <Trophy size={17} />
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
                  <span>{item.pity}</span>
                  <span className="text-[10px] font-normal">抽</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-md border border-dashed border-white/[0.08] py-8 text-center text-sm text-wave">
            暂无五星记录
          </div>
        )}
      </GlowCard>
    </div>
  );
}
