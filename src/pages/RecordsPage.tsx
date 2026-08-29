import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronsLeft,
  ChevronsRight,
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
import type { RecordNavigationState, RecordNavigationTarget } from '../lib/recordNavigation';
import { gachaApi } from '../services/tauri-api';
import { useGachaStore } from '../store/useGachaStore';
import {
  POOL_TYPES,
  QUALITY,
  QUALITY_COLORS,
  QUALITY_LABELS,
  type AcquisitionRecordInsight,
  type GachaRecord,
  type GachaResource,
  type ResourceAcquisitionInsight,
} from '../types';

type ViewMode = 'list' | 'grid' | 'table';
type GridStyle = 'avatar' | 'portrait';
type RecordScope = 'five' | 'all';
type SortOrder = 'desc' | 'asc';
type ListGrouping = 'five-star' | 'featured';
type RecordWithPity = { record: GachaRecord; pity: number; isLowerBound: boolean };
type FeaturedAcquisitionRow = {
  target: GachaRecord;
  segments: AcquisitionRecordInsight[];
  totalPulls: number;
  isLowerBound: boolean;
  acquisitionIndex: number;
};
type FeaturedListRow =
  | { kind: 'featured'; row: FeaturedAcquisitionRow }
  | { kind: 'record'; item: RecordWithPity };

interface RecordPreferences {
  viewMode: ViewMode;
  scope: RecordScope;
  sortOrder: SortOrder;
  listGrouping: ListGrouping;
  gridStyle: GridStyle;
  itemsPerPage: number;
}

const GRID_ROWS_PER_PAGE = 5;
const GRID_MIN_ITEM_WIDTH = 112;
const GRID_GAP = 10;
const GRID_HORIZONTAL_PADDING = 24;
const RECORD_PREFERENCES_KEY = 'wuwa-record-preferences-v1';
const LIMITED_ROLE_POOL_TYPES = new Set(['1', '8', '10', '12']);
const DEFAULT_RECORD_PREFERENCES: RecordPreferences = {
  viewMode: 'list',
  scope: 'five',
  sortOrder: 'desc',
  listGrouping: 'five-star',
  gridStyle: 'avatar',
  itemsPerPage: 50,
};

function loadRecordPreferences(): RecordPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(RECORD_PREFERENCES_KEY) ?? '{}') as Partial<RecordPreferences>;
    return {
      viewMode: ['list', 'grid', 'table'].includes(stored.viewMode ?? '') ? stored.viewMode! : DEFAULT_RECORD_PREFERENCES.viewMode,
      scope: stored.scope === 'all' ? 'all' : 'five',
      sortOrder: stored.sortOrder === 'asc' ? 'asc' : 'desc',
      listGrouping: stored.listGrouping === 'featured' ? 'featured' : 'five-star',
      gridStyle: stored.gridStyle === 'portrait' ? 'portrait' : 'avatar',
      itemsPerPage: [25, 50, 100].includes(stored.itemsPerPage ?? 0) ? stored.itemsPerPage! : DEFAULT_RECORD_PREFERENCES.itemsPerPage,
    };
  } catch {
    return DEFAULT_RECORD_PREFERENCES;
  }
}

const getRecordKey = (record: GachaRecord, index: number) =>
  record.id !== undefined && record.id !== null
    ? `record-${record.id}`
    : `local-${record.card_pool_type}-${record.time}-${record.resource_id}-${index}`;

const getBarColor = (pity: number) => {
  if (pity <= 30) return '#7ec8a0';
  if (pity <= 60) return '#e8c87a';
  return '#e88a7a';
};

function RecordAvatar({ record, size = 'md', gridStyle = 'avatar' }: { record: GachaRecord; size?: 'sm' | 'md' | 'lg'; gridStyle?: GridStyle }) {
  const color = QUALITY_COLORS[record.quality_level] ?? '#8a8a8a';
  const dimensions = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-full w-full' : 'h-12 w-12';
  const isFiveStar = record.quality_level === QUALITY.FIVE_STAR;
  const unstyledPortrait = size === 'lg' && gridStyle === 'portrait';
  const frameClassName = unstyledPortrait
    ? ''
    : `record-resource-frame ${isFiveStar ? 'record-resource-frame-five' : ''} rounded-md border`;
  const frameStyle = unstyledPortrait
    ? undefined
    : { borderColor: record.is_off_rate ? 'rgba(216,72,72,0.65)' : `${color}55`, background: `${color}10` };

  return (
    <div
      className={`${frameClassName} relative shrink-0 overflow-hidden ${dimensions}`}
      style={frameStyle}
    >
      <ResourceIcon
        resourceId={record.resource_id}
        alt={record.name}
        preferPortrait={size === 'lg' && gridStyle === 'portrait' && record.resource_type === 'role'}
        className={`h-full w-full ${size === 'lg' && gridStyle === 'portrait' && record.resource_type === 'role' ? 'object-cover object-top' : record.resource_type === 'weapon' && size === 'lg' && gridStyle === 'portrait' ? 'object-contain' : 'object-cover'}`}
        fallback={(
          <div className="absolute inset-0 flex items-center justify-center text-sm font-medium" style={{ color }}>
            {record.name.charAt(0)}
          </div>
        )}
      />
    </div>
  );
}

