import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, Check, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { recordsPath } from '../lib/recordNavigation';
import { displayUid } from '../lib/shareMode';
import { useGachaStore } from '../store/useGachaStore';
import { QUALITY } from '../types';
import ResourceIcon from './ResourceIcon';

const SOURCE_LABELS = {
  'game-dir': '游戏目录扫描',
  cloud: '云鸣潮同步',
  url: '抽卡链接同步',
  json: 'JSON 导入',
} as const;

export default function ImportSummaryPanel() {
  const navigate = useNavigate();
  const summary = useGachaStore((state) => state.lastImportSummary);
  const dismiss = useGachaStore((state) => state.dismissImportSummary);
  const newFiveStars = summary?.added_records.filter((record) => record.quality_level === QUALITY.FIVE_STAR) ?? [];

  const locateRecord = (recordId: number | undefined, poolType: string) => {
    if (recordId === undefined) return;
    const target = recordsPath({ recordId, poolType, source: 'sync-summary' });
    dismiss();
    navigate(target.pathname, { state: target.state });
  };

  const locateLatest = () => {
    const record = summary?.added_records[0];
    if (!record) return;
    if (record.id === undefined) return;
    const target = recordsPath({
      recordId: record.id,
      poolType: record.card_pool_type,
      scope: 'all',
      viewMode: 'table',
      source: 'sync-summary',
    });
    dismiss();
    navigate(target.pathname, { state: target.state });
  };

  return (
    <AnimatePresence>
      {summary ? (
        <motion.aside
          initial={{ opacity: 0, x: 24, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 18, scale: 0.985 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="fixed right-5 top-[76px] z-[80] w-[380px] max-w-[calc(100vw-40px)] overflow-hidden rounded-md border border-white/[0.11] bg-[#232423]/[0.98] shadow-[0_20px_70px_rgba(0,0,0,0.48)] backdrop-blur-xl"
          aria-label="同步完成摘要"
        >
          <div className="flex items-start gap-3 border-b border-white/[0.07] px-4 py-3.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#8fc8be]/20 bg-[#8fc8be]/[0.08] text-[#8fc8be]">
              <Check size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-tide">{SOURCE_LABELS[summary.source]}完成</div>
              <div className="mt-0.5 truncate text-[10px] text-wave">UID {displayUid(summary.player_id)} · 当前共 {summary.total_count.toLocaleString()} 条</div>
            </div>
            <button type="button" onClick={dismiss} className="flex h-8 w-8 items-center justify-center rounded-md text-wave hover:bg-white/[0.05] hover:text-tide" title="关闭摘要" aria-label="关闭同步摘要"><X size={15} /></button>
          </div>

          <div className="grid grid-cols-3 gap-px bg-white/[0.06]">
            {[
              ['新增', summary.added_count],
              ['重复', summary.duplicate_count],
              ['新增五星', newFiveStars.length],
            ].map(([label, value]) => (
              <div key={label} className="bg-[#232423] px-3 py-3 text-center">
                <div className="text-[10px] text-wave">{label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-tide">{value}</div>
              </div>
            ))}
          </div>

          {newFiveStars.length > 0 ? (
            <div className="border-b border-white/[0.07] px-4 py-3">
              <div className="mb-2 text-[10px] uppercase text-wave">本次新增五星</div>
              <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                {newFiveStars.map((record, index) => (
                  <button
                    type="button"
                    key={`${record.id ?? record.time}-${index}`}
                    onClick={() => locateRecord(record.id, record.card_pool_type)}
                    className="flex w-full items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.025] px-2.5 py-2 text-left hover:border-[#d8bd84]/25 hover:bg-[#d8bd84]/[0.045]"
                    title="在记录页中定位"
                  >
                    <ResourceIcon resourceId={record.resource_id} alt="" className="h-8 w-8 shrink-0 rounded object-cover" fallback={<span className="flex h-8 w-8 items-center justify-center rounded bg-white/[0.06] text-xs text-wave">{record.name.charAt(0)}</span>} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-tide">{record.name}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-wave">{record.card_pool_name} · {record.time}</span>
                    </span>
                    <ArrowRight size={13} className="shrink-0 text-wave" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {summary.failed_pools.length > 0 ? (
            <div className="flex gap-2 border-b border-[#d09960]/15 bg-[#d09960]/[0.045] px-4 py-3 text-[11px] leading-5 text-[#d2a877]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{summary.failed_pools.length} 个卡池获取失败，已保留原有数据。{summary.failed_pools.slice(0, 2).join('；')}</span>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-[10px] text-wave">
              {summary.added_count === 0 ? '本次记录均已存在，未写入新数据' : `后端已确认写入 ${summary.added_records.length} 条记录`}
            </span>
            {summary.added_records.length > 0 ? (
              <button type="button" onClick={locateLatest} className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[#8fc8be]/20 bg-[#8fc8be]/[0.07] px-3 text-xs text-[#a8d7cf] hover:bg-[#8fc8be]/[0.12]">
                查看最新新增 <ArrowRight size={13} />
              </button>
            ) : null}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
