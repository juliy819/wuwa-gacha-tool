import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  LoaderCircle,
} from 'lucide-react';
import PageTransition from '../components/PageTransition';
import MockGachaDialog from '../components/MockGachaDialog';
import Modal from '../components/Modal';
import PageSignalField from '../components/PageSignalField';
import ResonanceEmptyState from '../components/ResonanceEmptyState';
import ResonanceCloseButton from '../components/ResonanceCloseButton';
import ResonanceActionIcon from '../components/ResonanceActionIcon';
import ResonanceIcon from '../components/ResonanceModeIcon';
import ResourceIcon from '../components/ResourceIcon';
import { gachaApi } from '../services/tauri-api';
import { useGachaStore } from '../store/useGachaStore';
import {
  POOL_TYPES,
  QUALITY,
  QUALITY_COLORS,
  QUALITY_LABELS,
  type GachaRecord,
  type GachaResource,
  type ResourceAcquisitionInsight,
} from '../types';

type ViewMode = 'list' | 'grid' | 'table';
type RecordScope = 'five' | 'all';
type RecordWithPity = { record: GachaRecord; pity: number; isLowerBound: boolean };

const GRID_ROWS_PER_PAGE = 5;
const GRID_MIN_ITEM_WIDTH = 108;
const GRID_GAP = 12;
const GRID_HORIZONTAL_PADDING = 32;

const getRecordKey = (record: GachaRecord, index: number) =>
  record.id !== undefined && record.id !== null
    ? `record-${record.id}`
    : `local-${record.card_pool_type}-${record.time}-${record.resource_id}-${index}`;

const getBarColor = (pity: number) => {
  if (pity <= 30) return '#7ec8a0';
  if (pity <= 60) return '#e8c87a';
  return '#e88a7a';
};