function PityPullAvatar({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const color = QUALITY_COLORS[QUALITY.FIVE_STAR];
  const dimensions = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-full w-full' : 'h-12 w-12';

  return (
    <div
      className={`record-resource-frame record-resource-frame-five relative shrink-0 overflow-hidden rounded-md border ${dimensions}`}
      style={{ borderColor: `${color}55`, background: `linear-gradient(135deg, ${color}18, ${color}08)` }}
    >
      <div className="absolute inset-0 flex items-center justify-center text-2xl font-bold" style={{ color }}>
        ?
      </div>
    </div>
  );
}

function OffRateStamp({ active, compact = false }: { active: boolean; compact?: boolean }) {
  return (
    <span
      className={`record-off-rate-stamp ${compact ? 'record-off-rate-stamp-compact' : ''} ${active ? 'record-off-rate-stamp-active' : ''}`}
      aria-label={active ? '歪' : undefined}
      aria-hidden={!active}
    >
      {active ? '歪' : ''}
    </span>
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
  const location = useLocation();
  const navigate = useNavigate();
  const [preferences] = useState(loadRecordPreferences);
  const records = useGachaStore((state) => state.records);
  const recordsLoaded = useGachaStore((state) => state.recordsLoaded);
  const recordsPlayerId = useGachaStore((state) => state.recordsPlayerId);
  const activePlayerId = useGachaStore((state) => state.activePlayerId);
  const initialized = useGachaStore((state) => state.initialized);
  const fetchRecords = useGachaStore((state) => state.fetchRecords);
  const fetchStats = useGachaStore((state) => state.fetchStats);
  const fetchSummaries = useGachaStore((state) => state.fetchSummaries);
  const loading = useGachaStore((state) => state.loading);
  const error = useGachaStore((state) => state.error);
  const addToast = useGachaStore((state) => state.addToast);
  const [activePoolType, setActivePoolType] = useState('all');
  const [scope, setScope] = useState<RecordScope>(preferences.scope);
  const [query, setQuery] = useState('');
  const [pityRange, setPityRange] = useState<{ min: number; max: number } | null>(null);
  const deferredQuery = useDeferredValue(query);
  const [viewMode, setViewMode] = useState<ViewMode>(preferences.viewMode);
  const [sortOrder, setSortOrder] = useState<SortOrder>(preferences.sortOrder);
  const [listGrouping, setListGrouping] = useState<ListGrouping>(preferences.listGrouping);
  const [gridStyle, setGridStyle] = useState<GridStyle>(preferences.gridStyle);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [itemsPerPage, setItemsPerPage] = useState(preferences.itemsPerPage);
  const [pageSizeMenuOpen, setPageSizeMenuOpen] = useState(false);
  const [gridColumns, setGridColumns] = useState(10);
  const [resources, setResources] = useState<GachaResource[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [missingPlayerDialogOpen, setMissingPlayerDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<GachaRecord | null>(null);
  const [mutating, setMutating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<GachaRecord | null>(null);
  const [acquisitionInsights, setAcquisitionInsights] = useState<ResourceAcquisitionInsight[]>([]);
  const [acquisitionInsightsLoaded, setAcquisitionInsightsLoaded] = useState(false);
  const [confirmedBoundaryPoolTypes, setConfirmedBoundaryPoolTypes] = useState<string[] | null>(null);
  const [selectedAcquisition, setSelectedAcquisition] = useState<ResourceAcquisitionInsight | null>(null);
  const [selectedAcquisitionRecordId, setSelectedAcquisitionRecordId] = useState<number | null>(null);
  const [pendingTarget, setPendingTarget] = useState<RecordNavigationTarget | null>(null);
  const [highlightedRecordId, setHighlightedRecordId] = useState<number | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  const poolNavRef = useRef<HTMLElement>(null);
  const [poolIndicator, setPoolIndicator] = useState({ top: 0, height: 0, visible: false });
  const previousGridPageSizeRef = useRef(gridColumns * GRID_ROWS_PER_PAGE);
  const highlightTimerRef = useRef<number | null>(null);
  const suppressNextPageResetRef = useRef(false);

  useEffect(() => {
    const nextPreferences = { viewMode, scope, sortOrder, listGrouping, gridStyle, itemsPerPage };
    try {
      localStorage.setItem(RECORD_PREFERENCES_KEY, JSON.stringify(nextPreferences));
    } catch {
      // Preferences are optional; private storage modes may reject writes.
    }
  }, [gridStyle, itemsPerPage, listGrouping, scope, sortOrder, viewMode]);

  useEffect(() => () => {
    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
  }, []);

  useEffect(() => {
    setActivePoolType('all');
    setPityRange(null);
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
      setAcquisitionInsightsLoaded(!activePlayerId);
      return;
    }
    let current = true;
    setAcquisitionInsightsLoaded(false);
    gachaApi.getResourceAcquisitionInsights(activePlayerId, true)
      .then((result) => {
        if (!current) return;
        setAcquisitionInsights(result);
        setAcquisitionInsightsLoaded(true);
      })
      .catch(() => {
        if (!current) return;
        setAcquisitionInsights([]);
        setAcquisitionInsightsLoaded(true);
      });
    return () => { current = false; };
  }, [activePlayerId, recordsLoaded, recordsPlayerId, records.length]);

  useEffect(() => {
    let current = true;
    if (!activePlayerId || !recordsLoaded || recordsPlayerId !== activePlayerId) {
      setConfirmedBoundaryPoolTypes(null);
      return;
    }
    gachaApi.getPoolBoundaryStatuses(activePlayerId)
      .then((statuses) => {
        if (current) {
          setConfirmedBoundaryPoolTypes(
            statuses.filter((status) => status.confirmed).map((status) => status.pool_type),
          );
        }
      })
      .catch(() => { if (current) setConfirmedBoundaryPoolTypes([]); });
    return () => { current = false; };
  }, [activePlayerId, recordsLoaded, recordsPlayerId, records.length]);

  const confirmedBoundaryPools = useMemo(
    () => new Set(confirmedBoundaryPoolTypes ?? []),
    [confirmedBoundaryPoolTypes],
  );

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
      setMissingPlayerDialogOpen(true);
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
      fetchSummaries(),
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
      const minItemWidth = gridStyle === 'portrait' ? GRID_MIN_ITEM_WIDTH : 100;
      const columns = Math.max(1, Math.floor((availableWidth + GRID_GAP) / (minItemWidth + GRID_GAP)));
      setGridColumns(columns);
    };

    updateGridColumns();
    const observer = new ResizeObserver(updateGridColumns);
    observer.observe(content);
    return () => observer.disconnect();
  }, [gridStyle]);

  const chronologicalRecordsWithPity = useMemo<RecordWithPity[]>(() => {
    const ordered = [...records].sort((a, b) => {
      const timeOrder = a.time.localeCompare(b.time);
      return timeOrder !== 0 ? timeOrder : (b.id ?? 0) - (a.id ?? 0);
    });
    const pityByPool = new Map<string, number>();
    const poolsWithFiveStar = new Set<string>();
    const result = ordered.map((record) => {
      const pity = (pityByPool.get(record.card_pool_type) ?? 0) + 1;
      const isFiveStar = record.quality_level === QUALITY.FIVE_STAR;
      const isLowerBound = isFiveStar
        && confirmedBoundaryPoolTypes !== null
        && !poolsWithFiveStar.has(record.card_pool_type)
        && !confirmedBoundaryPools.has(record.card_pool_type);
      if (isFiveStar) poolsWithFiveStar.add(record.card_pool_type);
      pityByPool.set(record.card_pool_type, record.quality_level === QUALITY.FIVE_STAR ? 0 : pity);
      return { record, pity, isLowerBound };
    });
    return result;
  }, [records, confirmedBoundaryPoolTypes, confirmedBoundaryPools]);

  const allRecordsWithPity = useMemo(
    () => sortOrder === 'desc' ? [...chronologicalRecordsWithPity].reverse() : chronologicalRecordsWithPity,
    [chronologicalRecordsWithPity, sortOrder],
  );

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
    for (let index = chronologicalRecordsWithPity.length - 1; index >= 0; index -= 1) {
      const { record, pity } = chronologicalRecordsWithPity[index];
      const entry = stats.get(record.card_pool_type);
      if (!entry || resolvedCurrentPity.has(record.card_pool_type)) continue;
      entry.currentPity = record.quality_level === QUALITY.FIVE_STAR ? 0 : pity;
      resolvedCurrentPity.add(record.card_pool_type);
    }
    return stats;
  }, [records, chronologicalRecordsWithPity]);

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

  const activePoolCurrentPity = useMemo(() => {
    if (activePoolType === 'all') return null;
    const stats = poolStats.get(activePoolType);
    if (!stats || stats.count === 0) return null;
    // 如果最新一条就是五星，说明当前垫抽为0，不需要显示
    if (stats.currentPity === 0) return null;
    return stats.currentPity;
  }, [activePoolType, poolStats]);

  // 宫格模式下，如果有垫抽卡片，需要预留一个位置，保证最后一行能排满
  const gridItemsPerPage = gridColumns * GRID_ROWS_PER_PAGE - (activePoolCurrentPity !== null ? 1 : 0);

  const effectiveItemsPerPage = viewMode === 'grid' ? gridItemsPerPage : itemsPerPage;

  const activePoolTrailingOffRate = useMemo<RecordWithPity | null>(() => {
    if (activePoolType === 'all' || !LIMITED_ROLE_POOL_TYPES.has(activePoolType)) return null;
    for (let index = chronologicalRecordsWithPity.length - 1; index >= 0; index -= 1) {
      const item = chronologicalRecordsWithPity[index];
      if (item.record.card_pool_type !== activePoolType || item.record.quality_level !== QUALITY.FIVE_STAR) continue;
      return item.record.is_off_rate ? item : null;
    }
    return null;
  }, [activePoolType, chronologicalRecordsWithPity]);

  useEffect(() => {
    const previousPageSize = previousGridPageSizeRef.current;
    if (viewMode === 'grid' && previousPageSize !== gridItemsPerPage) {
      setCurrentPage((page) => Math.floor(((page - 1) * previousPageSize) / gridItemsPerPage) + 1);
    }
    previousGridPageSizeRef.current = gridItemsPerPage;
  }, [gridItemsPerPage, viewMode]);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();
    return allRecordsWithPity.filter(({ record, pity }) => {
      if (activePoolType !== 'all' && record.card_pool_type !== activePoolType) return false;
      if (effectiveScope === 'five' && record.quality_level !== QUALITY.FIVE_STAR) return false;
      if (pityRange && (record.quality_level !== QUALITY.FIVE_STAR || pity < pityRange.min || pity > pityRange.max)) return false;
      if (!normalizedQuery) return true;
      return [record.name, record.card_pool_name, record.time]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [allRecordsWithPity, activePoolType, deferredQuery, effectiveScope, pityRange]);

  const allFeaturedAcquisitions = useMemo(() => {
    const recordsById = new Map(records.flatMap((record) => record.id == null ? [] : [[record.id, record] as const]));
    const rows: FeaturedAcquisitionRow[] = [];

    acquisitionInsights.forEach((insight) => {
      if (!LIMITED_ROLE_POOL_TYPES.has(insight.pool_type)) return;
      const byAcquisition = new Map<number, AcquisitionRecordInsight[]>();
      insight.records.forEach((record) => {
        const group = byAcquisition.get(record.acquisition_index) ?? [];
        group.push(record);
        byAcquisition.set(record.acquisition_index, group);
      });
      byAcquisition.forEach((segments, acquisitionIndex) => {
        const targetSegment = segments.find((segment) => segment.is_target);
        const target = targetSegment?.id == null ? null : recordsById.get(targetSegment.id);
        if (!target || target.is_off_rate) return;
        const totalPulls = segments.reduce((sum, segment) => sum + segment.pity, 0);
        const row = {
          target,
          segments,
          totalPulls,
          isLowerBound: segments.some((segment) => segment.is_lower_bound),
          acquisitionIndex,
        };
        rows.push(row);
      });
    });

    rows.sort((a, b) => {
      const timeOrder = a.target.time.localeCompare(b.target.time);
      const stableOrder = timeOrder !== 0 ? timeOrder : (b.target.id ?? 0) - (a.target.id ?? 0);
      return sortOrder === 'desc' ? -stableOrder : stableOrder;
    });
    return rows;
  }, [acquisitionInsights, records, sortOrder]);

  const featuredAcquisitions = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();
    return allFeaturedAcquisitions.filter(({ target, segments, totalPulls }) => {
      if (activePoolType !== 'all' && target.card_pool_type !== activePoolType) return false;
      if (pityRange && (totalPulls < pityRange.min || totalPulls > pityRange.max)) return false;
      if (!normalizedQuery) return true;
      return [target.name, target.card_pool_name, target.time, ...segments.map((segment) => segment.name)]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [activePoolType, allFeaturedAcquisitions, deferredQuery, pityRange]);

  const groupedRecordIds = useMemo(() => new Set(
    allFeaturedAcquisitions.flatMap(({ segments }) => segments.flatMap(({ id }) => id == null ? [] : [id])),
  ), [allFeaturedAcquisitions]);

  const featuredListRows = useMemo<FeaturedListRow[]>(() => {
    const rows: FeaturedListRow[] = featuredAcquisitions.map((row) => ({ kind: 'featured', row }));
    if (activePoolType === 'all') {
      filteredRecords.forEach((item) => {
        const { record } = item;
        // 全部卡池的 UP 合并只展示 UP 获取和其它未归并记录，孤立歪五星不单独列出。
        if (record.quality_level === QUALITY.FIVE_STAR && record.is_off_rate) return;
        const belongsToCompletedGroup = record.id != null && groupedRecordIds.has(record.id);
        if (!LIMITED_ROLE_POOL_TYPES.has(record.card_pool_type) || !belongsToCompletedGroup) {
          rows.push({ kind: 'record', item });
        }
      });
      rows.sort((a, b) => {
        const aRecord = a.kind === 'featured' ? a.row.target : a.item.record;
        const bRecord = b.kind === 'featured' ? b.row.target : b.item.record;
        const timeOrder = aRecord.time.localeCompare(bRecord.time);
        const stableOrder = timeOrder !== 0 ? timeOrder : (bRecord.id ?? 0) - (aRecord.id ?? 0);
        return sortOrder === 'desc' ? -stableOrder : stableOrder;
      });
    }
    return rows;
  }, [activePoolType, featuredAcquisitions, filteredRecords, groupedRecordIds, sortOrder]);

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
  const featuredPagedList = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(featuredListRows.length / effectiveItemsPerPage));
    const safeCurrentPage = Math.min(currentPage, totalPages);
    const start = (safeCurrentPage - 1) * effectiveItemsPerPage;
    return {
      total: featuredListRows.length,
      totalPages,
      safeCurrentPage,
      pageItems: featuredListRows.slice(start, start + effectiveItemsPerPage),
    };
  }, [currentPage, effectiveItemsPerPage, featuredListRows]);
  const canShowFeaturedGrouping = viewMode === 'list'
    && (activePoolType === 'all' || LIMITED_ROLE_POOL_TYPES.has(activePoolType));
  const showingFeaturedAcquisitions = canShowFeaturedGrouping && listGrouping === 'featured';
  const activePoolCurrentFeaturedCycle = useMemo(() => {
    if (!showingFeaturedAcquisitions || activePoolCurrentPity === null) return null;
    const offRatePity = activePoolTrailingOffRate?.pity ?? 0;
    return {
      offRatePity,
      currentPity: activePoolCurrentPity,
      totalPity: offRatePity + activePoolCurrentPity,
      isLowerBound: activePoolTrailingOffRate?.isLowerBound ?? false,
    };
  }, [activePoolCurrentPity, activePoolTrailingOffRate, showingFeaturedAcquisitions]);
  const activePagedList = showingFeaturedAcquisitions ? featuredPagedList : pagedList;
  const showCurrentPity = activePoolCurrentPity !== null
    && (sortOrder === 'desc'
      ? activePagedList.safeCurrentPage === 1
      : activePagedList.safeCurrentPage === activePagedList.totalPages);
  const activeLowerBoundCount = showingFeaturedAcquisitions
    ? featuredListRows.filter((item) => item.kind === 'featured' ? item.row.isLowerBound : item.item.isLowerBound).length
    : lowerBoundCount;

  const queueRecordTarget = (target: RecordNavigationTarget) => {
    const targetScope = target.scope ?? 'five';
    suppressNextPageResetRef.current = Boolean(
      (target.poolType && target.poolType !== activePoolType)
      || query
      || targetScope !== scope
      || (target.viewMode && target.viewMode !== viewMode)
      || (target.sortOrder && target.sortOrder !== sortOrder)
      || listGrouping !== 'five-star',
    );
    if (target.poolType) setActivePoolType(target.poolType);
    setQuery('');
    setScope(targetScope);
    if (target.viewMode) setViewMode(target.viewMode);
    setListGrouping('five-star');
    if (target.sortOrder) setSortOrder(target.sortOrder);
    setPityRange(target.pityRange ?? null);
    setPendingTarget(target);
  };

  useEffect(() => {
    const target = (location.state as RecordNavigationState | null)?.recordTarget;
    if (!target || !recordsLoaded || recordsPlayerId !== activePlayerId) return;
    queueRecordTarget(target);
    navigate(location.pathname, { replace: true, state: null });
  }, [activePlayerId, location.pathname, location.state, navigate, recordsLoaded, recordsPlayerId]);

  useEffect(() => {
    if (!pendingTarget) return;
    if (pendingTarget.recordId === undefined) {
      setCurrentPage(1);
      setPendingTarget(null);
      return;
    }
    const targetIndex = filteredRecords.findIndex(({ record }) => record.id === pendingTarget.recordId);
    if (targetIndex < 0) {
      addToast('info', '未在当前玩家记录中找到目标记录');
      setPendingTarget(null);
      return;
    }
    setCurrentPage(Math.floor(targetIndex / effectiveItemsPerPage) + 1);
  }, [addToast, effectiveItemsPerPage, filteredRecords, pendingTarget]);

  useEffect(() => {
    const targetId = pendingTarget?.recordId;
    if (targetId === undefined || !pagedList.pageItems.some(({ record }) => record.id === targetId)) return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(`[data-record-id="${targetId}"]`);
      if (!element) return;
      const scrollContainer = element.closest<HTMLElement>('.records-view-stage');
      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const centeredTop = scrollContainer.scrollTop
          + elementRect.top - containerRect.top
          - (scrollContainer.clientHeight - elementRect.height) / 2;
        scrollContainer.scrollTo({ top: Math.max(0, centeredTop), behavior: 'smooth' });
      } else {
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }
      setHighlightedRecordId(targetId);
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => setHighlightedRecordId(null), 2400);
      setPendingTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pagedList.pageItems, pendingTarget]);

  useEffect(() => {
    if (suppressNextPageResetRef.current) {
      suppressNextPageResetRef.current = false;
      return;
    }
    setCurrentPage(1);
  }, [activePoolType, scope, query, viewMode, itemsPerPage, listGrouping, sortOrder, pityRange, gridStyle]);

  useEffect(() => {
    setPageInput(String(activePagedList.safeCurrentPage));
  }, [activePagedList.safeCurrentPage]);

  useEffect(() => {
    if (!pageSizeMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPageSizeMenuOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pageSizeMenuOpen]);
  useEffect(() => setPageSizeMenuOpen(false), [viewMode]);

  const commitPageInput = () => {
    const parsed = Number.parseInt(pageInput, 10);
    const nextPage = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), activePagedList.totalPages) : activePagedList.safeCurrentPage;
    setCurrentPage(nextPage);
    setPageInput(String(nextPage));
  };

  const totalFiveStar = records.filter((record) => record.quality_level === QUALITY.FIVE_STAR).length;
  const offRateCount = records.filter((record) => record.quality_level === QUALITY.FIVE_STAR && record.is_off_rate).length;
  const recordRange = useMemo(() => {
    if (records.length === 0) return null;
    const orderedTimes = records.map((record) => record.time).sort((a, b) => a.localeCompare(b));
    return { earliest: orderedTimes[0].slice(0, 10), latest: orderedTimes[orderedTimes.length - 1].slice(0, 10) };
  }, [records]);

  const clearFilters = () => {
    setActivePoolType('all');
    setListGrouping('five-star');
    setScope('five');
    setQuery('');
    setPityRange(null);
  };

  const openAcquisition = (record: GachaRecord) => {
    if (record.quality_level !== QUALITY.FIVE_STAR || (record.is_off_rate && record.card_pool_group === 'UP角色池')) return;
    const insight = acquisitionInsights.find((item) => item.pool_type === record.card_pool_type && item.resource_id === record.resource_id);
    if (insight) {
      setSelectedAcquisition(insight);
      setSelectedAcquisitionRecordId(record.id ?? null);
    }
  };

  const acquisitionRecords = useMemo(
    () => selectedAcquisition ? [...selectedAcquisition.records].reverse() : [],
    [selectedAcquisition],
  );
  const selectedAcquisitionIndex = acquisitionRecords.findIndex((record) => record.id === selectedAcquisitionRecordId);
  const stepAcquisition = (direction: -1 | 1) => {
    if (acquisitionRecords.length === 0) return;
    const currentIndex = selectedAcquisitionIndex >= 0 ? selectedAcquisitionIndex : 0;
    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), acquisitionRecords.length - 1);
    setSelectedAcquisitionRecordId(acquisitionRecords[nextIndex]?.id ?? null);
  };

  const locateAcquisitionRecord = (recordId: number | null | undefined) => {
    if (recordId == null || !selectedAcquisition) return;
    const poolType = selectedAcquisition.pool_type;
    setSelectedAcquisition(null);
    setSelectedAcquisitionRecordId(null);
    queueRecordTarget({ recordId, poolType, source: 'acquisition-trace' });
  };

  const cacheValid = recordsLoaded && recordsPlayerId === activePlayerId;
  const recordsLoading = !initialized || !cacheValid || loading;
  const activeRecordsLoading = recordsLoading || (showingFeaturedAcquisitions && !acquisitionInsightsLoaded);
  const toolbarControl = viewMode === 'table'
    ? 'scope'
    : viewMode === 'grid'
      ? 'grid-style'
      : canShowFeaturedGrouping
        ? 'list-grouping'
        : null;

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
            <button onClick={openInsertDialog} className="tide-btn core-action-btn core-action-btn-insert flex h-9 items-center gap-2 px-3 text-xs" title="插入五星记录">
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
                    onClick={() => {
                      setActivePoolType(pool.type);
                      if (!LIMITED_ROLE_POOL_TYPES.has(pool.type)) setListGrouping('five-star');
                    }}
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
            <div className="records-toolbar flex min-h-[59px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <motion.div
                initial={false}
                animate={{ width: toolbarControl ? 150 : 0, opacity: 1 }}
                transition={{
                  width: { duration: 0.24, ease: [0.4, 0, 0.2, 1] },
                  opacity: { duration: 0 },
                }}
                className="relative h-8 shrink-0 overflow-hidden"
              >
                <AnimatePresence initial={false} mode="sync">
                  {toolbarControl === 'scope' && (
                    <motion.div key="scope" initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }} className="absolute inset-0 flex w-[150px] items-center gap-0.5 whitespace-nowrap rounded-md border border-white/[0.06] bg-white/[0.03] p-0.5">
                      {(['five', 'all'] as const).map((value) => (
                        <button key={value} onClick={() => setScope(value)} className={`relative flex-1 whitespace-nowrap rounded px-3 py-1.5 text-xs ${scope === value ? 'text-tide' : 'text-wave hover:text-tide'}`}>
                          {scope === value && <motion.span layoutId="record-scope-indicator" className="resonance-tab-indicator absolute inset-0" transition={{ type: 'spring', stiffness: 440, damping: 36 }}><span className="resonance-tab-surface" /></motion.span>}
                          <span className="relative z-10">{value === 'five' ? '五星记录' : '全部记录'}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                  {toolbarControl === 'list-grouping' && (
                  <motion.div
                    key="list-grouping"
                    initial={{ opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -6 }}
                    transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
                    className="absolute inset-0 flex w-[150px] items-center gap-0.5 whitespace-nowrap rounded-md border border-white/[0.06] bg-white/[0.03] p-0.5"
                    aria-label="列表统计方式"
                  >
                      {(['five-star', 'featured'] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setListGrouping(value)}
                          aria-pressed={listGrouping === value}
                          className={`relative flex-1 rounded px-2.5 py-1.5 text-xs ${listGrouping === value ? 'text-tide' : 'text-wave hover:text-tide'}`}
                        >
                          {listGrouping === value ? (
                            <motion.span
                              layoutId="record-list-grouping-indicator"
                              className="resonance-tab-indicator absolute inset-0"
                              transition={{ type: 'spring', stiffness: 440, damping: 36 }}
                            >
                              <span className="resonance-tab-surface" />
                            </motion.span>
                          ) : null}
                          <span className="relative z-10">{value === 'five-star' ? '五星成本' : activePoolType === 'all' ? 'UP 合并' : 'UP 获取'}</span>
                        </button>
                      ))}
                  </motion.div>
                  )}
                  {toolbarControl === 'grid-style' && (
                    <motion.div key="grid-style" initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }} className="absolute inset-0 flex w-[150px] items-center gap-0.5 rounded-md border border-white/[0.06] bg-white/[0.03] p-0.5" aria-label="宫格样式">
                      {(['avatar', 'portrait'] as const).map((style) => (
                        <motion.button key={style} type="button" onClick={() => setGridStyle(style)} aria-pressed={gridStyle === style} whileTap={{ scale: 0.96 }} className={`relative h-full flex-1 rounded px-2.5 text-xs ${gridStyle === style ? 'text-tide' : 'text-wave hover:bg-white/[0.04] hover:text-tide'}`} title={style === 'avatar' ? '头像样式' : '立绘样式'}>
                          {gridStyle === style && <motion.span layoutId="record-grid-style-indicator" className="resonance-tab-indicator absolute inset-0" transition={{ type: 'spring', stiffness: 440, damping: 36 }}><span className="resonance-tab-surface" /></motion.span>}
                          <span className="relative z-10">{style === 'avatar' ? '头像' : '立绘'}</span>
                        </motion.button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
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

              <button
                type="button"
                onClick={() => setSortOrder((current) => current === 'desc' ? 'asc' : 'desc')}
                className="ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.025] px-2.5 text-xs text-wave hover:bg-white/[0.05] hover:text-tide"
                title={sortOrder === 'desc' ? '当前最新优先，点击切换为最早优先' : '当前最早优先，点击切换为最新优先'}
              >
                {sortOrder === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
                {sortOrder === 'desc' ? '最新优先' : '最早优先'}
              </button>
              <span className="shrink-0 whitespace-nowrap text-xs text-wave">找到 <span className="tabular-nums text-tide">{activePagedList.total}</span> 条</span>
            </div>
            <AnimatePresence initial={false}>
              {activeLowerBoundCount > 0 && (
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
                    <span className="min-w-0 flex-1">本次筛选包含 {activeLowerBoundCount} 条历史起点不完整的{showingFeaturedAcquisitions ? activePoolType === 'all' ? '五星获取' : ' UP 获取' : '首个可见五星'}，抽数以 <b>≥</b> 标记。</span>
                    <button
                      type="button"
                      onClick={() => navigate('/settings', {
                        state: {
                          boundaryPlayerId: activePlayerId ?? undefined,
                          boundaryPoolType: activePoolType === 'all' ? undefined : activePoolType,
                        },
                      })}
                      className="inline-flex shrink-0 items-center gap-1 text-[10px] text-[#d8bd84] hover:text-[#f0d9a7]"
                      title="前往设置确认卡池历史起点"
                    >
                      去设置确认起点
                      <ArrowRight size={12} />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false} mode="popLayout">
            {activeRecordsLoading ? (
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
            ) : activePagedList.total === 0 ? (
              <motion.div
                key="records-no-results"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-1"
              >
                <ResonanceEmptyState variant="filter" title="没有符合条件的记录" description={showingFeaturedAcquisitions ? activePoolType === 'all' ? '当前筛选下没有匹配的 UP 合并或其它五星记录' : '当前筛选下没有完整归属到 UP 角色的获取记录' : '当前卡池、范围或搜索词没有匹配项'} compact className="w-full">
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
                {viewMode === 'list' && (
                  <div className={`record-list-track px-4 ${sortOrder === 'asc' ? 'flex flex-col' : ''}`}>
                    {showCurrentPity && (
                      <div data-seq="00" className={`record-list-row record-pity-pull-row flex min-h-[64px] items-center gap-3 py-2.5 ${sortOrder === 'asc' ? 'order-last' : ''}`} style={{ opacity: 0.85 }}>
                        <PityPullAvatar />
                        <div className="w-24 shrink-0 min-w-0">
                          <div className="truncate text-sm text-tide" style={{ color: QUALITY_COLORS[QUALITY.FIVE_STAR] }}>垫抽中</div>
                          <div className="mt-0.5 truncate text-[10px] tabular-nums text-wave">
                            {activePoolCurrentFeaturedCycle?.offRatePity
                              ? `歪 ${activePoolCurrentFeaturedCycle.offRatePity} + 垫 ${activePoolCurrentFeaturedCycle.currentPity}`
                              : activePoolCurrentFeaturedCycle ? '当前 UP 周期' : '当前卡池'}
                          </div>
                        </div>
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <div
                            className="relative h-5 min-w-[72px] flex-1 overflow-hidden rounded bg-white/[0.06]"
                            aria-label={activePoolCurrentFeaturedCycle ? `${activePoolCurrentFeaturedCycle.totalPity}/160 抽` : `${activePoolCurrentPity}/80 抽`}
                          >
                            {activePoolCurrentFeaturedCycle ? (
                              <div
                                className="record-featured-progress-fill flex h-full overflow-hidden rounded"
                                style={{ width: `${Math.min((activePoolCurrentFeaturedCycle.totalPity / 160) * 100, 100)}%` }}
                              >
                                {activePoolCurrentFeaturedCycle.offRatePity > 0 && (
                                  <span data-off-rate="true" style={{ flexGrow: activePoolCurrentFeaturedCycle.offRatePity }} />
                                )}
                                <span data-off-rate="false" style={{ flexGrow: activePoolCurrentFeaturedCycle.currentPity }} />
                              </div>
                            ) : (
                              <div
                                className="record-pity-progress-fill h-full rounded"
                                style={{ width: `${Math.min((activePoolCurrentPity / 80) * 100, 100)}%`, backgroundColor: getBarColor(activePoolCurrentPity) }}
                              />
                            )}
                          </div>
                          <span
                            className={`${activePoolCurrentFeaturedCycle ? 'w-10 text-[#d8bd84]' : 'w-8'} shrink-0 text-right text-xs font-semibold tabular-nums`}
                            style={activePoolCurrentFeaturedCycle ? undefined : { color: getBarColor(activePoolCurrentPity) }}
                          >
                            {activePoolCurrentFeaturedCycle?.isLowerBound ? '≥' : ''}{activePoolCurrentFeaturedCycle?.totalPity ?? activePoolCurrentPity}
                          </span>
                          {activePoolCurrentFeaturedCycle
                            ? <span className="w-8 shrink-0 text-center text-[10px] text-wave">共计</span>
                            : <span className="w-7 shrink-0" aria-hidden="true" />}
                        </div>
                      </div>
                    )}
                    {showingFeaturedAcquisitions ? featuredPagedList.pageItems.map((item, index) => {
                      if (item.kind === 'record') {
                        const { record, pity, isLowerBound } = item.item;
                        const barColor = getBarColor(pity);
                        const barWidth = Math.min((pity / 80) * 100, 100);
                        return (
                          <div key={getRecordKey(record, index)} data-record-id={record.id} data-seq={String(index + 1).padStart(2, '0')} onClick={() => openAcquisition(record)} role={record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate ? 'button' : undefined} tabIndex={record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate ? 0 : undefined} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate) openAcquisition(record); }} className={`record-list-row flex min-h-[64px] items-center gap-3 py-2.5 ${record.is_off_rate ? 'record-row-off-rate' : ''} ${record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate ? 'cursor-pointer' : ''} ${record.id === highlightedRecordId ? 'record-target-highlight' : ''}`}>
                            <RecordAvatar record={record} />
                            <div className="w-24 shrink-0 min-w-0">
                              <div className="truncate text-sm text-tide" title={record.name}>{record.name}</div>
                              <div className="mt-0.5 text-[10px] tabular-nums text-wave">{record.time.slice(0, 10)}</div>
                            </div>
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <div className="relative h-5 min-w-[72px] flex-1 overflow-hidden rounded bg-white/[0.06]">
                                <div className="record-pity-progress-fill h-full rounded" style={{ width: `${barWidth}%`, backgroundColor: barColor }} />
                              </div>
                              <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums" style={{ color: barColor }}>
                                {isLowerBound ? '≥' : ''}{pity}
                              </span>
                              <OffRateStamp active={record.is_off_rate} />
                            </div>
                          </div>
                        );
                      }
                      const { row } = item;
                      const offRateCount = row.segments.filter((segment) => segment.is_off_rate).length;
                      return (
                        <div
                          key={`featured-${row.target.id ?? row.target.time}-${row.acquisitionIndex}`}
                          data-record-id={row.target.id}
                          data-seq={String(index + 1).padStart(2, '0')}
                          onClick={() => openAcquisition(row.target)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') openAcquisition(row.target); }}
                          className={`record-list-row record-featured-row flex min-h-[72px] cursor-pointer items-center gap-3 py-2.5 ${row.target.id === highlightedRecordId ? 'record-target-highlight' : ''}`}
                        >
                          <RecordAvatar record={row.target} />
                          <div className="w-28 min-w-0 shrink-0">
                            <div className="flex items-center gap-1.5">
                              <div className="truncate text-sm text-tide" title={row.target.name}>{row.target.name}</div>
                              {offRateCount > 0 ? <span className="shrink-0 rounded border border-[#d84848]/25 bg-[#d84848]/[0.08] px-1 py-0.5 text-[9px] text-[#d99a9a]">含 {offRateCount} 歪</span> : null}
                            </div>
                            <div className="mt-0.5 text-[10px] tabular-nums text-wave">{row.target.time.slice(0, 10)}</div>
                          </div>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <div className="relative h-5 min-w-[72px] flex-1 overflow-hidden rounded bg-white/[0.06]" aria-label={`${row.totalPulls}/160 抽`}>
                              <div className="record-featured-progress-fill flex h-full overflow-hidden rounded" style={{ width: `${Math.min((row.totalPulls / 160) * 100, 100)}%` }}>
                                {row.segments.map((segment, segmentIndex) => (
                                  <span key={`${segment.id ?? segment.time}-${segmentIndex}`} data-off-rate={segment.is_off_rate ? 'true' : 'false'} style={{ flexGrow: segment.pity }} />
                                ))}
                              </div>
                            </div>
                            <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-[#d8bd84]">{row.isLowerBound ? '≥' : ''}{row.totalPulls}</span>
                            <span className="w-8 shrink-0 text-center text-[10px] text-wave">共计</span>
                          </div>
                        </div>
                      );
                    }) : pagedList.pageItems.map(({ record, pity, isLowerBound }, index) => {
                      const barColor = getBarColor(pity);
                      const barWidth = Math.min((pity / 80) * 100, 100);
                      return (
                        <div key={getRecordKey(record, index)} data-record-id={record.id} data-seq={String(index + 1).padStart(2, '0')} onClick={() => openAcquisition(record)} role={record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate ? 'button' : undefined} tabIndex={record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate ? 0 : undefined} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate) openAcquisition(record); }} className={`record-list-row flex min-h-[64px] items-center gap-3 py-2.5 ${record.is_off_rate ? 'record-row-off-rate' : ''} ${record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate ? 'cursor-pointer' : ''} ${record.id === highlightedRecordId ? 'record-target-highlight' : ''}`}>
                          <RecordAvatar record={record} />
                          <div className="w-24 shrink-0 min-w-0">
                            <div className="truncate text-sm text-tide" title={record.name}>{record.name}</div>
                            <div className="mt-0.5 text-[10px] tabular-nums text-wave">{record.time.slice(0, 10)}</div>
                          </div>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <div className="relative h-5 min-w-[72px] flex-1 overflow-hidden rounded bg-white/[0.06]">
                              <div
                                className="record-pity-progress-fill h-full rounded"
                                style={{ width: `${barWidth}%`, backgroundColor: barColor }}
                              />
                            </div>
                            <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums" style={{ color: barColor }}>
                              {isLowerBound ? '≥' : ''}{pity}
                            </span>
                            <OffRateStamp active={record.is_off_rate} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {viewMode === 'grid' && (
                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.div key={gridStyle} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} className="grid gap-2.5 p-3" style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}>
                    {showCurrentPity && (
                      <div data-seq="00" className={`record-grid-card resonance-panel record-grid-card-five record-pity-pull-card min-w-0 ${gridStyle === 'avatar' ? 'p-2.5' : ''} ${sortOrder === 'asc' ? 'order-last' : ''}`} style={{ opacity: 0.85 }}>
                        <div className={`relative overflow-hidden ${gridStyle === 'portrait' ? 'aspect-[3/4]' : 'aspect-square rounded-md'}`}>
                          <PityPullAvatar size="lg" />
                        </div>
                        {gridStyle === 'avatar' ? (
                          <>
                            <div className="mt-2 truncate text-center text-xs text-tide" title="垫抽中">垫抽中</div>
                            <div className="mt-1 flex h-6 items-center justify-center text-[10px] text-wave"><PityBadge pity={activePoolCurrentPity} /></div>
                          </>
                        ) : <div className="record-grid-caption flex h-8 items-center gap-2 px-2.5"><span className="min-w-0 flex-1 truncate text-xs text-tide" title="垫抽中">垫抽中</span><span className="shrink-0 text-[13px] font-medium tabular-nums" style={{ color: getBarColor(activePoolCurrentPity) }}>{activePoolCurrentPity} 抽</span></div>}
                      </div>
                    )}
                    {pagedList.pageItems.map(({ record, pity, isLowerBound }, index) => {
                      return (
                        <div key={getRecordKey(record, index)} data-record-id={record.id} data-seq={String(index + 1).padStart(2, '0')} onClick={() => openAcquisition(record)} role={record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate ? 'button' : undefined} tabIndex={record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate ? 0 : undefined} className={`record-grid-card resonance-panel min-w-0 ${gridStyle === 'avatar' ? 'p-2.5' : ''} ${record.quality_level === QUALITY.FIVE_STAR ? 'record-grid-card-five' : ''} ${record.is_off_rate ? 'record-grid-card-off-rate' : ''} ${record.quality_level === QUALITY.FIVE_STAR && !record.is_off_rate ? 'cursor-pointer' : ''} ${record.id === highlightedRecordId ? 'record-target-highlight' : ''}`}>
                          <div className={`record-grid-media relative overflow-hidden ${gridStyle === 'portrait' ? 'aspect-[3/4]' : 'aspect-square rounded-md'}`}>
                            <RecordAvatar record={record} size="lg" gridStyle={gridStyle} />
                            {gridStyle === 'avatar' && record.is_off_rate && <span className="absolute bottom-1.5 right-1.5"><OffRateStamp active compact /></span>}
                          </div>
                          {gridStyle === 'avatar' ? (
                            <>
                              <div className="mt-2 truncate text-center text-xs text-tide" title={record.name}>{record.name}</div>
                              <div className="mt-1 flex h-6 items-center justify-center text-[10px] text-wave"><PityBadge pity={pity} lowerBound={isLowerBound} /></div>
                            </>
                          ) : (
                            <div className="record-grid-caption flex h-8 items-center gap-2 px-2.5"><span className="min-w-0 flex-1 truncate text-xs text-tide" title={record.name}>{record.name}</span><span className="shrink-0 text-[13px] font-medium tabular-nums" style={{ color: getBarColor(pity) }}>{isLowerBound ? '≥' : ''}{pity} 抽</span></div>
                          )}
                        </div>
                      );
                    })}
                    </motion.div>
                  </AnimatePresence>
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
                          <tr key={getRecordKey(record, index)} data-record-id={record.id} onClick={() => openAcquisition(record)} className={`${isFive ? 'record-table-row-five' : ''} ${record.is_off_rate ? 'record-row-off-rate' : ''} ${isFive && !record.is_off_rate ? 'cursor-pointer' : ''} ${record.id === highlightedRecordId ? 'record-target-highlight' : ''}`}>
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
                <div className="records-scroll-tail" aria-hidden="true" />
              </motion.div>
            )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
            {!activeRecordsLoading && !error && activePagedList.total > 0 && (
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
                    {(activePagedList.safeCurrentPage - 1) * effectiveItemsPerPage + 1}-{Math.min(activePagedList.safeCurrentPage * effectiveItemsPerPage, activePagedList.total)}，共 {activePagedList.total} 条
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setCurrentPage(1)} disabled={activePagedList.safeCurrentPage <= 1} className="flex h-7 w-7 items-center justify-center rounded-md text-wave hover:bg-white/[0.05] hover:text-tide disabled:cursor-not-allowed disabled:opacity-30" aria-label="第一页" title="第一页"><ChevronsLeft size={14} /></button>
                    <button onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={activePagedList.safeCurrentPage <= 1} className="flex h-7 w-7 items-center justify-center rounded-md text-wave hover:bg-white/[0.05] hover:text-tide disabled:cursor-not-allowed disabled:opacity-30" aria-label="上一页"><ResonanceIcon kind="previous" size={14} /></button>
                    <label className="flex items-center gap-1 tabular-nums" title="输入页码后按回车跳转">
                      <input
                        value={pageInput}
                        onChange={(event) => setPageInput(event.target.value.replace(/\D/g, '').slice(0, 6))}
                        onBlur={commitPageInput}
                        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                        inputMode="numeric"
                        aria-label="跳转页码"
                        className="glass-input h-7 w-10 px-1 text-center text-xs text-tide"
                      />
                      <span>/ {activePagedList.totalPages}</span>
                    </label>
                    <button onClick={() => setCurrentPage((page) => Math.min(activePagedList.totalPages, page + 1))} disabled={activePagedList.safeCurrentPage >= activePagedList.totalPages} className="flex h-7 w-7 items-center justify-center rounded-md text-wave hover:bg-white/[0.05] hover:text-tide disabled:cursor-not-allowed disabled:opacity-30" aria-label="下一页"><ResonanceIcon kind="next" size={14} /></button>
                    <button onClick={() => setCurrentPage(activePagedList.totalPages)} disabled={activePagedList.safeCurrentPage >= activePagedList.totalPages} className="flex h-7 w-7 items-center justify-center rounded-md text-wave hover:bg-white/[0.05] hover:text-tide disabled:cursor-not-allowed disabled:opacity-30" aria-label="最后一页" title="最后一页"><ChevronsRight size={14} /></button>
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
        open={missingPlayerDialogOpen}
        onClose={() => setMissingPlayerDialogOpen(false)}
        className="max-w-[440px]"
        labelledBy="missing-player-dialog-title"
      >
        <div className="flex items-start gap-3 p-5">
          <div className="mt-0.5 shrink-0 rounded-md bg-[#d8bd84]/10 p-2 text-[#d8bd84]"><ResonanceIcon kind="info" size={19} /></div>
          <div className="min-w-0">
            <h2 id="missing-player-dialog-title" className="text-base font-medium text-tide">暂时无法插入五星</h2>
            <p className="mt-1.5 text-xs leading-5 text-wave">
              单条插入需要当前玩家 UID，用于读取该玩家、该卡池已有记录并计算补足抽数。当前还没有可用的玩家 UID。
            </p>
            <p className="mt-2 text-xs leading-5 text-wave">
              你可以前往批量手动导入，直接输入 UID 后添加五星记录，无需先完成游戏同步或其它初始化。
            </p>
          </div>
          <ResonanceCloseButton onClick={() => setMissingPlayerDialogOpen(false)} className="ml-auto shrink-0" />
        </div>
        <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
          <button onClick={() => setMissingPlayerDialogOpen(false)} className="h-9 px-4 text-sm text-wave hover:text-tide">取消</button>
          <button
            onClick={() => {
              setMissingPlayerDialogOpen(false);
              void navigate('/ocr-import?mode=manual');
            }}
            className="tide-btn flex h-9 items-center gap-2 px-4 text-sm"
          >
            <ResonanceIcon kind="batch-edit" size={14} />
            前往批量手动导入
          </button>
        </div>
      </Modal>

      <Modal
        open={selectedAcquisition !== null}
        onClose={() => setSelectedAcquisition(null)}
        className="max-w-4xl border-white/[0.10] bg-[#242424]"
        labelledBy="acquisition-trace-title"
      >
        {selectedAcquisition && (
          <div className="acquisition-trace-modal">
            <div className="flex items-start gap-3 border-b border-white/[0.07] p-5">
              <div className="record-acquisition-media relative h-24 w-20 shrink-0 overflow-hidden">
                <ResourceIcon resourceId={selectedAcquisition.resource_id} alt={selectedAcquisition.name} preferPortrait={selectedAcquisition.resource_type === 'role'} className={`h-full w-full ${selectedAcquisition.resource_type === 'role' ? 'object-cover object-top' : 'object-contain p-3'}`} fallback={<RecordAvatar record={{ resource_id: selectedAcquisition.resource_id, resource_type: selectedAcquisition.resource_type, name: selectedAcquisition.name, quality_level: 5, is_off_rate: false } as GachaRecord} size="lg" />} />
              </div>
              <div className="min-w-0">
                <span className="records-meta-label">ACQUISITION TRACE</span>
                <h2 id="acquisition-trace-title" className="mt-1 text-lg font-semibold text-tide">{selectedAcquisition.name}</h2>
                <p className="mt-1 text-xs text-wave">{selectedAcquisition.pool_name} · {selectedAcquisition.target_count} 次获取</p>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => stepAcquisition(-1)} disabled={selectedAcquisitionIndex <= 0} className="flex h-8 w-8 items-center justify-center rounded-md text-wave hover:bg-white/[0.05] hover:text-tide disabled:opacity-25" title="上一条获取记录" aria-label="上一条获取记录"><ResonanceIcon kind="previous" size={14} /></button>
                <span className="min-w-12 text-center text-[10px] tabular-nums text-wave">{selectedAcquisitionIndex >= 0 ? selectedAcquisitionIndex + 1 : 1}/{acquisitionRecords.length}</span>
                <button type="button" onClick={() => stepAcquisition(1)} disabled={selectedAcquisitionIndex >= acquisitionRecords.length - 1} className="flex h-8 w-8 items-center justify-center rounded-md text-wave hover:bg-white/[0.05] hover:text-tide disabled:opacity-25" title="下一条获取记录" aria-label="下一条获取记录"><ResonanceIcon kind="next" size={14} /></button>
                <ResonanceCloseButton onClick={() => setSelectedAcquisition(null)} className="ml-1 shrink-0" />
              </div>

              {pityRange ? (
                <button type="button" onClick={() => setPityRange(null)} className="flex h-8 items-center gap-1.5 rounded-md border border-[#d8bd84]/20 bg-[#d8bd84]/[0.06] px-2.5 text-xs text-[#d8bd84]" title="清除抽数区间筛选">
                  {pityRange.min}-{pityRange.max} 抽 <ResonanceIcon kind="close" size={12} />
                </button>
              ) : null}
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
                {acquisitionRecords.map((item, index) => (
                  <button
                    type="button"
                    key={`${item.id ?? item.time}-${index}`}
                    onClick={() => locateAcquisitionRecord(item.id)}
                    className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${item.id === selectedAcquisitionRecordId ? 'acquisition-record-focused' : item.is_off_rate ? 'border-[#d84848]/25 bg-[#d84848]/[0.04] hover:bg-[#d84848]/[0.08]' : 'border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.05]'}`}
                    title="在记录页中定位"
                  >
                    <ResourceIcon resourceId={item.resource_id} alt="" className="h-9 w-9 shrink-0 rounded" fallback={<span className="flex h-9 w-9 items-center justify-center rounded bg-white/[0.06] text-xs text-wave">{item.name.charAt(0)}</span>} />
                    <div className="min-w-0 w-24 shrink-0"><div className="truncate text-xs text-tide">{item.name}</div><div className="mt-0.5 text-[10px] text-wave">{item.is_off_rate ? `第 ${String(item.acquisition_index).padStart(2, '0')} 次 · 前置歪` : `第 ${String(item.acquisition_index).padStart(2, '0')} 次获取`}</div></div>
                    <div className="relative h-4 min-w-0 flex-1 overflow-hidden rounded bg-white/[0.06]"><div className="record-pity-progress-fill h-full rounded" style={{ width: `${Math.min(item.pity / (selectedAcquisition.pool_type === '5' ? 50 : 80) * 100, 100)}%`, backgroundColor: getBarColor(item.pity) }} /></div>
                    <PityBadge pity={item.pity} lowerBound={item.is_lower_bound} />
                    <span className="hidden w-20 shrink-0 text-right text-[10px] tabular-nums text-wave sm:block">{item.time.slice(0, 10)}</span>
                  </button>
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
