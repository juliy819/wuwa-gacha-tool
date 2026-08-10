import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import AnalyticsChart from '../components/AnalyticsChart';
import PageTransition from '../components/PageTransition';
import PageSignalField from '../components/PageSignalField';
import ResonanceEmptyState from '../components/ResonanceEmptyState';
import ResonanceIcon from '../components/ResonanceModeIcon';
import { gachaApi } from '../services/tauri-api';
import { useGachaStore } from '../store/useGachaStore';
import type { GachaInsights, PityDistributionBin, PoolInsight } from '../types';

const OFFICIAL_FIVE_STAR_RATE = 0.0185;
const FIVE_STAR_EXPECTED_PULLS = Number((1 / OFFICIAL_FIVE_STAR_RATE).toFixed(1));
const FEATURED_EXPECTED_PULLS = FIVE_STAR_EXPECTED_PULLS * 1.5;
const CHART_TEXT = '#9b9d9b';
const CHART_GRID = 'rgba(255,255,255,0.055)';
const LIMITED_ROLE_POOL_TYPES = new Set(['1', '8', '10', '12']);
const SOFT_PITY_POOL_TYPES = new Set(['1', '2', '3', '4', '6', '7', '8', '9', '10', '11', '12', '13']);
const FORECAST_THRESHOLDS = [0.5, 0.8, 0.9, 0.95];

interface ForecastPoint {
  pulls: number;
  fiveStar: number;
  featured: number | null;
}

interface GachaForecast {
  points: ForecastPoint[];
  nextPullRate: number;
  expectedFiveStar: number;
  expectedFeatured: number | null;
  fiveStarThresholds: Array<{ probability: number; pulls: number }>;
  featuredThresholds: Array<{ probability: number; pulls: number }>;
}

function fiveStarRateAtPity(pull: number) {
  if (pull <= 65) return 0.008;
  if (pull <= 70) return 0.008 + 0.04 * (pull - 65);
  if (pull <= 75) return 0.208 + 0.08 * (pull - 70);
  if (pull <= 78) return 0.608 + 0.1 * (pull - 75);
  return 1;
}

function theoreticalThreshold(target: number) {
  let survival = 1;
  for (let pull = 1; pull <= 79; pull += 1) {
    survival *= 1 - fiveStarRateAtPity(pull);
    if (1 - survival >= target) return pull;
  }
  return 79;
}

function thresholdPulls(points: ForecastPoint[], key: 'fiveStar' | 'featured') {
  return FORECAST_THRESHOLDS.map((probability) => ({
    probability,
    pulls: points.find((point) => (point[key] ?? 0) >= probability)?.pulls ?? points.at(-1)?.pulls ?? 0,
  }));
}

function buildGachaForecast(pool: PoolInsight): GachaForecast {
  const isLimitedRole = LIMITED_ROLE_POOL_TYPES.has(pool.pool_type);
  const maxFiveStarPulls = Math.max(1, 79 - pool.current_pity);
  const maxFeaturedPulls = isLimitedRole ? maxFiveStarPulls + (pool.featured_guaranteed ? 0 : 79) : maxFiveStarPulls;
  let fiveStarSurvival = 1;
  let expectedFiveStar = 0;
  let featuredFound = 0;
  let expectedFeatured = 0;
  let states = new Map<string, number>([[`${pool.current_pity}:${pool.featured_guaranteed ? 1 : 0}`, 1]]);
  const points: ForecastPoint[] = [{ pulls: 0, fiveStar: 0, featured: isLimitedRole ? 0 : null }];

  for (let step = 1; step <= maxFeaturedPulls; step += 1) {
    if (step <= maxFiveStarPulls) {
      const rate = fiveStarRateAtPity(pool.current_pity + step);
      const hit = fiveStarSurvival * rate;
      expectedFiveStar += step * hit;
      fiveStarSurvival *= 1 - rate;
    }

    if (isLimitedRole) {
      const nextStates = new Map<string, number>();
      for (const [key, stateProbability] of states) {
        const [pityText, guaranteeText] = key.split(':');
        const pity = Number(pityText);
        const guaranteed = guaranteeText === '1';
        const rate = fiveStarRateAtPity(pity + 1);
        const missProbability = stateProbability * (1 - rate);
        if (missProbability > 0) {
          const missKey = `${pity + 1}:${guaranteed ? 1 : 0}`;
          nextStates.set(missKey, (nextStates.get(missKey) ?? 0) + missProbability);
        }
        const featuredHit = stateProbability * rate * (guaranteed ? 1 : 0.5);
        featuredFound += featuredHit;
        expectedFeatured += step * featuredHit;
        if (!guaranteed) {
          const lostProbability = stateProbability * rate * 0.5;
          if (lostProbability > 0) nextStates.set('0:1', (nextStates.get('0:1') ?? 0) + lostProbability);
        }
      }
      states = nextStates;
    }

    points.push({
      pulls: step,
      fiveStar: 1 - fiveStarSurvival,
      featured: isLimitedRole ? Math.min(1, featuredFound) : null,
    });
  }

  return {
    points,
    nextPullRate: fiveStarRateAtPity(pool.current_pity + 1),
    expectedFiveStar,
    expectedFeatured: isLimitedRole ? expectedFeatured : null,
    fiveStarThresholds: thresholdPulls(points, 'fiveStar'),
    featuredThresholds: isLimitedRole ? thresholdPulls(points, 'featured') : [],
  };
}

