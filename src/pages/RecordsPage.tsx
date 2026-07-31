import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  AlignJustify,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  LoaderCircle,
  RefreshCw,
  Rows3,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import PageTransition from '../components/PageTransition';
import ResourceIcon from '../components/ResourceIcon';
import { useGachaStore } from '../store/useGachaStore';
import {
  POOL_TYPES,
  QUALITY,
  QUALITY_COLORS,
  QUALITY_LABELS,
  type GachaRecord,
} from '../types';

type ViewMode = 'list' | 'grid' | 'table';
type RecordScope = 'five' | 'all';
type RecordWithPity = { record: GachaRecord; pity: number };

const GRID_ROWS_PER_PAGE = 5;
const GRID_MIN_ITEM_WIDTH = 108;
const GRID_GAP = 12;
const GRID_HORIZONTAL_PADDING = 32;

const getRecordKey = (record: GachaRecord, index: number) =>
  `${record.id ?? 'local'}-${record.card_pool_type}-${record.time}-${record.resource_id}-${index}`;

const getBarColor = (pity: number) => {
  if (pity <= 30) return '#7ec8a0';
  if (pity <= 60) return '#e8c87a';
  return '#e88a7a';
};

function RecordAvatar({ record, size = 'md' }: { record: GachaRecord; size?: 'sm' | 'md' | 'lg' }) {
  const color = QUALITY_COLORS[record.quality_level] ?? '#8a8a8a';
  const dimensions = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-full w-full' : 'h-12 w-12';

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-md border ${dimensions}`}
      style={{ borderColor: record.is_off_rate ? 'rgba(216,72,72,0.65)' : `${color}55`, background: `${color}10` }}
    >
      <ResourceIcon
        resourceId={record.resource_id}
        alt={record.name}
        className="h-full w-full object-cover"
        fallback={(
          <div className="absolute inset-0 flex items-center justify-center text-sm font-medium" style={{ color }}>
            {record.name.charAt(0)}
          </div>
        )}
      />
    </div>
  );
}

function PityBadge({ pity }: { pity: number }) {
  const isHigh = pity >= 66;
  return (
    <span className={`inline-flex items-baseline gap-0.5 rounded border px-2 py-1 text-xs font-semibold tabular-nums ${
      isHigh
        ? 'border-[#d8bd84]/20 bg-[#d8bd84]/[0.07] text-[#d8bd84]'
        : 'border-[#6faaa0]/20 bg-[#6faaa0]/[0.07] text-[#8fc8be]'
    }`}>
      {pity}<span className="text-[10px] font-normal">抽</span>
    </span>
  );
}

export default function RecordsPage() {
  const { records, activePlayerId, fetchRecords, loading, error } = useGachaStore();
  const [activePoolType, setActivePoolType] = useState('all');
  const [scope, setScope] = useState<RecordScope>('five');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [pageSizeMenuOpen, setPageSizeMenuOpen] = useState(false);
  const [gridColumns, setGridColumns] = useState(10);
  const contentRef = useRef<HTMLElement>(null);
  const previousGridPageSizeRef = useRef(gridColumns * GRID_ROWS_PER_PAGE);

  useEffect(() => {
    setActivePoolType('all');
    setCurrentPage(1);
    fetchRecords();
  }, [activePlayerId]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const updateGridColumns = () => {
      const availableWidth = Math.max(0, content.clientWidth - GRID_HORIZONTAL_PADDING);
      const columns = Math.max(1, Math.floor((availableWidth + GRID_GAP) / (GRID_MIN_ITEM_WIDTH + GRID_GAP)));
      setGridColumns(columns);
    };

    updateGridColumns();
    const observer = new ResizeObserver(updateGridColumns);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const allRecordsWithPity = useMemo<RecordWithPity[]>(() => {
    const ordered = [...records].sort((a, b) => {
      const timeOrder = a.time.localeCompare(b.time);
      return timeOrder !== 0 ? timeOrder : (b.id ?? 0) - (a.id ?? 0);
    });
    const pityByPool = new Map<string, number>();
    const result = ordered.map((record) => {
      const pity = (pityByPool.get(record.card_pool_type) ?? 0) + 1;
      pityByPool.set(record.card_pool_type, record.quality_level === QUALITY.FIVE_STAR ? 0 : pity);
      return { record, pity };
    });
    return result.reverse();
  }, [records]);

  const poolStats = useMemo(() => {
    const stats = new Map<string, { name: string; count: number; fiveStar: number; currentPity: number }>();
    POOL_TYPES.forEach((pool) => stats.set(pool.type, { name: pool.name, count: 0, fiveStar: 0, currentPity: 0 }));
    records.forEach((record) => {
      const entry = stats.get(record.card_pool_type);
      if (!entry) return;
      entry.count += 1;
      if (record.quality_level === QUALITY.FIVE_STAR) entry.fiveStar += 1;
    });
    const resolvedCurrentPity = new Set<string>();
    allRecordsWithPity.forEach(({ record, pity }) => {
      const entry = stats.get(record.card_pool_type);
      if (!entry || resolvedCurrentPity.has(record.card_pool_type)) return;
      entry.currentPity = record.quality_level === QUALITY.FIVE_STAR ? 0 : pity;
      resolvedCurrentPity.add(record.card_pool_type);
    });
    return stats;
  }, [records, allRecordsWithPity]);

  const visiblePoolTypes = useMemo(
    () => POOL_TYPES.filter((pool) => (poolStats.get(pool.type)?.count ?? 0) > 0),
    [poolStats],
  );

  const effectiveScope: RecordScope = viewMode === 'table' ? scope : 'five';
  const gridItemsPerPage = gridColumns * GRID_ROWS_PER_PAGE;
  const effectiveItemsPerPage = viewMode === 'grid' ? gridItemsPerPage : itemsPerPage;

  useEffect(() => {
    const previousPageSize = previousGridPageSizeRef.current;
    if (viewMode === 'grid' && previousPageSize !== gridItemsPerPage) {
      setCurrentPage((page) => Math.floor(((page - 1) * previousPageSize) / gridItemsPerPage) + 1);
    }
    previousGridPageSizeRef.current = gridItemsPerPage;
  }, [gridItemsPerPage, viewMode]);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return allRecordsWithPity.filter(({ record }) => {
      if (activePoolType !== 'all' && record.card_pool_type !== activePoolType) return false;
      if (effectiveScope === 'five' && record.quality_level !== QUALITY.FIVE_STAR) return false;
      if (!normalizedQuery) return true;
      return [record.name, record.card_pool_name, record.time]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [allRecordsWithPity, activePoolType, effectiveScope, query]);

  const pagedList = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filteredRecords.length / effectiveItemsPerPage));
    const safeCurrentPage = Math.min(currentPage, totalPages);
    const start = (safeCurrentPage - 1) * effectiveItemsPerPage;
    return {
      total: filteredRecords.length,
      totalPages,
      safeCurrentPage,
      pageItems: filteredRecords.slice(start, start + effectiveItemsPerPage),
    };
  }, [filteredRecords, currentPage, effectiveItemsPerPage]);

  useEffect(() => setCurrentPage(1), [activePoolType, scope, query, viewMode, itemsPerPage]);
  useEffect(() => setPageSizeMenuOpen(false), [viewMode]);

  const totalFiveStar = records.filter((record) => record.quality_level === QUALITY.FIVE_STAR).length;
  const offRateCount = records.filter((record) => record.quality_level === QUALITY.FIVE_STAR && record.is_off_rate).length;
  const recordRange = useMemo(() => {
    if (records.length === 0) return null;
    const orderedTimes = records.map((record) => record.time).sort((a, b) => a.localeCompare(b));
    return { earliest: orderedTimes[0].slice(0, 10), latest: orderedTimes[orderedTimes.length - 1].slice(0, 10) };
  }, [records]);

  const clearFilters = () => {
    setActivePoolType('all');
    setScope('five');
    setQuery('');
  };

  return (
    <PageTransition>
      <div className="flex h-full flex-col">
        <header className="flex items-end justify-between gap-4 border-b border-white/[0.05] px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold text-tide">唤取记录</h1>
            <div className="mt-1 flex items-center gap-2 text-xs text-wave">
              <span>{records.length.toLocaleString()} 条记录</span>
              {recordRange && (
                <>
                  <span className="text-white/15">|</span>
                  <CalendarRange size={12} />
                  <span>{recordRange.earliest} 至 {recordRange.latest}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.03] p-0.5" aria-label="记录布局">
            {([
              ['list', '列表视图', AlignJustify],
              ['grid', '宫格视图', LayoutGrid],
              ['table', '表格视图', Rows3],
            ] as const).map(([mode, label, Icon]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                  viewMode === mode ? 'bg-white/[0.1] text-tide' : 'text-wave hover:bg-white/[0.04] hover:text-tide'
                }`}
                title={label}
                aria-label={label}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="w-[208px] shrink-0 overflow-y-auto border-r border-white/[0.05] p-3">
            <div className="border-b border-white/[0.05] px-2 pb-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-wave">累计唤取</span>
                <span className="text-lg font-semibold tabular-nums text-tide">{records.length.toLocaleString()}</span>
              </div>
              <div className="mt-1.5 flex gap-3 text-[11px]">
                <span className="text-[#d8bd84]">五星 {totalFiveStar}</span>
                <span className="text-[#d99a9a]">歪 {offRateCount}</span>
              </div>
            </div>

            <nav className="mt-2 space-y-1" aria-label="卡池筛选">
              <button
                onClick={() => setActivePoolType('all')}
                className={`w-full rounded-md px-3 py-2.5 text-left transition-colors ${
                  activePoolType === 'all' ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                }`}
              >
                <div className="text-sm text-tide">全部卡池</div>
                <div className="mt-0.5 text-[11px] text-wave">{records.length} 抽 · {totalFiveStar} 五星</div>
              </button>
              {visiblePoolTypes.map((pool) => {
                const stats = poolStats.get(pool.type)!;
                const isActive = activePoolType === pool.type;
                return (
                  <button
                    key={pool.type}
                    onClick={() => setActivePoolType(pool.type)}
                    className={`w-full rounded-md px-3 py-2.5 text-left transition-colors ${
                      isActive ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-tide">{pool.name}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[#8fc8be]">{stats.currentPity}/80</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-wave">{stats.count} 抽 · {stats.fiveStar} 五星</div>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main ref={contentRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.05] px-4 py-3">
              {viewMode === 'table' && (
                <div className="flex items-center gap-0.5 rounded-md border border-white/[0.06] bg-white/[0.03] p-0.5">
                  <button onClick={() => setScope('five')} className={`rounded px-3 py-1.5 text-xs ${scope === 'five' ? 'bg-white/[0.1] text-tide' : 'text-wave hover:text-tide'}`}>五星记录</button>
                  <button onClick={() => setScope('all')} className={`rounded px-3 py-1.5 text-xs ${scope === 'all' ? 'bg-white/[0.1] text-tide' : 'text-wave hover:text-tide'}`}>全部记录</button>
                </div>
              )}

              <div className="relative min-w-[180px] flex-1 md:max-w-[320px]">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-wave" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索名称、卡池或日期"
                  className="glass-input h-8 w-full pl-8 pr-8 text-xs"
                />
                {query && (
                  <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-wave hover:text-tide" title="清除搜索">
                    <X size={13} />
                  </button>
                )}
              </div>

              <span className="ml-auto text-xs text-wave">找到 <span className="tabular-nums text-tide">{pagedList.total}</span> 条</span>
            </div>

            {loading ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-wave">
                <LoaderCircle size={24} className="animate-spin" />
                <span className="text-sm">正在读取抽卡记录</span>
              </div>
            ) : error ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3">
                <div className="text-sm text-[#d99a9a]">记录读取失败</div>
                <button onClick={fetchRecords} className="flex items-center gap-2 rounded-md border border-white/[0.08] px-3 py-2 text-xs text-wave hover:text-tide">
                  <RefreshCw size={13} />重新读取
                </button>
              </div>
            ) : records.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.04] text-wave"><Sparkles size={21} /></div>
                <div className="text-sm font-medium text-tide">暂无抽卡记录</div>
                <p className="text-xs text-wave">先从首页扫描游戏目录或导入 JSON 文件</p>
                <Link to="/" className="rounded-md border border-white/[0.08] px-3 py-2 text-xs text-tide hover:bg-white/[0.04]">前往首页</Link>
              </div>
            ) : pagedList.total === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3">
                <Search size={22} className="text-wave" />
                <div className="text-sm font-medium text-tide">没有符合条件的记录</div>
                <button onClick={clearFilters} className="text-xs text-[#8fc8be] hover:text-[#b0d9d2]">清除筛选条件</button>
              </div>
            ) : (
              <motion.div
                key={viewMode === 'table' ? `${viewMode}-${scope}` : viewMode}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className="min-h-0 flex-1 overflow-auto"
              >
                {viewMode === 'list' && (
                  <div className="divide-y divide-white/[0.04] px-4">
                    {pagedList.pageItems.map(({ record, pity }, index) => {
                      const barColor = getBarColor(pity);
                      const barWidth = Math.min((pity / 80) * 100, 100);
                      return (
                        <div key={getRecordKey(record, index)} className="flex min-h-[64px] items-center gap-3 py-2.5">
                          <RecordAvatar record={record} />
                          <div className="w-24 shrink-0 min-w-0">
                            <div className="truncate text-sm text-tide" title={record.name}>{record.name}</div>
                            <div className="mt-0.5 text-[10px] tabular-nums text-wave">{record.time.slice(0, 10)}</div>
                          </div>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <div className="relative h-5 min-w-[72px] flex-1 overflow-hidden rounded bg-white/[0.06]">
                              <div
                                className="h-full rounded"
                                style={{ width: `${barWidth}%`, backgroundColor: barColor }}
                              />
                            </div>
                            <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums" style={{ color: barColor }}>
                              {pity}
                            </span>
                            <span className={`w-5 shrink-0 text-center text-[10px] font-bold ${record.is_off_rate ? 'text-[#d84848]' : 'text-transparent'}`}>
                              歪
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {viewMode === 'grid' && (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-3 p-4">
                    {pagedList.pageItems.map(({ record, pity }, index) => {
                      return (
                        <div key={getRecordKey(record, index)} className="min-w-0 rounded-lg border border-white/[0.06] bg-[#242424] p-2.5">
                          <div className="relative aspect-square overflow-hidden rounded-md">
                            <RecordAvatar record={record} size="lg" />
                            {record.is_off_rate && <span className="absolute bottom-1.5 left-1.5 rounded bg-[#a64f4f] px-1.5 py-0.5 text-[10px] text-white">歪</span>}
                          </div>
                          <div className="mt-2 truncate text-center text-xs text-tide">{record.name}</div>
                          <div className="mt-1 flex h-6 items-center justify-center text-[10px] text-wave">
                            <PityBadge pity={pity} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {viewMode === 'table' && (
                  <table className="w-full min-w-[720px] table-fixed text-xs">
                    <thead className="sticky top-0 z-10 bg-[#1f1f1f] text-wave">
                      <tr className="border-b border-white/[0.05]">
                        <th className="w-[154px] px-3 py-2.5 text-left font-medium">时间</th>
                        <th className="w-[150px] px-3 py-2.5 text-left font-medium">卡池</th>
                        <th className="px-3 py-2.5 text-left font-medium">物品</th>
                        <th className="w-[70px] px-3 py-2.5 text-left font-medium">类型</th>
                        <th className="w-[70px] px-3 py-2.5 text-center font-medium">品质</th>
                        <th className="w-[86px] px-3 py-2.5 text-center font-medium">池内抽数</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {pagedList.pageItems.map(({ record, pity }, index) => {
                        const isFive = record.quality_level === QUALITY.FIVE_STAR;
                        const color = QUALITY_COLORS[record.quality_level] ?? '#8a8a8a';
                        return (
                          <tr key={getRecordKey(record, index)} className="hover:bg-white/[0.025]">
                            <td className="px-3 py-2 tabular-nums text-wave">{record.time}</td>
                            <td className="truncate px-3 py-2 text-wave" title={record.card_pool_name}>{record.card_pool_name}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <RecordAvatar record={record} size="sm" />
                                <span className="truncate text-tide">{record.name}</span>
                                {record.is_off_rate && <span className="text-[10px] text-[#d99a9a]">歪</span>}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-wave">{record.resource_type === 'role' ? '角色' : '武器'}</td>
                            <td className="px-3 py-2 text-center" style={{ color }}>{QUALITY_LABELS[record.quality_level]}</td>
                            <td className="px-3 py-2 text-center">{isFive ? <PityBadge pity={pity} /> : <span className="text-wave">-</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </motion.div>
            )}

            {!loading && !error && pagedList.total > 0 && (
              <footer className="flex h-12 shrink-0 items-center border-t border-white/[0.05] px-4">
                {viewMode !== 'grid' && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setPageSizeMenuOpen((open) => !open)}
                      className="glass-input flex h-8 min-w-[108px] items-center justify-between gap-3 px-3 text-xs text-tide hover:border-white/[0.16]"
                      aria-haspopup="listbox"
                      aria-expanded={pageSizeMenuOpen}
                    >
                      <span>每页 {itemsPerPage} 条</span>
                      <ChevronDown size={13} className={`text-wave transition-transform ${pageSizeMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {pageSizeMenuOpen && (
                      <>
                        <button
                          type="button"
                          className="fixed inset-0 z-40 cursor-default"
                          onClick={() => setPageSizeMenuOpen(false)}
                          aria-label="关闭每页数量菜单"
                        />
                        <motion.div
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.12 }}
                          className="glass-card absolute bottom-full left-0 z-50 mb-2 w-32 overflow-hidden rounded-md p-1"
                          role="listbox"
                          aria-label="每页数量"
                        >
                          {[25, 50, 100].map((size) => (
                            <button
                              key={size}
                              type="button"
                              onClick={() => {
                                setItemsPerPage(size);
                                setPageSizeMenuOpen(false);
                              }}
                              className={`flex w-full items-center justify-between rounded px-2.5 py-2 text-left text-xs transition-colors ${
                                itemsPerPage === size ? 'bg-white/[0.08] text-tide' : 'text-wave hover:bg-white/[0.05] hover:text-tide'
                              }`}
                              role="option"
                              aria-selected={itemsPerPage === size}
                            >
                              <span>每页 {size} 条</span>
                              {itemsPerPage === size && <Check size={13} />}
                            </button>
                          ))}
                        </motion.div>
                      </>
                    )}
                  </div>
                )}
                <div className="ml-auto flex items-center gap-3 text-xs text-wave">
                  <span>
                    {(pagedList.safeCurrentPage - 1) * effectiveItemsPerPage + 1}-{Math.min(pagedList.safeCurrentPage * effectiveItemsPerPage, pagedList.total)}，共 {pagedList.total} 条
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={pagedList.safeCurrentPage <= 1} className="flex h-7 w-7 items-center justify-center rounded-md text-wave hover:bg-white/[0.05] hover:text-tide disabled:cursor-not-allowed disabled:opacity-30" aria-label="上一页"><ChevronLeft size={14} /></button>
                    <span className="min-w-14 text-center tabular-nums text-tide">{pagedList.safeCurrentPage}/{pagedList.totalPages}</span>
                    <button onClick={() => setCurrentPage((page) => Math.min(pagedList.totalPages, page + 1))} disabled={pagedList.safeCurrentPage >= pagedList.totalPages} className="flex h-7 w-7 items-center justify-center rounded-md text-wave hover:bg-white/[0.05] hover:text-tide disabled:cursor-not-allowed disabled:opacity-30" aria-label="下一页"><ChevronRight size={14} /></button>
                  </div>
                </div>
              </footer>
            )}
          </main>
        </div>
      </div>
    </PageTransition>
  );
}
