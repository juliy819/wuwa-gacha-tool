import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useGachaStore } from '../store/useGachaStore';
import PageTransition from '../components/PageTransition';
import Tooltip from '../components/Tooltip';
import { QUALITY, QUALITY_COLORS, POOL_TYPES, GachaRecord } from '../types';
import { Search, ChevronLeft, ChevronRight, LayoutGrid, AlignJustify, Rows3 } from 'lucide-react';

type ViewMode = 'bar' | 'grid' | 'table';

type RecordWithPity = { record: GachaRecord; pity: number };

export default function RecordsPage() {
  const { records, activePlayerId, fetchRecords } = useGachaStore();
  const [activePoolType, setActivePoolType] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [viewMode, setViewMode] = useState<ViewMode>('bar');

  useEffect(() => { fetchRecords(); }, [activePlayerId]);

  // 按卡池类型筛选
  const typeFiltered = useMemo(() => {
    if (activePoolType === 'all') return records;
    return records.filter((r) => r.card_pool_type === activePoolType);
  }, [records, activePoolType]);

  // 所有记录 attach pity
  // 关键：十连同时间戳的 10 条记录之间有严格顺序（DB 的原始插入顺序），
  // 必须用「时间升序 + 原始数组位置升序」稳定排序，否则 pity 累加错位。
  const allRecordsWithPity = useMemo<RecordWithPity[]>(() => {
    // 1) attach 原始索引作为第二排序键，保证同时间戳下顺序稳定
    //    同时假定 records / typeFiltered 的原始顺序就是「最新在前」（DB 返回序），
    //    所以原索引越小越新，越大越旧。
    const indexed = typeFiltered.map((r, origIdx) => ({ r, origIdx }));

    // 2) 排序：按时间升序（旧→新）；时间相同则按 origIdx 降序（因为 origIdx 小=更新）
    //    这样得到「最旧的第一条 → 最新的最后一条」的真实抽卡先后。
    indexed.sort((A, B) => {
      const c = A.r.time.localeCompare(B.r.time);
      if (c !== 0) return c;
      return B.origIdx - A.origIdx; // 大的 origIdx = 越旧 = 排前面
    });

    // 3) 按池独立累加 pity，一次 pass 全部记录。
    const pityByPool: Record<string, number> = {};
    const out: RecordWithPity[] = new Array(indexed.length);
    for (let i = 0; i < indexed.length; i++) {
      const { r } = indexed[i];
      const p = pityByPool[r.card_pool_type] ?? 0;
      const pity = p + 1;
      pityByPool[r.card_pool_type] = r.quality_level === QUALITY.FIVE_STAR ? 0 : pity;
      // 先按旧→新顺序存，稍后再反转为新→旧
      out[i] = { record: r, pity };
    }

    // 4) 最终输出：新 → 旧（最新抽的排最上面）
    out.reverse();
    return out;
  }, [typeFiltered]);

  // 只保留五星（用于条状 / 宫格）
  const fiveStarWithPity = useMemo(() => {
    return allRecordsWithPity.filter((x) => x.record.quality_level === QUALITY.FIVE_STAR);
  }, [allRecordsWithPity]);

  const fiveStarRecords = useMemo(
    () => fiveStarWithPity.map((x) => x.record),
    [fiveStarWithPity]
  );

  // 分页：条状 / 宫格使用 fiveStarWithPity；表格使用 allRecordsWithPity
  const pagedList = useMemo(() => {
    const list = viewMode === 'table' ? allRecordsWithPity : fiveStarWithPity;
    const totalPages = Math.max(1, Math.ceil(list.length / itemsPerPage));
    const safeCurrentPage = Math.min(currentPage, totalPages);
    const start = (safeCurrentPage - 1) * itemsPerPage;
    return {
      list,
      total: list.length,
      totalPages,
      safeCurrentPage,
      pageItems: list.slice(start, start + itemsPerPage),
    };
  }, [viewMode, allRecordsWithPity, fiveStarWithPity, currentPage, itemsPerPage]);

  useEffect(() => { setCurrentPage(1); }, [activePoolType, itemsPerPage, viewMode]);

  // 统计每个卡池类型的数据
  const poolStats = useMemo(() => {
    const map: Record<string, { name: string; count: number; fiveStar: number; fourStar: number; currentPity: number }> = {};
    for (const pool of POOL_TYPES) {
      map[pool.type] = { name: pool.name, count: 0, fiveStar: 0, fourStar: 0, currentPity: 0 };
    }
    for (const r of records) {
      if (map[r.card_pool_type]) {
        map[r.card_pool_type].count++;
        if (r.quality_level === QUALITY.FIVE_STAR) map[r.card_pool_type].fiveStar++;
        if (r.quality_level === QUALITY.FOUR_STAR) map[r.card_pool_type].fourStar++;
      }
    }
    // 当前保底
    for (const typeId of Object.keys(map)) {
      const poolIndexed = records
        .filter(r => r.card_pool_type === typeId)
        .map((r, i) => ({ r, i }));
      // 时间升序（旧→新），同时间按 i 降序（i 小=更靠近 records 顶部=更晚插入=更新的记录）
      poolIndexed.sort((A, B) => {
        const c = A.r.time.localeCompare(B.r.time);
        return c !== 0 ? c : B.i - A.i;
      });
      let pity = 0;
      for (const { r } of poolIndexed) {
        pity++;
        if (r.quality_level === QUALITY.FIVE_STAR) pity = 0;
      }
      map[typeId].currentPity = pity;
    }
    return map;
  }, [records]);

  const visiblePoolTypes = useMemo(() => {
    const types = new Set<string>();
    for (const r of records) types.add(r.card_pool_type);
    return Array.from(types).sort((a, b) => {
      const idxA = POOL_TYPES.findIndex(p => p.type === a);
      const idxB = POOL_TYPES.findIndex(p => p.type === b);
      return idxA - idxB;
    });
  }, [records]);

  const getImgSrc = (resourceId: number) => `/header/${resourceId}.png`;

  // 进度条颜色：低=绿，中=橙，高=红
  const getBarColor = (pity: number) => {
    if (pity <= 30) return '#7ec8a0';       // 绿
    if (pity <= 60) return '#e8c87a';       // 橙
    return '#e88a7a';                        // 红
  };

  // 侧边栏统计始终基于全量 records，不受卡池筛选影响
  const totalDraws = records.length;
  const totalFiveStar = records.filter(r => r.quality_level === QUALITY.FIVE_STAR).length;
  const offRateCount = records.filter(r => r.quality_level === QUALITY.FIVE_STAR && r.is_off_rate).length;

  return (
    <PageTransition>
      <div className="h-full flex flex-col">
        {/* 顶部信息栏 */}
        <div className="px-6 pt-4 pb-3 border-b border-[rgba(255,255,255,0.04)]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-tide">唤取记录</h1>
              <p className="text-xs text-wave mt-0.5">
                {viewMode === 'table' ? '展示全部抽卡明细' : '仅展示五星出金记录'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[rgba(212,212,212,0.04)] border border-[rgba(255,255,255,0.04)]">
                <button
                  onClick={() => setViewMode('bar')}
                  className={`p-1.5 rounded-md transition-colors ${viewMode === 'bar' ? 'bg-[rgba(212,212,212,0.12)] text-tide' : 'text-wave hover:text-tide-dim'}`}
                  title="条状视图"
                >
                  <AlignJustify size={14} />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-[rgba(212,212,212,0.12)] text-tide' : 'text-wave hover:text-tide-dim'}`}
                  title="宫格视图"
                >
                  <LayoutGrid size={14} />
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-[rgba(212,212,212,0.12)] text-tide' : 'text-wave hover:text-tide-dim'}`}
                  title="表格视图（全量数据）"
                >
                  <Rows3 size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* 侧边栏 */}
          <aside className="w-[220px] border-r border-[rgba(255,255,255,0.04)] overflow-hidden flex-shrink-0 min-h-0">
            <div className="p-4 space-y-3 overflow-y-auto h-full min-h-0">
              <div className="glass-card p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-wave">总计唤取</span>
                  <span className="text-lg font-semibold text-tide">{totalDraws.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-4 pt-1 border-t border-[rgba(255,255,255,0.04)]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#e8d4a8]" />
                    <span className="text-xs text-[#e8d4a8]">{totalFiveStar} 五星</span>
                  </div>
                  {offRateCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#e8a8a8]" />
                      <span className="text-xs text-[#e8a8a8]">歪 {offRateCount}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <button
                  onClick={() => setActivePoolType('all')}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    activePoolType === 'all'
                      ? 'bg-[rgba(212,212,212,0.08)] border border-[rgba(212,212,212,0.15)]'
                      : 'hover:bg-[rgba(212,212,212,0.04)] border border-transparent'
                  }`}
                >
                  <div className="text-sm text-tide font-medium">全部卡池</div>
                  <div className="text-xs text-wave mt-0.5">{totalFiveStar} 个五星</div>
                </button>

                {visiblePoolTypes.map((typeId) => {
                  const stats = poolStats[typeId];
                  if (!stats || stats.count === 0) return null;
                  const isActive = activePoolType === typeId;
                  return (
                    <button
                      key={typeId}
                      onClick={() => setActivePoolType(typeId)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        isActive
                          ? 'bg-[rgba(212,212,212,0.08)] border border-[rgba(212,212,212,0.15)]'
                          : 'hover:bg-[rgba(212,212,212,0.04)] border border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-tide font-medium truncate">{stats.name}</span>
                        <span className="text-xs text-[#e8d4a8] flex-shrink-0 ml-2">{stats.currentPity}/80</span>
                      </div>
                      <div className="text-xs text-wave mt-0.5">
                        {stats.fiveStar} 五星 · {stats.count} 抽
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* 主内容区 */}
          <main className="flex-1 flex flex-col overflow-hidden min-h-0">
            {pagedList.total === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <div className="w-14 h-14 rounded-full bg-[rgba(212,212,212,0.06)] flex items-center justify-center">
                  <Search size={24} className="text-wave" />
                </div>
                <h3 className="text-base font-medium text-tide">
                  {records.length === 0 ? '暂无抽卡记录' : viewMode === 'table' ? '暂无抽卡记录' : '暂无五星记录'}
                </h3>
                <p className="text-sm text-wave mt-1">{records.length === 0 ? '请先扫描游戏目录' : '该卡池还未出过五星'}</p>
              </div>
            ) : viewMode === 'bar' ? (
              /* 条状视图：左图标 + 右进度条 */
              <>
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 pb-20 space-y-2 min-h-0">
                  {pagedList.pageItems.map(({ record, pity }, idx) => {
                    const color = QUALITY_COLORS[QUALITY.FIVE_STAR];
                    const barColor = getBarColor(pity);
                    const barWidth = Math.min((pity / 80) * 100, 100);

                    const tipContent = (
                      <>
                        <div className="text-tide font-medium text-sm">{record.name}</div>
                        <div className="text-wave mt-0.5">{record.resource_type === 'role' ? '角色' : '武器'} · {record.card_pool_name}</div>
                        <div className="mt-0.5" style={{ color: barColor }}>保底 {pity} 抽</div>
                        <div className="text-wave mt-0.5">{record.time}</div>
                        {record.is_off_rate && <div className="text-[#e8a8a8] mt-0.5">歪了（常驻角色）</div>}
                      </>
                    );

                    return (
                      <Tooltip
                        key={`${record.resource_id}-${record.time}-${idx}`}
                        className="flex items-center gap-3"
                        content={tipContent}
                      >
                        <motion.div
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: Math.min(idx * 0.01, 0.2), duration: 0.2 }}
                          className="flex items-center gap-3 w-full"
                        >
                          {/* 左侧：图标 */}
                          <div
                            className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0"
                            style={{
                              border: `1.5px solid ${record.is_off_rate ? '#d84848' : color}`,
                              boxShadow: record.is_off_rate ? `0 0 8px #d8484830` : `0 0 8px ${color}30`,
                              background: `linear-gradient(135deg, ${color}15, ${color}05)`,
                            }}
                          >
                            <img
                              src={getImgSrc(record.resource_id)}
                              alt={record.name}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={(e) => {
                                const el = e.currentTarget;
                                const fallback = el.nextElementSibling as HTMLElement | null;
                                el.style.display = 'none';
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                            <div
                              className="absolute inset-0 items-center justify-center text-sm font-medium"
                              style={{ color, display: 'none' }}
                            >
                              {record.name.charAt(0)}
                            </div>
                          </div>

                          {/* 中间：名称 */}
                          <div className="w-20 flex-shrink-0">
                            <div className="text-sm text-tide truncate">{record.name}</div>
                            <div className="text-[10px] text-wave">{record.time.slice(0, 10)}</div>
                          </div>

                          {/* 右侧：进度条 + 抽数 + 歪（歪固定占位，保证条长一致） */}
                          <div className="flex-1 flex items-center gap-2">
                            <div className="flex-1 h-5 bg-[rgba(212,212,212,0.06)] rounded overflow-hidden relative">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${barWidth}%` }}
                                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: Math.min(idx * 0.01, 0.2) }}
                                className="h-full rounded"
                                style={{ background: barColor }}
                              />
                            </div>
                            <span className="text-xs font-semibold flex-shrink-0 w-8 text-right" style={{ color: barColor }}>
                              {pity}
                            </span>
                            <span
                              className={`text-[10px] flex-shrink-0 w-5 text-center font-bold ${record.is_off_rate ? 'text-[#d84848]' : 'text-transparent'}`}
                            >
                              歪
                            </span>
                          </div>
                        </motion.div>
                      </Tooltip>
                    );
                  })}
                </div>
              </>
            ) : viewMode === 'grid' ? (
              /* 宫格视图：只显示五星，角标显示抽数 */
              <div className="flex-1 overflow-auto overflow-x-hidden p-4 pb-20 min-h-0">
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))' }}>
                  {pagedList.pageItems.map(({ record, pity }, idx) => {
                    const color = QUALITY_COLORS[QUALITY.FIVE_STAR];
                    const badgeColor = getBarColor(pity);
                    const isOff = record.is_off_rate;

                    const tipContent = (
                      <>
                        <div className="text-tide font-medium text-sm">{record.name}</div>
                        <div className="text-wave mt-0.5">{record.resource_type === 'role' ? '角色' : '武器'} · {record.card_pool_name}</div>
                        <div className="mt-0.5" style={{ color: badgeColor }}>保底 {pity} 抽</div>
                        <div className="text-wave mt-0.5">{record.time}</div>
                        {isOff && <div className="text-[#e8a8a8] mt-0.5">歪了（常驻角色）</div>}
                      </>
                    );

                    return (
                      <Tooltip
                        key={`${record.resource_id}-${record.time}-${idx}`}
                        className="relative"
                        content={tipContent}
                      >
                        <motion.div
                          initial={{ opacity: 0, scale: 0.85 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: Math.min(idx * 0.01, 0.3), duration: 0.2 }}
                          className="relative"
                        >
                          <div
                            className="aspect-square rounded-lg overflow-hidden relative"
                            style={{
                              border: `1.5px solid ${isOff ? '#d84848' : color}`,
                              boxShadow: isOff ? `0 0 10px #d8484825` : `0 0 10px ${color}25`,
                              background: `linear-gradient(135deg, ${color}15, ${color}05)`,
                            }}
                          >
                            <img
                              src={getImgSrc(record.resource_id)}
                              alt={record.name}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={(e) => {
                                const el = e.currentTarget;
                                const fallback = el.nextElementSibling as HTMLElement | null;
                                el.style.display = 'none';
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                            <div
                              className="absolute inset-0 items-center justify-center text-base font-medium"
                              style={{ color, display: 'none' }}
                            >
                              {record.name.charAt(0)}
                            </div>

                            {/* 歪：底部红色条带 */}
                            {isOff && (
                              <div className="absolute bottom-0 left-0 right-0 h-4 bg-[#d84848] flex items-center justify-center text-white text-[9px] font-bold">
                                歪
                              </div>
                            )}
                          </div>

                          {/* 抽数角标 */}
                          <div
                            className="absolute -top-2 -left-2 min-w-[26px] h-[26px] px-1.5 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-lg z-10"
                            style={{ background: badgeColor }}
                          >
                            {pity}
                          </div>

                          <div className="text-xs text-tide text-center mt-1 truncate">{record.name}</div>
                        </motion.div>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* 表格视图：显示全量抽卡数据 */
              <div className="flex-1 overflow-auto overflow-x-hidden min-h-0">
                <table className="w-full text-xs table-fixed">
                  <thead className="sticky top-0 z-10">
                    <tr className="text-wave border-b border-[rgba(255,255,255,0.04)] bg-[#1f1f1f] align-middle">
                      <th className="text-left font-medium py-2.5 px-3" style={{ width: 56 }}>#</th>
                      <th className="text-left font-medium py-2.5 px-3" style={{ width: 152 }}>时间</th>
                      <th className="text-left font-medium py-2.5 px-3" style={{ width: 136 }}>卡池</th>
                      <th className="text-left font-medium py-2.5 px-3" style={{ width: 48 }}></th>
                      <th className="text-left font-medium py-2.5 px-3">物品</th>
                      <th className="text-left font-medium py-2.5 px-3" style={{ width: 60 }}>类型</th>
                      <th className="text-center font-medium py-2.5 px-3" style={{ width: 64 }}>品质</th>
                      <th className="text-center font-medium py-2.5 px-3" style={{ width: 80 }}>池内保底</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedList.pageItems.map(({ record, pity }, i) => {
                      const color = QUALITY_COLORS[record.quality_level as keyof typeof QUALITY_COLORS] ?? '#888';
                      const isFive = record.quality_level === QUALITY.FIVE_STAR;
                      const isFour = record.quality_level === QUALITY.FOUR_STAR;
                      const badgeColor = getBarColor(pity);

                      // 倒序编号：最新的第 1 条 = 总抽数，最旧的最后 1 条 = 1
                      const globalIdx = pagedList.total - (pagedList.safeCurrentPage - 1) * itemsPerPage - i;

                      return (
                        <tr
                          key={`${record.resource_id}-${record.time}-${i}`}
                          className="border-b border-[rgba(255,255,255,0.02)] hover:bg-[rgba(212,212,212,0.03)] transition-colors align-middle"
                          style={isFive ? { background: 'rgba(232, 212, 168, 0.035)' } : undefined}
                        >
                          <td className="py-2 px-3 text-wave font-mono align-middle whitespace-nowrap">{globalIdx}</td>
                          <td className="py-2 px-3 text-wave font-mono align-middle whitespace-nowrap">{record.time}</td>
                          <td className="py-2 px-3 text-wave align-middle">
                            <div className="truncate" title={record.card_pool_name}>{record.card_pool_name}</div>
                          </td>
                          <td className="py-2 px-3 align-middle">
                            <div
                              className="relative w-8 h-8 rounded overflow-hidden flex-shrink-0"
                              style={{
                                border: `1.5px solid ${color}`,
                                boxShadow: isFive ? `0 0 6px ${color}30` : undefined,
                                background: `linear-gradient(135deg, ${color}15, ${color}05)`,
                              }}
                            >
                              <img
                                src={getImgSrc(record.resource_id)}
                                alt=""
                                className="w-full h-full object-cover"
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                                  if (fb) fb.style.display = 'flex';
                                }}
                              />
                              <div
                                className="absolute inset-0 hidden items-center justify-center text-[10px] font-semibold"
                                style={{ color }}
                              >
                                {record.name.charAt(0)}
                              </div>
                            </div>
                          </td>
                          <td className="py-2 px-3 font-medium align-middle" style={{ color: isFive ? color : isFour ? color : 'rgba(212,212,212,0.85)' }}>
                            <div className="truncate">
                              {record.is_off_rate && <span className="text-[#d84848] mr-1 font-bold">歪</span>}
                              {record.name}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-wave align-middle whitespace-nowrap">
                            {record.resource_type === 'role' ? '角色' : '武器'}
                          </td>
                          <td className="py-2 px-3 text-center align-middle">
                            <span
                              className="inline-flex items-center justify-center whitespace-nowrap px-2 py-0.5 rounded text-[11px] font-bold leading-tight"
                              style={{ background: `${color}22`, color }}
                            >
                              {record.quality_level === QUALITY.FIVE_STAR ? '五星' : record.quality_level === QUALITY.FOUR_STAR ? '四星' : '三星'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-center align-middle font-semibold whitespace-nowrap" style={{ color: isFive ? badgeColor : 'rgba(212,212,212,0.5)' }}>
                            {isFive ? pity : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 分页 */}
            {pagedList.total > 0 && (
              <div className="px-6 py-3 border-t border-[rgba(255,255,255,0.04)] flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 text-xs text-wave">
                  <span>每页</span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => setItemsPerPage(Number(e.target.value))}
                    className="glass-input px-2 py-1 text-xs rounded"
                  >
                    {[50, 100, 200, 500].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-wave">
                    {(pagedList.safeCurrentPage - 1) * itemsPerPage + 1}-{Math.min(pagedList.safeCurrentPage * itemsPerPage, pagedList.total)}
                    {' '}of{' '}{pagedList.total}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={pagedList.safeCurrentPage <= 1}
                      className="p-1.5 rounded-md hover:bg-[rgba(212,212,212,0.08)] disabled:opacity-30 disabled:cursor-not-allowed text-wave transition-colors"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-xs text-tide font-medium px-1">
                      {pagedList.safeCurrentPage}/{pagedList.totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(pagedList.totalPages, p + 1))}
                      disabled={pagedList.safeCurrentPage >= pagedList.totalPages}
                      className="p-1.5 rounded-md hover:bg-[rgba(212,212,212,0.08)] disabled:opacity-30 disabled:cursor-not-allowed text-wave transition-colors"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </PageTransition>
  );
}