const RELIABILITY = {
  insufficient: { label: '样本较少', tone: '#a7aaa8' },
  low: { label: '初步趋势', tone: '#d8bd84' },
  medium: { label: '趋势稳定', tone: '#b9bdb9' },
  high: { label: '样本充分', tone: '#d0c18f' },
} as const;

function formatPull(value: number | null) {
  return value === null ? '-' : `${value.toFixed(Number.isInteger(value) ? 0 : 1)} 抽`;
}

function Metric({ label, value, detail, tone = '#e2e4e3' }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className="analysis-metric min-w-0 px-4 py-3.5">
      <div className="text-[11px] text-wave">{label}</div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums" style={{ color: tone }}>{value}</div>
      <div className="mt-1 text-[10px] leading-snug text-wave-dim">{detail}</div>
    </div>
  );
}

function buildHistogramOption(
  bins: PityDistributionBin[],
  maxPull: number,
  expectedPulls: number,
  expectedLabel: string,
  tooltipLabel: string,
) {
  return {
    animationDuration: 420,
    animationEasing: 'cubicOut',
    grid: { left: 42, right: 18, top: 36, bottom: 34 },
    tooltip: {
      trigger: 'item',
      backgroundColor: '#222625',
      borderColor: 'rgba(212,212,212,0.2)',
      textStyle: { color: '#e2e4e3', fontSize: 11 },
      formatter: (params: { dataIndex: number }) => {
        const bin = bins[params.dataIndex];
        return `${bin.label} 抽<br/><b>${bin.count}</b> 次${tooltipLabel} · ${bin.percentage.toFixed(1)}%`;
      },
    },
    xAxis: {
      type: 'value', min: 0, max: maxPull, interval: maxPull / 8,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: CHART_GRID } },
      axisLabel: { color: CHART_TEXT, fontSize: 10, formatter: (value: number) => value === 0 ? '' : value },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value', minInterval: 1,
      axisLabel: { color: CHART_TEXT, fontSize: 10 },
      splitLine: { lineStyle: { color: CHART_GRID } },
    },
    series: [{
      type: 'bar',
      barWidth: maxPull === 80 ? 30 : 22,
      data: bins.map((bin) => [((bin.start + bin.end) / 2), bin.count]),
      itemStyle: {
        color: '#79b9ad',
        borderColor: 'rgba(220,238,233,0.2)',
        borderWidth: 1,
        borderRadius: [2, 2, 0, 0],
      },
      emphasis: { itemStyle: { color: '#99d4c9' } },
      markLine: {
        silent: true,
        symbol: 'none',
        label: { formatter: expectedLabel, color: '#d8bd84', fontSize: 10, position: 'insideEndTop' },
        lineStyle: { color: 'rgba(216,189,132,0.7)', type: 'dashed', width: 1 },
        data: [{ xAxis: expectedPulls }],
      },
    }],
  };
}

