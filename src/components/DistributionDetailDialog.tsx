import { ArrowRight } from 'lucide-react';
import type { FeaturedCycleInsight, FiveStarIntervalInsight } from '../types';
import Modal from './Modal';
import ResonanceCloseButton from './ResonanceCloseButton';
import ResourceIcon from './ResourceIcon';

interface DistributionDetailDialogProps {
  open: boolean;
  kind: 'five-star' | 'featured';
  poolName: string;
  hardPity: number;
  rangeLabel: string;
  fiveStarRecords: FiveStarIntervalInsight[];
  featuredCycles: FeaturedCycleInsight[];
  onClose: () => void;
  onLocate: (recordId: number | null) => void;
}

export default function DistributionDetailDialog({
  open,
  kind,
  poolName,
  hardPity,
  rangeLabel,
  fiveStarRecords,
  featuredCycles,
  onClose,
  onLocate,
}: DistributionDetailDialogProps) {
  const itemCount = kind === 'featured' ? featuredCycles.length : fiveStarRecords.length;

  return (
    <Modal open={open} onClose={onClose} className="max-w-3xl border-white/[0.1] bg-[#242424]" labelledBy="distribution-detail-title">
      <div className="flex items-start gap-3 border-b border-white/[0.07] px-5 py-4">
        <div className="min-w-0 flex-1">
          <span className="records-meta-label">{kind === 'featured' ? 'FEATURED COST TRACE' : 'FIVE-STAR TRACE'}</span>
          <h2 id="distribution-detail-title" className="mt-1 text-lg font-semibold text-tide">
            {kind === 'featured' ? 'UP 获取成本明细' : '五星出金明细'}
          </h2>
          <p className="mt-1 text-xs text-wave">{poolName} · {rangeLabel} 抽 · {itemCount} 条完整样本</p>
        </div>
        <ResonanceCloseButton onClick={onClose} />
      </div>

      <div className="max-h-[64vh] overflow-y-auto px-5 py-4">
        <div className="space-y-2">
          {kind === 'featured' ? featuredCycles.map((cycle, index) => {
            const offRates = cycle.segments.filter((segment) => segment.is_off_rate);
            return (
              <button
                type="button"
                key={`${cycle.record_id ?? cycle.time}-${index}`}
                onClick={() => onLocate(cycle.record_id)}
                disabled={cycle.record_id === null}
                className="w-full rounded-md border border-white/[0.07] bg-white/[0.025] px-3 py-3 text-left transition-colors hover:border-[#d8bd84]/25 hover:bg-[#d8bd84]/[0.045] disabled:cursor-default"
                title="在记录页中定位该 UP 记录"
              >
                <span className="flex items-center gap-3">
                  <ResourceIcon resourceId={cycle.resource_id} alt="" className="h-10 w-10 shrink-0 rounded object-cover" fallback={<span className="flex h-10 w-10 items-center justify-center rounded bg-white/[0.06] text-xs text-wave">{cycle.name.charAt(0)}</span>} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm text-tide">{cycle.name}</span>
                      {offRates.length > 0 ? <span className="shrink-0 rounded border border-[#d84848]/25 bg-[#d84848]/[0.08] px-1.5 py-0.5 text-[10px] text-[#d99a9a]">含 {offRates.length} 次歪</span> : <span className="shrink-0 rounded border border-[#8fc8be]/20 bg-[#8fc8be]/[0.07] px-1.5 py-0.5 text-[10px] text-[#8fc8be]">直接获得</span>}
                    </span>
                    <span className="mt-1 block text-[10px] tabular-nums text-wave">{cycle.time}</span>
                  </span>
                  <span className="shrink-0 text-right"><strong className="text-lg tabular-nums text-[#d8bd84]">{cycle.total_pulls}</strong><small className="ml-1 text-[10px] text-wave">抽</small></span>
                  <ArrowRight size={14} className="shrink-0 text-wave" />
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/[0.05] pt-2 text-[10px] text-wave">
                  {cycle.segments.map((segment, segmentIndex) => (
                    <span key={`${segment.record_id ?? segment.time}-${segmentIndex}`} className={segment.is_off_rate ? 'text-[#d99a9a]' : 'text-[#a8d7cf]'}>
                      {segmentIndex > 0 ? <span className="mr-1.5 text-white/25">+</span> : null}
                      {segment.is_off_rate ? `歪 ${segment.name}` : `UP ${segment.name}`}（{segment.pulls} 抽）
                    </span>
                  ))}
                  <span className="text-white/25">=</span>
                  <span className="text-tide">共 {cycle.total_pulls} 抽</span>
                </span>
                <span className="analysis-detail-progress mt-2" aria-label={`${cycle.total_pulls}/160 抽`}>
                  <span className="analysis-detail-progress-fill" style={{ width: `${Math.min(100, (cycle.total_pulls / 160) * 100)}%` }}>
                    {cycle.segments.map((segment, segmentIndex) => (
                      <i
                        key={`${segment.record_id ?? segment.time}-progress-${segmentIndex}`}
                        data-off-rate={segment.is_off_rate ? 'true' : 'false'}
                        style={{ flexGrow: segment.pulls }}
                      />
                    ))}
                  </span>
                </span>
              </button>
            );
          }) : fiveStarRecords.map((record, index) => (
            <button
              type="button"
              key={`${record.record_id ?? record.time}-${index}`}
              onClick={() => onLocate(record.record_id)}
              disabled={record.record_id === null}
              className="w-full rounded-md border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-left transition-colors hover:border-[#d8bd84]/25 hover:bg-[#d8bd84]/[0.045] disabled:cursor-default"
              title="在记录页中定位该五星记录"
            >
              <span className="flex items-center gap-3">
                <ResourceIcon resourceId={record.resource_id} alt="" className="h-10 w-10 shrink-0 rounded object-cover" fallback={<span className="flex h-10 w-10 items-center justify-center rounded bg-white/[0.06] text-xs text-wave">{record.name.charAt(0)}</span>} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><span className="truncate text-sm text-tide">{record.name}</span>{record.is_off_rate ? <span className="rounded border border-[#d84848]/25 bg-[#d84848]/[0.08] px-1.5 py-0.5 text-[10px] text-[#d99a9a]">歪</span> : null}</span>
                  <span className="mt-1 block text-[10px] tabular-nums text-wave">{record.time}</span>
                </span>
                <span className="shrink-0 text-right"><strong className="text-lg tabular-nums text-[#d8bd84]">{record.pulls}</strong><small className="ml-1 text-[10px] text-wave">抽</small></span>
                <ArrowRight size={14} className="shrink-0 text-wave" />
              </span>
              <span className="analysis-detail-progress mt-2" aria-label={`${record.pulls}/${hardPity} 抽`}>
                <span
                  className="analysis-detail-progress-fill"
                  style={{
                    width: `${Math.min(100, (record.pulls / hardPity) * 100)}%`,
                    backgroundColor: record.pulls <= 30 ? '#7ec8a0' : record.pulls <= 60 ? '#e8c87a' : '#e88a7a',
                  }}
                />
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
