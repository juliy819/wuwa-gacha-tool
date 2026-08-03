import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useGachaStore } from '../store/useGachaStore';
import PageTransition from '../components/PageTransition';
import ReactECharts from 'echarts-for-react';
import { QUALITY } from '../types';
import ResonanceIcon from '../components/ResonanceModeIcon';

export default function AnalyticsPage() {
  const { records, activePlayerId, fetchStats, fetchRecords } = useGachaStore();

  useEffect(() => {
    fetchRecords();
    if (activePlayerId) {
      fetchStats(activePlayerId);
    }
  }, [activePlayerId]);

  const dailyStats = useMemo(() => {
    if (records.length === 0) return null;

    const dateMap = new Map<string, { total: number; five: number; four: number }>();
    records.forEach((r) => {
      const date = r.time.split(' ')[0];
      if (!dateMap.has(date)) dateMap.set(date, { total: 0, five: 0, four: 0 });
      const d = dateMap.get(date)!;
      d.total += 1;
      if (r.quality_level === QUALITY.FIVE_STAR) d.five += 1;
      if (r.quality_level === QUALITY.FOUR_STAR) d.four += 1;
    });

    const dates = Array.from(dateMap.keys()).sort();
    return {
      dates,
      totals: dates.map(d => dateMap.get(d)!.total),
      fives: dates.map(d => dateMap.get(d)!.five),
      fours: dates.map(d => dateMap.get(d)!.four),
    };
  }, [records]);

  const poolData = useMemo(() => {
    if (records.length === 0) return null;
    const poolMap = new Map<string, number>();
    records.forEach((r) => {
      poolMap.set(r.card_pool_name, (poolMap.get(r.card_pool_name) || 0) + 1);
    });
    return Array.from(poolMap.entries()).map(([name, value]) => ({ name, value }));
  }, [records]);

  const qualityDist = useMemo(() => {
    if (records.length === 0) return null;
    const five = records.filter(r => r.quality_level === QUALITY.FIVE_STAR).length;
    const four = records.filter(r => r.quality_level === QUALITY.FOUR_STAR).length;
    const three = records.filter(r => r.quality_level === QUALITY.THREE_STAR).length;
    return [
      { name: '五星', value: five, itemStyle: { color: '#e8d4a8' } },
      { name: '四星', value: four, itemStyle: { color: '#b8a8d8' } },
      { name: '三星', value: three, itemStyle: { color: '#8ab8c8' } },
    ];
  }, [records]);

  const barChartOption = useMemo(() => {
    if (!dailyStats) return {};
    return {
      grid: { left: 50, right: 20, top: 40, bottom: 40 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#262626',
        borderColor: 'rgba(255,255,255,0.1)',
        textStyle: { color: '#d4d4d4' },
      },
      legend: { data: ['总抽数', '五星', '四星'], textStyle: { color: '#8a8a8a' }, top: 0 },
      xAxis: {
        type: 'category',
        data: dailyStats.dates,
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
        axisLabel: { color: '#8a8a8a' },
      },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
        axisLabel: { color: '#8a8a8a' },
      },
      series: [
        { name: '总抽数', type: 'bar', data: dailyStats.totals, itemStyle: { color: 'rgba(212,212,212,0.6)' } },
        { name: '五星', type: 'bar', data: dailyStats.fives, itemStyle: { color: '#e8d4a8' } },
        { name: '四星', type: 'bar', data: dailyStats.fours, itemStyle: { color: '#b8a8d8' } },
      ],
    };
  }, [dailyStats]);

  const pieChartOption = useMemo(() => {
    if (!poolData) return {};
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: '#262626',
        borderColor: 'rgba(255,255,255,0.1)',
        textStyle: { color: '#d4d4d4' },
      },
      series: [{
        type: 'pie',
        radius: ['45%', '70%'],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 4, borderColor: '#262626', borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold', color: '#d4d4d4' } },
        data: poolData,
      }],
    };
  }, [poolData]);

  const qualityChartOption = useMemo(() => {
    if (!qualityDist) return {};
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: '#262626',
        borderColor: 'rgba(255,255,255,0.1)',
        textStyle: { color: '#d4d4d4' },
        formatter: '{b}: {c} ({d}%)',
      },
      series: [{
        type: 'pie',
        radius: ['50%', '75%'],
        itemStyle: { borderRadius: 6, borderColor: '#262626', borderWidth: 3 },
        label: { show: true, color: '#d4d4d4', fontSize: 12 },
        data: qualityDist,
      }],
    };
  }, [qualityDist]);

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto overflow-x-hidden">
        <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-tide">数据分析</h1>
          <p className="text-sm text-wave mt-1">多维度查看你的抽卡统计</p>
        </div>

        {records.length === 0 ? (
          <div className="glass-card p-16 flex flex-col items-center justify-center gap-3">
            <div className="w-16 h-16 rounded-full bg-[rgba(212,212,212,0.06)] flex items-center justify-center">
              <ResonanceIcon kind="chart" size={29} className="text-wave" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-medium text-tide">暂无数据</h3>
              <p className="text-sm text-wave mt-1">请先扫描游戏目录获取抽卡数据</p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5">
                <h3 className="text-sm text-wave mb-4 flex items-center gap-2"><ResonanceIcon kind="calendar" size={15} />每日抽卡统计</h3>
                <div style={{ height: 280 }}><ReactECharts option={barChartOption} style={{ height: '100%' }} /></div>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-5">
                <h3 className="text-sm text-wave mb-4 flex items-center gap-2"><ResonanceIcon kind="trophy" size={15} />品质分布</h3>
                <div style={{ height: 280 }}><ReactECharts option={qualityChartOption} style={{ height: '100%' }} /></div>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card p-5 lg:col-span-2">
                <h3 className="text-sm text-wave mb-4 flex items-center gap-2"><ResonanceIcon kind="target" size={15} />卡池分布</h3>
                <div style={{ height: 320 }}><ReactECharts option={pieChartOption} style={{ height: '100%' }} /></div>
              </motion.div>
            </div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-card p-5">
              <h3 className="text-sm text-wave mb-4 flex items-center gap-2"><ResonanceIcon kind="chart" size={15} />详细统计</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-[rgba(212,212,212,0.03)]">
                  <div className="text-xs text-wave">总抽数</div>
                  <div className="text-2xl font-semibold text-tide mt-1">{records.length}</div>
                </div>
                <div className="p-4 rounded-lg bg-[rgba(232,212,168,0.05)]">
                  <div className="text-xs text-wave">五星数量</div>
                  <div className="text-2xl font-semibold text-[#e8d4a8] mt-1">
                    {records.filter(r => r.quality_level === QUALITY.FIVE_STAR).length}
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-[rgba(184,168,216,0.05)]">
                  <div className="text-xs text-wave">四星数量</div>
                  <div className="text-2xl font-semibold text-[#b8a8d8] mt-1">
                    {records.filter(r => r.quality_level === QUALITY.FOUR_STAR).length}
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-[rgba(212,212,212,0.03)]">
                  <div className="text-xs text-wave">五星率</div>
                  <div className="text-2xl font-semibold text-[#e8d4a8] mt-1">
                    {((records.filter(r => r.quality_level === QUALITY.FIVE_STAR).length / records.length) * 100).toFixed(2)}%
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
        </div>
      </div>
    </PageTransition>
  );
}