function buildProbabilityOption(pool: PoolInsight) {
  return {
    animationDuration: 480,
    animationEasing: 'cubicOut',
    grid: { left: 44, right: 18, top: 36, bottom: 34 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#222625',
      borderColor: 'rgba(212,212,212,0.2)',
      textStyle: { color: '#e2e4e3', fontSize: 11 },
      formatter: (params: Array<{ dataIndex: number }>) => {
        const point = pool.probability_curve[params[0]?.dataIndex ?? 0];
        return `第 ${point.pull} 抽<br/><b>${point.percentage.toFixed(1)}%</b> 历史出金率 · ${point.sample_size} 次仍未出金`;
      },
    },
    xAxis: {
      type: 'value', min: 1, max: 80, interval: 10,
      axisLine: { lineStyle: { color: CHART_GRID } },
      axisLabel: { color: CHART_TEXT, fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value', min: 0, max: 100, interval: 25,
      axisLabel: { color: CHART_TEXT, fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: CHART_GRID } },
    },
    series: [{
      type: 'line',
      step: 'end',
      showSymbol: false,
      data: pool.probability_curve.map((point) => [point.pull, point.percentage]),
      lineStyle: { color: '#8fc8be', width: 2 },
      areaStyle: { color: 'rgba(143,200,190,0.07)' },
      markLine: {
        silent: true,
        symbol: 'none',
        label: { formatter: '官方基础 0.8%', color: '#d8bd84', fontSize: 10, position: 'insideEndTop' },
        lineStyle: { color: 'rgba(216,189,132,0.7)', type: 'dashed' },
        data: [{ yAxis: 0.8 }],
      },
    }],
  };
}

function buildForecastOption(forecast: GachaForecast) {
  const hasFeatured = forecast.points.some((point) => point.featured !== null);
  const maxPulls = forecast.points.at(-1)?.pulls ?? 1;
  return {
    animationDuration: 620,
    animationEasing: 'cubicOut',
    grid: { left: 44, right: 22, top: 34, bottom: 34 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#222625',
      borderColor: 'rgba(216,189,132,0.28)',
      textStyle: { color: '#e2e4e3', fontSize: 11 },
      formatter: (params: Array<{ seriesName: string; data: [number, number] }>) => {
        const pulls = params[0]?.data[0] ?? 0;
        return [`未来 ${pulls} 抽`, ...params.map((item) => `${item.seriesName} <b>${item.data[1].toFixed(1)}%</b>`)].join('<br/>');
      },
    },
    xAxis: {
      type: 'value', min: 0, max: maxPulls,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: CHART_GRID } },
      axisLabel: { color: CHART_TEXT, fontSize: 10, formatter: (value: number) => value === 0 ? '现在' : `+${value}` },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value', min: 0, max: 100, interval: 25,
      axisLabel: { color: CHART_TEXT, fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: CHART_GRID, type: 'dashed' } },
    },
    series: [
      {
        name: '至少一个五星',
        type: 'line',
        smooth: 0.22,
        showSymbol: false,
        data: forecast.points.map((point) => [point.pulls, point.fiveStar * 100]),
        lineStyle: { color: '#d8bd84', width: 2.2, shadowBlur: 7, shadowColor: 'rgba(216,189,132,0.3)' },
        areaStyle: { color: 'rgba(216,189,132,0.055)' },
        z: 3,
      },
      ...(hasFeatured ? [{
        name: '获得当期 UP',
        type: 'line',
        smooth: 0.22,
        showSymbol: false,
        data: forecast.points.map((point) => [point.pulls, (point.featured ?? 0) * 100]),
        lineStyle: { color: '#79b9ad', width: 1.8 },
        areaStyle: { color: 'rgba(121,185,173,0.035)' },
        z: 2,
      }] : []),
    ],
  };
}