function RecordAvatar({ record, size = 'md' }: { record: GachaRecord; size?: 'sm' | 'md' | 'lg' }) {
  const color = QUALITY_COLORS[record.quality_level] ?? '#8a8a8a';
  const dimensions = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-full w-full' : 'h-12 w-12';
  const isFiveStar = record.quality_level === QUALITY.FIVE_STAR;

  return (
    <div
      className={`record-resource-frame ${isFiveStar ? 'record-resource-frame-five' : ''} relative shrink-0 overflow-hidden rounded-md border ${dimensions}`}
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

function PityBadge({ pity, lowerBound = false }: { pity: number; lowerBound?: boolean }) {
  const isHigh = pity >= 66;
  return (
    <span className={`inline-flex items-baseline gap-0.5 rounded border px-2 py-1 text-xs font-semibold tabular-nums ${
      isHigh
        ? 'border-[#d8bd84]/20 bg-[#d8bd84]/[0.07] text-[#d8bd84]'
        : 'border-[#6faaa0]/20 bg-[#6faaa0]/[0.07] text-[#8fc8be]'
    }`}>
      {lowerBound ? '≥' : ''}{pity}<span className="text-[10px] font-normal">抽</span>
    </span>
  );
}

export default function RecordsPage() {
  const records = useGachaStore((state) => state.records);
  const recordsLoaded = useGachaStore((state) => state.recordsLoaded);
  const recordsPlayerId = useGachaStore((state) => state.recordsPlayerId);
  const activePlayerId = useGachaStore((state) => state.activePlayerId);
  const initialized = useGachaStore((state) => state.initialized);
  const fetchRecords = useGachaStore((state) => state.fetchRecords);
  const fetchStats = useGachaStore((state) => state.fetchStats);
  const loading = useGachaStore((state) => state.loading);
  const error = useGachaStore((state) => state.error);
  const addToast = useGachaStore((state) => state.addToast);
  const [activePoolType, setActivePoolType] = useState('all');
  const [scope, setScope] = useState<RecordScope>('five');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [pageSizeMenuOpen, setPageSizeMenuOpen] = useState(false);
  const [gridColumns, setGridColumns] = useState(10);
  const [resources, setResources] = useState<GachaResource[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<GachaRecord | null>(null);
  const [mutating, setMutating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<GachaRecord | null>(null);
  const [acquisitionInsights, setAcquisitionInsights] = useState<ResourceAcquisitionInsight[]>([]);
  const [selectedAcquisition, setSelectedAcquisition] = useState<ResourceAcquisitionInsight | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  const poolNavRef = useRef<HTMLElement>(null);
  const [poolIndicator, setPoolIndicator] = useState({ top: 0, height: 0, visible: false });
  const previousGridPageSizeRef = useRef(gridColumns * GRID_ROWS_PER_PAGE);

  useEffect(() => {
    setActivePoolType('all');
    setCurrentPage(1);
  }, [activePlayerId]);

  useEffect(() => {
    if (!initialized) return;
    if (recordsLoaded && recordsPlayerId === activePlayerId) return;
    void fetchRecords();
  }, [activePlayerId, fetchRecords, initialized, recordsLoaded, recordsPlayerId]);

  useEffect(() => {
    if (!activePlayerId || !recordsLoaded || recordsPlayerId !== activePlayerId) {
      setAcquisitionInsights([]);
      return;
    }
    let current = true;
    gachaApi.getResourceAcquisitionInsights(activePlayerId, true)
      .then((result) => {
        if (!current) return;
        setAcquisitionInsights(result);
      })
      .catch(() => { if (current) setAcquisitionInsights([]); });
    return () => { current = false; };
  }, [activePlayerId, recordsLoaded, recordsPlayerId, records.length]);

  const loadResources = async () => {
    if (resources.length > 0 || resourcesLoading) return;
    setResourcesLoading(true);
    try {
      setResources(await gachaApi.getGachaResources());
    } catch (resourceError) {
      addToast('error', `资源目录读取失败: ${String(resourceError)}`);
    } finally {
      setResourcesLoading(false);
    }
  };

  const openInsertDialog = () => {
    if (!activePlayerId) {
      addToast('info', '请先导入记录或选择玩家 UID');
      return;
    }
    setEditingRecord(null);
    setDialogOpen(true);
    void loadResources();
  };

  const openEditDialog = (record: GachaRecord) => {
    setEditingRecord(record);
    setDialogOpen(true);
    void loadResources();
  };

  const refreshAfterMutation = async () => {
    await Promise.all([
      fetchRecords(),
      activePlayerId ? fetchStats(activePlayerId) : Promise.resolve(),
    ]);
  };

  const submitMockRecord = async (value: { card_pool_type: string; resource_id: number; time: string; pulls: number }) => {
    if (!activePlayerId) return;
    setMutating(true);
    try {
      if (editingRecord?.id) {
        await gachaApi.updateMockGacha({
          id: editingRecord.id,
          card_pool_type: value.card_pool_type,
          resource_id: value.resource_id,
          time: value.time,
        });
        addToast('success', '模拟记录已更新');
      } else {
        const inserted = await gachaApi.insertMockGacha({
          player_id: activePlayerId,
          card_pool_type: value.card_pool_type,
          resource_id: value.resource_id,
          pulls: value.pulls,
          time: value.time,
        });
        addToast('success', `已插入 ${inserted.length} 条模拟记录`);
      }
      setDialogOpen(false);
      setEditingRecord(null);
      await refreshAfterMutation();
    } catch (mutationError) {
      addToast('error', String(mutationError));
    } finally {
      setMutating(false);
    }
  };

  const handleDeleteClick = (record: GachaRecord) => {
    if (!record.id || !record.is_mock) return;
    setDeleteConfirm(record);
  };

  const confirmDeleteMockRecord = async () => {
    const record = deleteConfirm;
    if (!record?.id || !record.is_mock) return;
    setDeleteConfirm(null);
    setMutating(true);
    try {
      const result = await gachaApi.deleteMockGacha(record.id);
      addToast('success', `已删除 ${result.deleted_count} 条模拟记录`);
      await refreshAfterMutation();
    } catch (mutationError) {
      addToast('error', String(mutationError));
    } finally {
      setMutating(false);
    }
  };

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
    const poolsWithFiveStar = new Set<string>();
    const result = ordered.map((record) => {
      const pity = (pityByPool.get(record.card_pool_type) ?? 0) + 1;
      const isFiveStar = record.quality_level === QUALITY.FIVE_STAR;
      const isLowerBound = isFiveStar && !poolsWithFiveStar.has(record.card_pool_type);
      if (isFiveStar) poolsWithFiveStar.add(record.card_pool_type);
      pityByPool.set(record.card_pool_type, record.quality_level === QUALITY.FIVE_STAR ? 0 : pity);
      return { record, pity, isLowerBound };
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

  useLayoutEffect(() => {
    const nav = poolNavRef.current;
    if (!nav) return;

    const updateIndicator = () => {
      const activeButton = nav.querySelector<HTMLElement>(`[data-pool-type="${activePoolType}"]`);
      if (!activeButton) {
        setPoolIndicator((current) => ({ ...current, visible: false }));
        return;
      }
      setPoolIndicator({
        top: activeButton.offsetTop,
        height: activeButton.offsetHeight,
        visible: true,
      });
    };

    updateIndicator();
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [activePoolType, visiblePoolTypes]);

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
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();
    return allRecordsWithPity.filter(({ record }) => {
      if (activePoolType !== 'all' && record.card_pool_type !== activePoolType) return false;
      if (effectiveScope === 'five' && record.quality_level !== QUALITY.FIVE_STAR) return false;
      if (!normalizedQuery) return true;
      return [record.name, record.card_pool_name, record.time]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [allRecordsWithPity, activePoolType, deferredQuery, effectiveScope]);

  const lowerBoundCount = filteredRecords.filter(({ isLowerBound, record }) => isLowerBound && record.quality_level === QUALITY.FIVE_STAR).length;
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

  useEffect(() => {
    if (!pageSizeMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPageSizeMenuOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pageSizeMenuOpen]);
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

  const openAcquisition = (record: GachaRecord) => {
    if (record.quality_level !== QUALITY.FIVE_STAR || (record.is_off_rate && record.card_pool_group === 'UP角色池')) return;
    const insight = acquisitionInsights.find((item) => item.pool_type === record.card_pool_type && item.resource_id === record.resource_id);
    if (insight) setSelectedAcquisition(insight);
  };

  const cacheValid = recordsLoaded && recordsPlayerId === activePlayerId;
  const recordsLoading = !initialized || !cacheValid || loading;

  return (
    <PageTransition>
      <div className="records-page flex h-full flex-col">
        <header className="page-header records-page-header flex items-end justify-between gap-4 px-6 py-4">
          <PageSignalField variant="records" />
          <div>
            <h1 className="page-title text-xl font-semibold text-tide">唤取记录</h1>
            <div className="page-subtitle mt-1 flex items-center gap-2 text-xs text-wave">
              <span>{records.length.toLocaleString()} 条记录</span>
              {recordRange && (
                <>
                  <span className="text-white/15">|</span>
                  <ResonanceIcon kind="calendar" size={13} />
                  <span>{recordRange.earliest} 至 {recordRange.latest}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={openInsertDialog} disabled={!activePlayerId} className="tide-btn core-action-btn core-action-btn-insert flex h-9 items-center gap-2 px-3 text-xs" title="插入五星记录">
              <ResonanceActionIcon size="sm" tone="gold" className="core-action-icon core-action-icon-insert"><ResonanceIcon kind="add" size={14} /></ResonanceActionIcon>插入五星
            </button>
            <div className="flex items-center gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.03] p-0.5" aria-label="记录布局">
              {([
                ['list', '列表视图', 'traces'],
                ['grid', '宫格视图', 'matrix'],
                ['table', '表格视图', 'columns'],
              ] as const).map(([mode, label, iconKind]) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`relative flex h-8 w-8 items-center justify-center rounded-md ${
                    viewMode === mode ? 'text-tide' : 'text-wave hover:bg-white/[0.04] hover:text-tide'
                  }`}
                  title={label}
                  aria-label={label}
                >
                  {viewMode === mode && (
                    <motion.span
                      layoutId="record-view-indicator"
                      className="resonance-icon-tab-indicator absolute inset-0"
                      transition={{ type: 'spring', stiffness: 440, damping: 36 }}
                    >
                      <span className="resonance-tab-surface" />
                    </motion.span>
                  )}
                  <ResonanceActionIcon size="sm" tone={viewMode === mode ? 'gold' : 'default'} framed={false} className="relative z-10">
                    <ResonanceIcon kind={iconKind} />
                  </ResonanceActionIcon>
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="records-workbench flex min-h-0 flex-1 overflow-hidden">
          <aside className="records-sidebar w-[208px] shrink-0 overflow-y-auto p-3">
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

            <nav ref={poolNavRef} className="relative mt-2 flex flex-col gap-1" aria-label="卡池筛选">
              <motion.div
                initial={false}
                animate={{
                  top: poolIndicator.top,
                  height: poolIndicator.height,
                  opacity: poolIndicator.visible ? 1 : 0,
                }}
                transition={{ type: 'spring', stiffness: 400, damping: 36 }}
                className="pool-active-frame pointer-events-none absolute inset-x-0"
                aria-hidden="true"
              >
                <span className="pool-active-surface" />
              </motion.div>
              <button
                onClick={() => setActivePoolType('all')}
                data-pool-type="all"
                data-seq="00"
                className={`pool-filter relative w-full py-2.5 pl-9 pr-3 text-left ${
                  activePoolType === 'all' ? '' : 'hover:bg-white/[0.04]'
                }`}
              >
                <div className="relative text-sm text-tide">全部卡池</div>
                <div className="relative mt-0.5 text-[11px] text-wave">{records.length} 抽 · {totalFiveStar} 五星</div>
              </button>
              {visiblePoolTypes.map((pool, poolIndex) => {
                const stats = poolStats.get(pool.type)!;
                const isActive = activePoolType === pool.type;
                return (
                  <button
                    key={pool.type}
                    onClick={() => setActivePoolType(pool.type)}
                    data-pool-type={pool.type}
                    data-seq={String(poolIndex + 1).padStart(2, '0')}
                    className={`pool-filter relative w-full py-2.5 pl-9 pr-3 text-left ${
                      isActive ? '' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="relative flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-tide">{pool.name}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[#8fc8be]">{stats.currentPity}/80</span>
                    </div>
                    <div className="relative mt-0.5 text-[11px] text-wave">{stats.count} 抽 · {stats.fiveStar} 五星</div>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main ref={contentRef} className="records-main flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="records-toolbar flex min-h-[59px] flex-wrap items-center gap-y-2 px-4 py-3">
              <motion.div
                initial={false}
                animate={{
                  width: viewMode === 'table' ? 158 : 0,
                  opacity: viewMode === 'table' ? 1 : 0,
                }}
                transition={{
                  width: { duration: 0.28, ease: [0.4, 0, 0.2, 1] },
                  opacity: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
                }}
                aria-hidden={viewMode !== 'table'}
                className="shrink-0 overflow-hidden"
              >
                <div className="mr-2 flex w-[150px] items-center gap-0.5 whitespace-nowrap rounded-md border border-white/[0.06] bg-white/[0.03] p-0.5">
                  {(['five', 'all'] as const).map((value) => (
                    <button key={value} disabled={viewMode !== 'table'} onClick={() => setScope(value)} className={`relative whitespace-nowrap rounded px-3 py-1.5 text-xs ${scope === value ? 'text-tide' : 'text-wave hover:text-tide'}`}>
                      {scope === value && (
                        <motion.span layoutId="record-scope-indicator" className="resonance-tab-indicator absolute inset-0" transition={{ type: 'spring', stiffness: 440, damping: 36 }}>
                          <span className="resonance-tab-surface" />
                        </motion.span>
                      )}
                      <span className="relative z-10">{value === 'five' ? '五星记录' : '全部记录'}</span>
                    </button>
                  ))}
                </div>
              </motion.div>

              <div className="relative min-w-[180px] flex-1 md:max-w-[320px]">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索名称、卡池或日期"
                  className="glass-input h-8 w-full px-3 pr-8 text-xs"
                />
                {query && (
                  <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-wave hover:text-tide" title="清除搜索">
                    <ResonanceIcon kind="close" size={14} />
                  </button>
                )}
              </div>

              <span className="ml-auto text-xs text-wave">找到 <span className="tabular-nums text-tide">{pagedList.total}</span> 条</span>
            </div>
            <AnimatePresence initial={false}>
              {lowerBoundCount > 0 && (
                <motion.div
                  key="records-confidence-note"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{
                    height: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
                    opacity: { duration: 0.14, ease: [0.4, 0, 1, 1] },
                  }}
                  className="overflow-hidden"
                >
                  <div className="records-confidence-note">
                    <ResonanceIcon kind="info" size={13} />
                    <span>本次筛选包含 {lowerBoundCount} 条首个可见五星，抽数以 <b>≥</b> 标记，表示记录范围可能早于当前数据。</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false} mode="wait">
            {recordsLoading ? (
              <motion.div
                key="records-loading"
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.14, ease: [0.4, 0, 1, 1] }}
                className="flex flex-1 flex-col items-center justify-center gap-3 text-wave"
              >
                <LoaderCircle size={24} className="animate-spin" />
                <span className="text-sm">正在读取抽卡记录</span>
              </motion.div>
            ) : error ? (
              <motion.div
                key="records-error"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-1 flex-col items-center justify-center gap-3"
              >
                <div className="text-sm text-[#d99a9a]">记录读取失败</div>
                <button onClick={fetchRecords} className="flex items-center gap-2 rounded-md border border-white/[0.08] px-3 py-2 text-xs text-wave hover:text-tide">
                  <ResonanceIcon kind="refresh" size={14} />重新读取
                </button>
              </motion.div>
            ) : records.length === 0 ? (
              <motion.div
                key="records-empty"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-1"
              >
                <ResonanceEmptyState variant="records" title="暂无抽卡记录" description="先从首页扫描游戏目录或导入 JSON 文件" className="w-full">
                  <Link to="/" className="instrument-link-button">前往首页</Link>
                </ResonanceEmptyState>
              </motion.div>
            ) : pagedList.total === 0 ? (
              <motion.div
                key="records-no-results"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-1"
              >
                <ResonanceEmptyState variant="filter" title="没有符合条件的记录" description="当前卡池、范围或搜索词没有匹配项" compact className="w-full">
                  <button onClick={clearFilters} className="text-xs text-[#8fc8be] hover:text-[#b0d9d2]">清除筛选条件</button>
                </ResonanceEmptyState>
              </motion.div>
            ) : (
              <motion.div
                key={`records-content-${viewMode === 'table' ? `${viewMode}-${scope}` : viewMode}`}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="records-view-stage relative min-h-0 flex-1 overflow-auto"
              >
                <motion.span
                  className="records-view-scan"
                  initial={{ x: '-110%', opacity: 0 }}
                  animate={{ x: '118%', opacity: [0, 0.9, 0] }}
                  transition={{ duration: 0.72, times: [0, 0.22, 1], ease: [0.16, 1, 0.3, 1] }}
                  aria-hidden="true"
                />
                {viewMode === 'list' && (
                  <div className="record-list-track px-4">
                    {pagedList.pageItems.map(({ record, pity, isLowerBound }, index) => {
                      const barColor = getBarColor(pity);
                      const barWidth = Math.min((pity / 80) * 100, 100);
                      return (
                        <div key={getRecordKey(record, index)} data-seq={String(index + 1).padStart(2, '0')} onClick={() => openAcquisition(record)} role={record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate ? 'button' : undefined} tabIndex={record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate ? 0 : undefined} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate) openAcquisition(record); }} className={`record-list-row flex min-h-[64px] items-center gap-3 py-2.5 ${record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate ? 'cursor-pointer' : ''}`}>
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
                              {isLowerBound ? '≥' : ''}{pity}
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
                    {pagedList.pageItems.map(({ record, pity, isLowerBound }, index) => {
                      return (
                        <div key={getRecordKey(record, index)} data-seq={String(index + 1).padStart(2, '0')} onClick={() => openAcquisition(record)} role={record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate ? 'button' : undefined} tabIndex={record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate ? 0 : undefined} className={`record-grid-card resonance-panel min-w-0 p-2.5 ${record.quality_level === QUALITY.FIVE_STAR ? 'record-grid-card-five' : ''} ${record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate ? 'cursor-pointer' : ''}`}>
                          <div className="relative aspect-square overflow-hidden rounded-md">
                            <RecordAvatar record={record} size="lg" />
                            {record.is_off_rate && <span className="absolute bottom-1.5 left-1.5 rounded bg-[#a64f4f] px-1.5 py-0.5 text-[10px] text-white">歪</span>}
                          </div>
                          <div className="mt-2 truncate text-center text-xs text-tide">{record.name}</div>
                          <div className="mt-1 flex h-6 items-center justify-center text-[10px] text-wave">
                            <PityBadge pity={pity} lowerBound={isLowerBound} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {viewMode === 'table' && (
                  <table className="resonance-table w-full min-w-[820px] table-fixed text-xs">
                    <thead className="sticky top-0 z-10 bg-[#1f1f1f] text-wave">
                      <tr className="border-b border-white/[0.05]">
                        <th className="w-[154px] px-3 py-2.5 text-left font-medium">时间</th>
                        <th className="w-[150px] px-3 py-2.5 text-left font-medium">卡池</th>
                        <th className="px-3 py-2.5 text-left font-medium">物品</th>
                        <th className="w-[70px] px-3 py-2.5 text-left font-medium">类型</th>
                        <th className="w-[70px] px-3 py-2.5 text-center font-medium">品质</th>
                        <th className="w-[86px] px-3 py-2.5 text-center font-medium">池内抽数</th>
                        <th className="w-[84px] px-3 py-2.5 text-center font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {pagedList.pageItems.map(({ record, pity, isLowerBound }, index) => {
                        const isFive = record.quality_level === QUALITY.FIVE_STAR;
                        const color = QUALITY_COLORS[record.quality_level] ?? '#8a8a8a';
                        return (
                          <tr key={getRecordKey(record, index)} onClick={() => openAcquisition(record)} className={`${isFive ? 'record-table-row-five' : ''} ${isFive && !record.is_off_rate ? 'cursor-pointer' : ''}`}>
                            <td className="px-3 py-2 tabular-nums text-wave">{record.time}</td>
                            <td className="truncate px-3 py-2 text-wave" title={record.card_pool_name}>{record.card_pool_name}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <RecordAvatar record={record} size="sm" />
                                <span className="truncate text-tide">{record.name}</span>
                                {record.is_mock && <span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[10px] text-wave">模拟</span>}
                                {record.is_off_rate && <span className="text-[10px] text-[#d99a9a]">歪</span>}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-wave">{record.resource_type === 'role' ? '角色' : '武器'}</td>
                            <td className="px-3 py-2 text-center" style={{ color }}>{QUALITY_LABELS[record.quality_level]}</td>
                            <td className="px-3 py-2 text-center">{isFive ? <PityBadge pity={pity} lowerBound={isLowerBound} /> : <span className="text-wave">-</span>}</td>
                            <td className="px-3 py-2">
                              {record.is_mock ? (
                                <div className="flex items-center justify-center gap-1">
                                  <button type="button" onClick={(event) => { event.stopPropagation(); openEditDialog(record); }} disabled={mutating} className="flex h-7 w-7 items-center justify-center rounded-md text-wave hover:bg-white/[0.05] hover:text-tide disabled:opacity-40" title="编辑模拟记录"><ResonanceIcon kind="edit" size={14} /></button>
                                  <button type="button" onClick={(event) => { event.stopPropagation(); handleDeleteClick(record); }} disabled={mutating} className="flex h-7 w-7 items-center justify-center rounded-md text-wave hover:bg-[#d84848]/10 hover:text-[#d99a9a] disabled:opacity-40" title={isFive ? '删除整批模拟记录' : '删除模拟记录'}><ResonanceIcon kind="delete" size={14} /></button>
                                </div>
                              ) : <div className="text-center text-white/15">-</div>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </motion.div>
            )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
            {!recordsLoading && !error && pagedList.total > 0 && (
              <motion.footer
                key="records-footer"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 3 }}
                transition={{ duration: 0.2, delay: 0.04, ease: [0.16, 1, 0.3, 1] }}
                className="records-footer flex h-12 shrink-0 items-center px-4"
              >
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
                      <ResonanceIcon kind="chevron" size={13} className={`text-wave transition-transform ${pageSizeMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {pageSizeMenuOpen && (
                      <button
                          type="button"
                          className="fixed inset-0 z-40 cursor-default"
                          onClick={() => setPageSizeMenuOpen(false)}
                          aria-label="关闭每页数量菜单"
                        />
                    )}
                    <AnimatePresence>
                    {pageSizeMenuOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 3, scale: 0.985 }}
                          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
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
                              {itemsPerPage === size && <ResonanceIcon kind="check" size={13} />}
                            </button>
                          ))}
                        </motion.div>
                    )}
                    </AnimatePresence>
                  </div>
                )}
                <div className="ml-auto flex items-center gap-3 text-xs text-wave">
                  <span>
                    {(pagedList.safeCurrentPage - 1) * effectiveItemsPerPage + 1}-{Math.min(pagedList.safeCurrentPage * effectiveItemsPerPage, pagedList.total)}，共 {pagedList.total} 条
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={pagedList.safeCurrentPage <= 1} className="flex h-7 w-7 items-center justify-center rounded-md text-wave hover:bg-white/[0.05] hover:text-tide disabled:cursor-not-allowed disabled:opacity-30" aria-label="上一页"><ResonanceIcon kind="previous" size={14} /></button>
                    <span className="min-w-14 text-center tabular-nums text-tide">{pagedList.safeCurrentPage}/{pagedList.totalPages}</span>
                    <button onClick={() => setCurrentPage((page) => Math.min(pagedList.totalPages, page + 1))} disabled={pagedList.safeCurrentPage >= pagedList.totalPages} className="flex h-7 w-7 items-center justify-center rounded-md text-wave hover:bg-white/[0.05] hover:text-tide disabled:cursor-not-allowed disabled:opacity-30" aria-label="下一页"><ResonanceIcon kind="next" size={14} /></button>
                  </div>
                </div>
              </motion.footer>
            )}
            </AnimatePresence>
          </main>
        </div>
      </div>
      <MockGachaDialog
        open={dialogOpen}
        record={editingRecord}
        initialPoolType={activePoolType === 'all' ? '1' : activePoolType}
        resources={resources}
        loadingResources={resourcesLoading}
        submitting={mutating}
        onClose={() => { setDialogOpen(false); setEditingRecord(null); }}
        onSubmit={submitMockRecord}
      />

      <Modal
        open={selectedAcquisition !== null}
        onClose={() => setSelectedAcquisition(null)}
        className="max-w-4xl border-white/[0.10] bg-[#242424]"
        labelledBy="acquisition-trace-title"
      >
        {selectedAcquisition && (
          <div className="acquisition-trace-modal">
            <div className="flex items-start gap-3 border-b border-white/[0.07] p-5">
              <RecordAvatar record={{ resource_id: selectedAcquisition.resource_id, name: selectedAcquisition.name, quality_level: 5, is_off_rate: false } as GachaRecord} size="md" />
              <div className="min-w-0">
                <span className="records-meta-label">ACQUISITION TRACE</span>
                <h2 id="acquisition-trace-title" className="mt-1 text-lg font-semibold text-tide">{selectedAcquisition.name}</h2>
                <p className="mt-1 text-xs text-wave">{selectedAcquisition.pool_name} · {selectedAcquisition.target_count} 次获取</p>
              </div>
              <ResonanceCloseButton onClick={() => setSelectedAcquisition(null)} className="ml-auto shrink-0" />
            </div>
            <div className="grid grid-cols-2 gap-px border-b border-white/[0.07] bg-white/[0.06] sm:grid-cols-4">
              {[
                ['获取数量', `${selectedAcquisition.target_count} 次`],
                [selectedAcquisition.has_off_rate ? '歪 / 五星' : '五星记录', selectedAcquisition.has_off_rate ? `${selectedAcquisition.off_rate_count} / ${selectedAcquisition.total_five_star_count}` : `${selectedAcquisition.total_five_star_count}`],
                ['总抽数', `${selectedAcquisition.is_lower_bound ? '≥' : ''}${selectedAcquisition.total_pulls}`],
                ['平均每次', `${selectedAcquisition.is_lower_bound ? '≥' : ''}${selectedAcquisition.average_pulls?.toFixed(1) ?? '—'} 抽`],
              ].map(([label, value]) => <div key={label} className="bg-[#242424] px-4 py-3"><div className="text-[10px] text-wave">{label}</div><div className="mt-1 text-base font-semibold tabular-nums text-tide">{value}</div></div>)}
            </div>
            <div className="max-h-[58vh] overflow-y-auto px-5 py-4">
              <div className="space-y-2">
                {[...selectedAcquisition.records].reverse().map((item, index) => (
                  <div key={`${item.id ?? item.time}-${index}`} className={`flex items-center gap-3 rounded-md border px-3 py-2.5 ${item.is_off_rate ? 'border-[#d84848]/25 bg-[#d84848]/[0.04]' : 'border-white/[0.07] bg-white/[0.025]'}`}>
                    <ResourceIcon resourceId={item.resource_id} alt="" className="h-9 w-9 shrink-0 rounded" fallback={<span className="flex h-9 w-9 items-center justify-center rounded bg-white/[0.06] text-xs text-wave">{item.name.charAt(0)}</span>} />
                    <div className="min-w-0 w-24 shrink-0"><div className="truncate text-xs text-tide">{item.name}</div><div className="mt-0.5 text-[10px] text-wave">{item.is_off_rate ? `第 ${String(item.acquisition_index).padStart(2, '0')} 次 · 前置歪` : `第 ${String(item.acquisition_index).padStart(2, '0')} 次获取`}</div></div>
                    <div className="relative h-4 min-w-0 flex-1 overflow-hidden rounded bg-white/[0.06]"><div className="h-full rounded" style={{ width: `${Math.min(item.pity / (selectedAcquisition.pool_type === '5' ? 50 : 80) * 100, 100)}%`, background: item.is_off_rate ? '#d84848' : '#d8bd84' }} /></div>
                    <PityBadge pity={item.pity} lowerBound={item.is_lower_bound} />
                    <span className="hidden w-20 shrink-0 text-right text-[10px] tabular-nums text-wave sm:block">{item.time.slice(0, 10)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        closeDisabled={mutating}
        className="max-w-sm border-[#d84848]/30 bg-[#242424]"
        labelledBy="delete-mock-dialog-title"
      >
          {deleteConfirm && <>
            <div className="flex items-start gap-3 p-5">
              <div className="mt-0.5 shrink-0 rounded-md bg-[#d84848]/10 p-2 text-[#d99a9a]"><ResonanceIcon kind="warning" size={19} /></div>
              <div className="min-w-0">
                <h2 id="delete-mock-dialog-title" className="text-base font-medium text-tide">
                  {deleteConfirm.quality_level === QUALITY.FIVE_STAR ? '删除整批模拟记录' : '删除模拟记录'}
                </h2>
                <p className="mt-1.5 text-xs leading-5 text-wave">
                  {deleteConfirm.quality_level === QUALITY.FIVE_STAR
                    ? `将删除 ${deleteConfirm.name} 及其同批次的全部补足记录，此操作不可撤销。`
                    : `确定删除这条 ${deleteConfirm.name} 模拟记录？此操作不可撤销。`}
                </p>
              </div>
              <ResonanceCloseButton onClick={() => setDeleteConfirm(null)} disabled={mutating} className="ml-auto shrink-0" />
            </div>
            <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
              <button onClick={() => setDeleteConfirm(null)} disabled={mutating} className="px-4 py-2 text-sm text-wave hover:text-tide disabled:opacity-40">取消</button>
              <button
                onClick={() => void confirmDeleteMockRecord()}
                disabled={mutating}
                className="flex items-center gap-2 rounded-md bg-[#a64f4f] px-4 py-2 text-sm text-white hover:bg-[#b85a5a] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {mutating ? <LoaderCircle size={14} className="animate-spin" /> : <ResonanceIcon kind="delete" size={15} />}
                删除
              </button>
            </div>
          </>}
      </Modal>
    </PageTransition>
  );
}
