import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { open } from '@tauri-apps/plugin-dialog';
import { useGachaStore } from '../store/useGachaStore';
import PageTransition from '../components/PageTransition';
import StatCard from '../components/StatCard';
import ReactECharts from 'echarts-for-react';
import { QUALITY } from '../types';
import {
  Sparkles,
  Trophy,
  Target,
  Activity,
  TrendingUp,
  Scan,
  BarChart3,
  Percent,
  AlertTriangle,
  Swords,
  Folder,
  Link,
  Upload,
  Calendar,
} from 'lucide-react';

type ScanMode = 'dir' | 'url' | 'json';

export default function Home() {
  const { fetchStats, fetchRecords, fetchPools, fetchSettings, scanGacha, scanGachaByUrl, importJson, stats, settings, scanning, records } = useGachaStore();
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanMode, setScanMode] = useState<ScanMode>('dir');
  const [gameDirInput, setGameDirInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [jsonPath, setJsonPath] = useState('');

  useEffect(() => {
    fetchSettings();
    fetchPools();
    fetchRecords();
    if (stats === null) fetchStats();
  }, []);

  const handleScanByDir = async () => {
    const dir = gameDirInput || settings?.game_dir || '';
    if (!dir) return;
    await scanGacha(dir);
    if (!useGachaStore.getState().error) setShowScanModal(false);
  };

  const handleScanByUrl = async () => {
    const url = urlInput.trim();
    if (!url) return;
    await scanGachaByUrl(url);
    if (!useGachaStore.getState().error) setShowScanModal(false);
  };

  const handleSelectJson = async () => {
    const selected = await open({
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (selected) setJsonPath(selected as string);
  };

  const handleImportJson = async () => {
    if (!jsonPath) return;
    await importJson(jsonPath);
    if (!useGachaStore.getState().error) setShowScanModal(false);
  };

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto overflow-x-hidden">
        <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-tide">抽卡概览</h1>
            <p className="text-sm text-wave mt-1">查看你的鸣潮抽卡数据统计</p>
          </div>
          <button
            onClick={() => {
              setGameDirInput(settings?.game_dir || '');
              setUrlInput('');
              setJsonPath('');
              setScanMode('dir');
              setShowScanModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg tide-btn"
          >
            <Scan size={16} />
            扫描抽卡
          </button>
        </div>

        {stats ? (
          <>
            {/* 基础统计 */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <StatCard label="总抽数" value={stats.total_draws} icon={<Sparkles size={14} />} delay={0} />
              <StatCard label="五星" value={stats.total_five_star} icon={<Trophy size={14} />} color="gold" delay={0.05} />
              <StatCard label="四星" value={stats.total_four_star} icon={<Target size={14} />} color="purple" delay={0.1} />
              <StatCard label="五星率" value={`${stats.five_star_rate.toFixed(2)}%`} icon={<TrendingUp size={14} />} color="gold" delay={0.15} />
              <StatCard label="当前保底" value={stats.current_pity} icon={<Activity size={14} />} delay={0.2} />
              <StatCard label="平均出金" value={stats.avg_five_star_pity > 0 ? `${stats.avg_five_star_pity.toFixed(1)}抽` : '-'} icon={<BarChart3 size={14} />} color="blue" delay={0.25} />
            </motion.div>

            {/* 进阶统计 */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="glass-card p-4">
                <div className="flex items-center gap-2 text-xs text-wave mb-2">
                  <Percent size={12} />
                  小保底不歪率
                </div>
                <div className={`text-2xl font-semibold ${stats.win_rate_5050 >= 50 ? 'text-[#a8d8a8]' : 'text-[#e8a8a8]'}`}>
                  {stats.win_rate_5050 > 0 ? `${stats.win_rate_5050.toFixed(1)}%` : '-'}
                </div>
                <div className="text-xs text-wave mt-1">
                  {stats.off_rate_count > 0 ? `歪 ${stats.off_rate_count} 次` : '未歪过'}
                </div>
              </div>

              <div className="glass-card p-4">
                <div className="flex items-center gap-2 text-xs text-wave mb-2">
                  <Sparkles size={12} />
                  平均每 UP 角色
                </div>
                <div className="text-2xl font-semibold text-[#e8d4a8]">
                  {stats.avg_up_role_pulls > 0 ? `${stats.avg_up_role_pulls.toFixed(1)}抽` : '-'}
                </div>
                <div className="text-xs text-wave mt-1">限定角色池</div>
              </div>

              <div className="glass-card p-4">
                <div className="flex items-center gap-2 text-xs text-wave mb-2">
                  <Swords size={12} />
                  平均每 UP 武器
                </div>
                <div className="text-2xl font-semibold text-[#e8d4a8]">
                  {stats.avg_up_weapon_pulls > 0 ? `${stats.avg_up_weapon_pulls.toFixed(1)}抽` : '-'}
                </div>
                <div className="text-xs text-wave mt-1">限定武器池</div>
              </div>

              <div className="glass-card p-4">
                <div className="flex items-center gap-2 text-xs text-wave mb-2">
                  <TrendingUp size={12} />
                  平均五星抽数
                </div>
                <div className="text-2xl font-semibold text-[#a8c8e8]">
                  {stats.avg_five_star_pity > 0 ? `${stats.avg_five_star_pity.toFixed(1)}抽` : '-'}
                </div>
                <div className="text-xs text-wave mt-1">所有卡池</div>
              </div>
            </motion.div>

            {/* 出金与保底 */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="glass-card p-5">
                <h3 className="text-sm text-wave mb-4 flex items-center gap-2">
                  <Trophy size={14} /> 出金统计
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-wave">限定五星</span>
                    <span className="text-lg font-semibold text-[#e8d4a8]">{stats.limited_five_star}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-wave">常驻五星</span>
                    <span className="text-lg font-semibold text-tide">{stats.standard_five_star}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-wave flex items-center gap-1">
                      <AlertTriangle size={12} className="text-[#e8a8a8]" /> 歪的次数
                    </span>
                    <span className="text-lg font-semibold text-[#e8a8a8]">{stats.off_rate_count}</span>
                  </div>
                  <div className="ocean-divider my-2" />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-wave">限定四星</span>
                    <span className="text-lg font-semibold text-[#b8a8d8]">{stats.limited_four_star}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-wave">常驻四星</span>
                    <span className="text-lg font-semibold text-tide">{stats.standard_four_star}</span>
                  </div>
                </div>
              </div>

              <div className="glass-card p-5">
                <h3 className="text-sm text-wave mb-4 flex items-center gap-2">
                  <Activity size={14} /> 保底记录
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-wave">当前保底计数</span>
                    <span className={`text-2xl font-semibold ${stats.current_pity >= 66 ? 'text-[#d8a87a]' : 'text-tide'}`}>
                      {stats.current_pity}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-wave">最高保底记录</span>
                    <span className="text-lg font-semibold text-tide">{stats.max_pity}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-wave">平均出金抽数</span>
                    <span className="text-lg font-semibold text-[#a8c8e8]">
                      {stats.avg_five_star_pity > 0 ? `${stats.avg_five_star_pity.toFixed(1)} 抽` : '-'}
                    </span>
                  </div>
                  {/* 保底进度条 */}
                  {stats.current_pity > 0 && (
                    <div className="mt-2">
                      <div className="h-2 rounded-full bg-[rgba(212,212,212,0.06)] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min((stats.current_pity / 80) * 100, 100)}%`,
                            background: stats.current_pity >= 66
                              ? 'linear-gradient(90deg, #d8a87a, #e8d4a8)'
                              : 'rgba(212, 212, 212, 0.3)',
                          }}
                        />
                      </div>
                      <div className="text-xs text-wave mt-1 text-right">{stats.current_pity}/80</div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>

            {/* 卡池分布 — 核心四池常显，其它池子无抽取则隐藏 */}
            {stats.pools.length > 0 && (() => {
              const CORE_POOLS = new Set(['1', '2', '3', '4']);
              const visiblePools = stats.pools.filter(p => CORE_POOLS.has(p.pool_type) || p.count > 0);
              const maxCount = Math.max(...visiblePools.map(p => p.count), 1);
              return (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="glass-card p-5">
                  <h3 className="text-sm text-wave mb-4 flex items-center gap-2">
                    <BarChart3 size={14} /> 卡池分布
                  </h3>
                  <div className="space-y-2">
                    {visiblePools.map((pool) => {
                      const percentage = maxCount > 0 ? (pool.count / maxCount) * 100 : 0;
                      return (
                        <div key={pool.pool_type} className="flex items-center gap-4">
                          <span className="text-sm text-wave w-28 flex-shrink-0 truncate">{pool.pool_name}</span>
                          <div className="flex-1 h-6 bg-[rgba(212,212,212,0.06)] rounded overflow-hidden relative">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${percentage}%` }}
                              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                              className="h-full rounded"
                              style={{
                                background: pool.five_star_count > 0
                                  ? 'linear-gradient(90deg, rgba(232,212,168,0.3), rgba(232,212,168,0.5))'
                                  : 'linear-gradient(90deg, rgba(212,212,212,0.15), rgba(212,212,212,0.3))',
                              }}
                            />
                            <span className="absolute inset-0 flex items-center justify-end pr-2 text-xs text-tide">
                              {pool.count} 抽
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs w-36 flex-shrink-0">
                            {pool.five_star_count > 0 && <span className="text-[#e8d4a8] whitespace-nowrap">五星{pool.five_star_count}</span>}
                            {pool.four_star_count > 0 && <span className="text-[#b8a8d8] whitespace-nowrap">四星{pool.four_star_count}</span>}
                            {pool.off_rate_count > 0 && <span className="text-[#e8a8a8] whitespace-nowrap">歪{pool.off_rate_count}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              );
            })()}
            {/* 每日抽卡统计（柱状图） */}
            {records.length > 0 && (() => {
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
              const option = {
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
                  data: dates,
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
                  { name: '总抽数', type: 'bar', data: dates.map(d => dateMap.get(d)!.total), itemStyle: { color: 'rgba(212,212,212,0.6)' } },
                  { name: '五星', type: 'bar', data: dates.map(d => dateMap.get(d)!.five), itemStyle: { color: '#e8d4a8' } },
                  { name: '四星', type: 'bar', data: dates.map(d => dateMap.get(d)!.four), itemStyle: { color: '#b8a8d8' } },
                ],
              };
              return (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  className="glass-card p-5"
                >
                  <h3 className="text-sm text-wave mb-4 flex items-center gap-2">
                    <Calendar size={14} /> 每日抽卡统计
                  </h3>
                  <div style={{ height: 280 }}>
                    <ReactECharts option={option} style={{ height: '100%' }} notMerge />
                  </div>
                </motion.div>
              );
            })()}
          </>
        ) : (
          <div className="glass-card p-12 flex flex-col items-center justify-center gap-4">
            <div className="w-16 h-16 rounded-full bg-[rgba(212,212,212,0.06)] flex items-center justify-center">
              <Sparkles size={28} className="text-wave" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-medium text-tide">暂无抽卡数据</h3>
              <p className="text-sm text-wave mt-1">点击右上角按钮开始扫描你的抽卡记录</p>
            </div>
            <button
              onClick={() => {
                setGameDirInput(settings?.game_dir || '');
                setUrlInput('');
                setJsonPath('');
                setScanMode('dir');
                setShowScanModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg tide-btn mt-2"
            >
              <Scan size={16} />
              开始扫描
            </button>
          </div>
        )}
      </div>

      {showScanModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => !scanning && setShowScanModal(false)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-card p-6 w-[480px]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-tide mb-4">扫描抽卡数据</h3>

            {/* 模式切换 */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[rgba(212,212,212,0.04)] border border-[rgba(255,255,255,0.04)] mb-4">
              <button
                onClick={() => setScanMode('dir')}
                disabled={scanning}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs transition-colors ${
                  scanMode === 'dir'
                    ? 'bg-[rgba(212,212,212,0.12)] text-tide'
                    : 'text-wave hover:text-tide-dim disabled:opacity-50'
                }`}
              >
                <Folder size={13} />
                游戏目录
              </button>
              <button
                onClick={() => setScanMode('url')}
                disabled={scanning}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs transition-colors ${
                  scanMode === 'url'
                    ? 'bg-[rgba(212,212,212,0.12)] text-tide'
                    : 'text-wave hover:text-tide-dim disabled:opacity-50'
                }`}
              >
                <Link size={13} />
                抽卡链接
              </button>
              <button
                onClick={() => setScanMode('json')}
                disabled={scanning}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs transition-colors ${
                  scanMode === 'json'
                    ? 'bg-[rgba(212,212,212,0.12)] text-tide'
                    : 'text-wave hover:text-tide-dim disabled:opacity-50'
                }`}
              >
                <Upload size={13} />
                导入 JSON
              </button>
            </div>

            {scanMode === 'dir' && (
              <div className="space-y-2">
                <p className="text-sm text-wave">
                  请先在游戏中打开抽卡历史记录，然后在此处选择游戏安装目录进行扫描。
                </p>
                <label className="block mt-3">
                  <span className="text-sm text-wave">游戏目录</span>
                  <input
                    type="text"
                    value={gameDirInput}
                    onChange={(e) => setGameDirInput(e.target.value)}
                    placeholder="例如: E:\Wuthering Waves\Wuthering Waves"
                    className="w-full glass-input px-3 py-2 text-sm mt-1"
                  />
                  <p className="text-xs text-wave mt-1">
                    目录下需要包含 Client/Saved/Logs/Client.log 文件
                  </p>
                </label>
              </div>
            )}

            {scanMode === 'url' && (
              <div className="space-y-2">
                <p className="text-sm text-wave">
                  直接粘贴抽卡历史记录页面的链接，适用于游戏已关闭的情况。
                </p>
                <label className="block mt-3">
                  <span className="text-sm text-wave">抽卡链接</span>
                  <textarea
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="粘贴完整的抽卡记录链接，例如: https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?..."
                    rows={4}
                    className="w-full glass-input px-3 py-2 text-sm mt-1 resize-none font-mono"
                  />
                  <p className="text-xs text-wave mt-1">
                    链接需从游戏内抽卡历史记录页面获取
                  </p>
                </label>
              </div>
            )}

            {scanMode === 'json' && (
              <div className="space-y-2">
                <p className="text-sm text-wave">
                  从本地 JSON 文件导入抽卡数据，适用于抽卡链接已过期的情况。
                </p>
                <div className="mt-3 space-y-2">
                  <span className="text-sm text-wave">JSON 文件</span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={jsonPath}
                      onChange={(e) => setJsonPath(e.target.value)}
                      placeholder="选择或输入 JSON 文件路径"
                      className="flex-1 glass-input px-3 py-2 text-sm"
                    />
                    <button
                      onClick={handleSelectJson}
                      disabled={scanning}
                      className="px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.1)] text-wave hover:text-tide transition-colors text-sm disabled:opacity-50"
                    >
                      选择文件
                    </button>
                  </div>
                  <p className="text-xs text-wave mt-1">
                    JSON 格式与 API 原始返回一致，包含各卡池类型的记录数组
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowScanModal(false)}
                disabled={scanning}
                className="flex-1 px-4 py-2 rounded-lg border border-[rgba(255,255,255,0.1)] text-wave hover:text-tide transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={scanMode === 'dir' ? handleScanByDir : scanMode === 'url' ? handleScanByUrl : handleImportJson}
                disabled={scanning || (scanMode === 'dir' ? !gameDirInput.trim() : scanMode === 'url' ? !urlInput.trim() : !jsonPath.trim())}
                className="flex items-center justify-center gap-2 flex-1 px-4 py-2 rounded-lg tide-btn disabled:opacity-50"
              >
                {scanning ? (
                  <>
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                      <Scan size={16} />
                    </motion.div>
                    {scanMode === 'json' ? '导入中...' : '扫描中...'}
                  </>
                ) : (
                  <>
                    <Scan size={16} />
                    {scanMode === 'json' ? '开始导入' : '开始扫描'}
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      </div>
    </PageTransition>
  );
}