function buildFeaturedDistributionOption(bins: PityDistributionBin[]) {
  const labels = bins.map((bin) => bin.label);
  const counts = bins.map((bin) => bin.count);
  const expectedIndex = Math.min(labels.length - 1, Math.max(0, Math.round((FEATURED_EXPECTED_PULLS - 1) / 10)));
  return {
    animationDuration: 560,
    animationEasing: 'cubicOut',
    grid: { left: 42, right: 18, top: 40, bottom: 42 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: 'rgba(216,189,132,0.32)' } },
      backgroundColor: '#222625',
      borderColor: 'rgba(216,189,132,0.28)',
      textStyle: { color: '#e2e4e3', fontSize: 11 },
      formatter: (params: Array<{ dataIndex: number }>) => {
        const bin = bins[params[0]?.dataIndex ?? 0];
        return `${bin.label} 抽<br/><b>${bin.count}</b> 次拿到 UP · ${bin.percentage.toFixed(1)}%`;
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: true,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: CHART_GRID } },
      axisLabel: {
        color: CHART_TEXT,
        fontSize: 9,
        interval: 0,
        formatter: (_value: string, index: number) => index === 0 ? '1' : index === 8 ? '80' : index === labels.length - 1 ? '160' : '',
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value', min: 0, minInterval: 1,
      axisLabel: { color: CHART_TEXT, fontSize: 10 },
      splitLine: { lineStyle: { color: CHART_GRID, type: 'dashed' } },
    },
    series: [
      {
        type: 'bar',
        data: counts,
        barWidth: 12,
        itemStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: '#d8bd84' },
              { offset: 0.42, color: '#79b9ad' },
              { offset: 1, color: 'rgba(92,137,129,0.12)' },
            ],
          },
          borderRadius: [4, 4, 1, 1],
          shadowBlur: 8,
          shadowColor: 'rgba(143,200,190,0.14)',
        },
        emphasis: { itemStyle: { shadowBlur: 14, shadowColor: 'rgba(216,189,132,0.38)' } },
        z: 1,
      },
      {
        type: 'line',
        data: counts,
        smooth: 0.28,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: '#e1c98f', width: 1.4, shadowBlur: 6, shadowColor: 'rgba(216,189,132,0.35)' },
        itemStyle: { color: '#e1c98f', borderColor: '#292c2a', borderWidth: 2 },
        areaStyle: { color: 'rgba(216,189,132,0.055)' },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { formatter: '理论期望 81.15', color: '#d8bd84', fontSize: 10, position: 'insideEndTop' },
          lineStyle: { color: 'rgba(216,189,132,0.72)', type: 'dashed', width: 1 },
          data: [{ xAxis: labels[expectedIndex] }],
        },
        z: 3,
      },
    ],
  };
}

export default function AnalyticsPage() {
  const activePlayerId = useGachaStore((state) => state.activePlayerId);
  const initialized = useGachaStore((state) => state.initialized);
  const activeRecordCount = useGachaStore((state) => state.summaries.find((summary) => summary.player_id === state.activePlayerId)?.record_count ?? 0);
  const [includeMock, setIncludeMock] = useState(false);
  const [insights, setInsights] = useState<GachaInsights | null>(null);
  const [activePoolType, setActivePoolType] = useState<string | null>(null);
  const poolNavRef = useRef<HTMLElement>(null);
  const [poolIndicator, setPoolIndicator] = useState({ top: 0, height: 0, visible: false });

  useEffect(() => {
    if (!activePlayerId) {
      setInsights(null);
      return;
    }
    let current = true;
    gachaApi.getGachaInsights(activePlayerId, includeMock)
      .then((result) => {
        if (!current) return;
        setInsights(result);
        setActivePoolType((previous) => result.pools.some((pool) => pool.pool_type === previous)
          ? previous
          : result.pools.find((pool) => pool.complete_interval_count > 0)?.pool_type ?? result.pools[0]?.pool_type ?? null);
      })
      .catch(() => { if (current) setInsights(null); });
    return () => { current = false; };
  }, [activePlayerId, activeRecordCount, includeMock]);

  useLayoutEffect(() => {
    const nav = poolNavRef.current;
    if (!nav) return;
    const updateIndicator = () => {
      const activeButton = nav.querySelector<HTMLElement>(`[data-pool-type="${activePoolType}"]`);
      if (!activeButton) {
        setPoolIndicator((current) => ({ ...current, visible: false }));
        return;
      }
      setPoolIndicator({ top: activeButton.offsetTop, height: activeButton.offsetHeight, visible: true });
    };
    updateIndicator();
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [activePoolType, insights?.pools]);

  const activePool = useMemo(
    () => insights?.pools.find((pool) => pool.pool_type === activePoolType) ?? null,
    [activePoolType, insights],
  );
  const reliability = activePool ? RELIABILITY[activePool.reliability] : RELIABILITY.insufficient;
  const activeHardPity = activePool?.pool_type === '5' ? 50 : 80;
  const distributionOption = useMemo(
    () => activePool ? buildHistogramOption(activePool.distribution, 80, FIVE_STAR_EXPECTED_PULLS, '理论期望 54.1', '出金') : null,
    [activePool],
  );
  const probabilityOption = useMemo(() => activePool ? buildProbabilityOption(activePool) : null, [activePool]);
  const featuredOption = useMemo(
    () => activePool?.featured_cycle_count
      ? buildFeaturedDistributionOption(activePool.featured_distribution)
      : null,
    [activePool],
  );
  const forecast = useMemo(
    () => activePool && SOFT_PITY_POOL_TYPES.has(activePool.pool_type) ? buildGachaForecast(activePool) : null,
    [activePool],
  );
  const forecastOption = useMemo(() => forecast ? buildForecastOption(forecast) : null, [forecast]);
  const forecastNextTen = forecast
    ? forecast.points[Math.min(10, forecast.points.length - 1)]
    : null;
  const theoreticalMedianPulls = theoreticalThreshold(0.5);
  const observedDelta = activePool?.average_pity === null || activePool?.average_pity === undefined
    ? null
    : ((activePool.average_pity - FIVE_STAR_EXPECTED_PULLS) / FIVE_STAR_EXPECTED_PULLS) * 100;
  const hasTrendSample = (activePool?.complete_interval_count ?? 0) >= 10;
  const observedSignal = observedDelta === null || !hasTrendSample
    ? { label: '样本不足', tone: '#8b938e' }
    : observedDelta <= -12
      ? { label: '偏欧', tone: '#8fc8be' }
      : observedDelta >= 12
        ? { label: '偏非', tone: '#d99a9a' }
        : { label: '接近理论', tone: '#d8bd84' };

  return (
    <PageTransition>
      <div className="analysis-page h-full overflow-hidden">
        <header className="page-header analysis-page-header flex items-end justify-between gap-4 px-6 py-3">
          <PageSignalField variant="analysis" />
          <div className="analysis-hero-copy">
            <h1 className="page-title text-xl font-semibold text-tide">唤取分析</h1>
            <p className="page-subtitle mt-1 text-xs text-wave">{activePool ? `${activePool.pool_name} · ${activePool.complete_interval_count} 次历史出金` : '用历史记录对照官方概率'}</p>
          </div>
          <button type="button" role="switch" aria-checked={includeMock} onClick={() => setIncludeMock((value) => !value)} className="analysis-toggle-control">
            <span className="resonance-toggle" data-active={includeMock ? 'true' : 'false'} aria-hidden="true"><span className="resonance-toggle-track"><span className="resonance-toggle-node" /></span></span>
            <span>包含模拟记录</span>
          </button>
        </header>

        <div className="analysis-workbench">
          <aside className="analysis-sidebar">
            <div className="analysis-sidebar-summary">
              <span>分析样本</span>
              <strong>{insights?.total_records?.toLocaleString() ?? 0}</strong>
              <small>{includeMock ? '官方 + 模拟记录' : '仅官方记录'}</small>
            </div>
            {insights && insights.pools.length > 0 ? (
              <nav ref={poolNavRef} className="analysis-pool-list" aria-label="分析卡池">
                <motion.div
                  initial={false}
                  animate={{ top: poolIndicator.top, height: poolIndicator.height, opacity: poolIndicator.visible ? 1 : 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 36 }}
                  className="pool-active-frame analysis-pool-active-frame pointer-events-none absolute"
                  aria-hidden="true"
                >
                  <span className="pool-active-surface" />
                </motion.div>
                {insights.pools.map((pool) => {
                  const active = pool.pool_type === activePoolType;
                  const hardPity = pool.pool_type === '5' ? 50 : 80;
                  return (
                    <button
                      key={pool.pool_type}
                      type="button"
                      onClick={() => setActivePoolType(pool.pool_type)}
                      data-pool-type={pool.pool_type}
                      data-active={active ? 'true' : 'false'}
                      className="analysis-pool-button relative"
                    >
                      <span className="analysis-pool-name">{pool.pool_name}</span>
                      <span className="analysis-pool-pity">当前 {pool.current_pity}/{hardPity}</span>
                      <span className="analysis-pool-sample">统计 {pool.complete_interval_count} 次出金</span>
                      <span className="analysis-pool-progress"><i style={{ width: `${Math.min(100, (pool.current_pity / hardPity) * 100)}%` }} /></span>
                    </button>
                  );
                })}
              </nav>
            ) : null}
          </aside>

          <main className="analysis-main">
            <div className="analysis-content">
              {!activePlayerId && initialized ? (
                <ResonanceEmptyState variant="records" title="暂无可分析记录" description="完成一次扫描或导入后，这里会显示历史出金表现" />
              ) : activePool ? (
                <motion.div key={`${activePool.pool_type}-${includeMock}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  <section className="analysis-pool-overview">
                    <div className="analysis-pool-heading">
                      <div>
                        <span className="analysis-section-index">FIVE-STAR TRACE</span>
                        <h2>{activePool.pool_name}</h2>
                      </div>
                      <div className="analysis-current-pity">
                        <span>当前已垫</span>
                        <strong>{activePool.current_pity}</strong>
                        <small>/ {activeHardPity} 抽</small>
                      </div>
                    </div>
                    <div className="analysis-method-note">
                      <ResonanceIcon kind="traces" size={15} />
                      <span>每次五星后重新从第 1 抽计数。首个可见五星不知道此前垫了多少抽，当前垫抽又尚未出金，因此两者都不参与平均。</span>
                      <em style={{ color: reliability.tone }}>{reliability.label}</em>
                    </div>
                    <div className="analysis-metric-grid">
                      <Metric label="统计出金次数" value={`${activePool.complete_interval_count} 次`} detail={`${activePool.five_star_count} 个五星，首个不计入`} />
                        <Metric label="平均多少抽出金" value={formatPull(activePool.average_pity)} detail="官方综合概率期望 54.1 抽" tone="#d8bd84" />
                      <Metric label="一半在多少抽内" value={formatPull(activePool.median_pity)} detail="历史记录的中位数" />
                      <Metric label="最快出金" value={formatPull(activePool.best_pity)} detail="上个五星后的最短等待" tone="#bfc4c0" />
                      <Metric label="最慢出金" value={formatPull(activePool.worst_pity)} detail="上个五星后的最长等待" tone="#d99a9a" />
                      <Metric label="40 抽内出金" value={`${activePool.early_rate.toFixed(1)}%`} detail={`${activePool.early_count} 次提前出金`} />
                    </div>
                  </section>

                  <section className="analysis-formula-strip" aria-label="理论期望推导">
                    <div><span>官方五星综合概率</span><strong>1.85%</strong></div>
                    <i>→</i>
                    <div><span>五星长期平均</span><strong>1 ÷ 1.85% = 54.1 抽</strong></div>
                    <i>→</i>
                    <div><span>角色 UP 长期平均</span><strong>54.1 × (50%×1 + 50%×2) = 81.15 抽</strong></div>
                  </section>

                  <section className="analysis-deviation-strip" aria-label="实际表现对照理论">
                    <div><span>当前样本信号</span><strong style={{ color: observedSignal.tone }}>{observedSignal.label}</strong><small>{observedDelta === null ? '完成更多五星后再判断' : !hasTrendSample ? `仅 ${activePool?.complete_interval_count ?? 0} 个完整区间，不作欧非判断` : `平均抽数 ${observedDelta >= 0 ? '+' : ''}${observedDelta.toFixed(1)}% 对比理论 54.1 抽`}</small></div>
                    <i />
                    <div><span>历史中位数</span><strong>{formatPull(activePool.median_pity)}</strong><small>一半的五星不超过这个抽数</small></div>
                    <i />
                    <div><span>理论中位数</span><strong>{theoreticalMedianPulls} 抽</strong><small>按分段软保底模型计算</small></div>
                  </section>

                  {forecast && forecastOption ? (
                    <section className="analysis-forecast-section">
                      <div className="analysis-forecast-heading">
                        <div>
                          <span className="analysis-section-index">CONDITIONAL FORECAST / PITY {activePool.current_pity}</span>
                          <h2>从当前垫抽开始，未来有多大概率出金</h2>
                          <p>已将前 {activePool.current_pity} 抽未出五星作为已知条件，从下一抽重新计算；分段软保底采用社区大样本模型，结果是概率预测，不是出金承诺。</p>
                        </div>
                        <div className="analysis-forecast-state" data-guaranteed={activePool.featured_guaranteed ? 'true' : 'false'}>
                          <span>下一抽出金率</span>
                          <strong>{(forecast.nextPullRate * 100).toFixed(1)}%</strong>
                          <small>{LIMITED_ROLE_POOL_TYPES.has(activePool.pool_type) ? (activePool.featured_guaranteed ? '大保底 · 五星即 UP' : '小保底 · 五星 50% 为 UP') : '五星保底进度独立计算'}</small>
                        </div>
                      </div>
                      <div className="analysis-forecast-body">
                        <div className="analysis-forecast-chart">
                          <div className="analysis-forecast-legend" aria-hidden="true">
                            <span><i data-tone="gold" />至少一个五星</span>
                            {LIMITED_ROLE_POOL_TYPES.has(activePool.pool_type) ? <span><i data-tone="cyan" />获得当期 UP</span> : null}
                          </div>
                          <AnalyticsChart option={forecastOption} height={270} eager />
                        </div>
                        <aside className="analysis-forecast-summary">
                          <div className="analysis-forecast-now">
                            <span>未来 10 抽</span>
                            <strong>{((forecastNextTen?.fiveStar ?? 0) * 100).toFixed(1)}%</strong>
                            <small>至少出现一个五星</small>
                          </div>
                          <div className="analysis-forecast-expectations">
                            <div><span>预计还需</span><strong>{forecast.expectedFiveStar.toFixed(1)} 抽</strong><small>获得下一个五星的条件期望</small></div>
                            {forecast.expectedFeatured !== null ? <div><span>预计还需</span><strong>{forecast.expectedFeatured.toFixed(1)} 抽</strong><small>获得当期 UP 的条件期望</small></div> : null}
                          </div>
                          <div className="analysis-forecast-thresholds">
                            <span>五星累计概率门槛</span>
                            {forecast.fiveStarThresholds.map((item) => (
                              <div key={item.probability}>
                                <em>{Math.round(item.probability * 100)}%</em>
                                <i><b style={{ width: `${item.probability * 100}%` }} /></i>
                                <strong>+{item.pulls} 抽</strong>
                              </div>
                            ))}
                          </div>
                        </aside>
                      </div>
                      <div className="analysis-forecast-model">
                        <span>P(第 n 抽出金 | 前 n-1 抽未出) = p(n)</span>
                        <i>·</i>
                        <span>P(未来 k 抽内出金) = 1 - ∏(1 - p<sub>i</sub>)</span>
                        <i>·</i>
                        <span>1–65: 0.8% · 66–70: +4%/抽 · 71–75: +8%/抽 · 76 起: +10%/抽</span>
                      </div>
                    </section>
                  ) : activePool.pool_type === '5' ? (
                    <section className="analysis-forecast-unavailable">
                      <div>
                        <span className="analysis-section-index">BEGINNER CONVENE / 1–50</span>
                        <h2>新手唤取暂不生成概率曲线</h2>
                        <p>已知规则是 50 抽内必出随机常驻五星，但目前无法确认其逐抽软保底函数。这里保留硬保底进度，不使用其它卡池模型套算。</p>
                      </div>
                      <strong>{activePool.current_pity}<small>/ 50</small></strong>
                    </section>
                  ) : null}

                  {activePool.complete_interval_count > 0 && distributionOption && probabilityOption ? (
                    <div className="analysis-chart-grid">
                      <section className="analysis-chart-panel">
                        <div className="analysis-chart-heading">
                          <div><span>HISTOGRAM / 1–80</span><h3>每次五星用了多少抽</h3></div>
                          <p>柱越高，说明该抽数范围内出金越常见</p>
                        </div>
                        <AnalyticsChart option={distributionOption} height={292} prewarmDelay={120} />
                      </section>
                      <section className="analysis-chart-panel">
                        <div className="analysis-chart-heading">
                          <div><span>CONDITIONAL RATE / 1–80</span><h3>第 N 抽实际有多容易出金</h3></div>
                          <p>只看此前还没出五星的记录；这是历史估计，不是官方逐抽机制，金线为基础概率 0.8%</p>
                        </div>
                        <AnalyticsChart option={probabilityOption} height={292} prewarmDelay={240} />
                      </section>
                    </div>
                  ) : (
                    <ResonanceEmptyState compact variant="filter" title="还不能计算出金表现" description="同一卡池至少要看到两个五星，才能知道两次五星之间实际用了多少抽" />
                  )}

                  {activePool.featured_cycle_count > 0 && featuredOption ? (
                    <section className="analysis-featured-section">
                      <div className="analysis-featured-heading">
                        <div>
                          <span className="analysis-section-index">FEATURED RESONANCE / 1–160</span>
                          <h2>抽到一个 UP 角色实际用了多少抽</h2>
                          <p>从上一个 UP 五星之后开始计数，到下一个 UP 五星为止；中间如果歪了，会把歪五星前后的抽数合并。总体不歪率 {((activePool.featured_count / activePool.five_star_count) * 100).toFixed(1)}%；可识别直接胜率 {activePool.featured_win_rate === null ? '-' : `${activePool.featured_win_rate.toFixed(1)}%`}（{activePool.featured_win_count}/{activePool.featured_attempt_count}，排除大保底）。</p>
                        </div>
                        <div className="analysis-featured-expect"><span>理论期望</span><strong>81.15</strong><small>抽</small></div>
                      </div>
                      <div className="analysis-featured-metrics">
                        <Metric label="统计 UP 获取" value={`${activePool.featured_cycle_count} 次`} detail={`${activePool.featured_count} 个 UP，首个不计入`} />
                        <Metric label="平均拿到 UP" value={formatPull(activePool.featured_average_pulls)} detail="已包含歪与大保底" tone="#d8bd84" />
                        <Metric label="一半在多少抽内" value={formatPull(activePool.featured_median_pulls)} detail="UP 获取抽数中位数" />
                        <Metric label="总体不歪率" value={`${((activePool.featured_count / activePool.five_star_count) * 100).toFixed(1)}%`} detail={`${activePool.featured_count}/${activePool.five_star_count} 次五星为 UP`} tone="#bfc4c0" />
                        <Metric label="最快拿到 UP" value={formatPull(activePool.featured_best_pulls)} detail="从上一个 UP 之后计数" />
                        <Metric label="最慢拿到 UP" value={formatPull(activePool.featured_worst_pulls)} detail="理论上限 160 抽" tone="#d99a9a" />
                      </div>
                      <div className="analysis-featured-chart">
                        <div className="analysis-chart-heading">
                          <div><span>HISTOGRAM / 1–160</span><h3>UP 角色获取成本分布</h3></div>
                          <p>金色虚线：50/50 与大保底下的长期理论期望 81.15 抽</p>
                        </div>
                        <AnalyticsChart option={featuredOption} height={320} prewarmDelay={360} />
                      </div>
                    </section>
                  ) : null}
                </motion.div>
              ) : null}
            </div>
          </main>
        </div>
      </div>
    </PageTransition>
  );
}
