import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, LoaderCircle, Plus, Save, X } from 'lucide-react';
import type { GachaRecord, GachaResource } from '../types';
import { POOL_TYPES } from '../types';

type SubmitValue = {
  card_pool_type: string;
  resource_id: number;
  time: string;
  pulls: number;
};

type Props = {
  open: boolean;
  record?: GachaRecord | null;
  initialPoolType: string;
  resources: GachaResource[];
  loadingResources: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (value: SubmitValue) => Promise<void>;
};

const ROLE_FIVE_STAR_POOLS = new Set(['1', '3', '5', '6', '7', '8', '10', '12']);

type TimeParts = {
  date: string;
  hour: string;
  minute: string;
  second: string;
};

const pad2 = (value: number) => String(value).padStart(2, '0');

function toTimeParts(value?: string): TimeParts {
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return { date: match[1], hour: match[2], minute: match[3], second: match[4] ?? '00' };
  }
  const now = new Date();
  return {
    date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    hour: pad2(now.getHours()),
    minute: pad2(now.getMinutes()),
    second: pad2(now.getSeconds()),
  };
}

function monthFromDate(value: string) {
  const [year, month] = value.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

function validTimePart(value: string, max: number) {
  return /^\d{1,2}$/.test(value) && Number(value) >= 0 && Number(value) <= max;
}

function normalizeTimePart(value: string, max: number) {
  const number = Number(value);
  return pad2(Number.isFinite(number) ? Math.min(max, Math.max(0, number)) : 0);
}

export default function MockGachaDialog({
  open,
  record,
  initialPoolType,
  resources,
  loadingResources,
  submitting,
  onClose,
  onSubmit,
}: Props) {
  const editing = Boolean(record);
  const initialTime = toTimeParts();
  const [poolType, setPoolType] = useState(initialPoolType);
  const [resourceId, setResourceId] = useState(0);
  const [pulls, setPulls] = useState('50');
  const [date, setDate] = useState(initialTime.date);
  const [hour, setHour] = useState(initialTime.hour);
  const [minute, setMinute] = useState(initialTime.minute);
  const [second, setSecond] = useState(initialTime.second);
  const [calendarMonth, setCalendarMonth] = useState(monthFromDate(initialTime.date));
  const [poolOpen, setPoolOpen] = useState(false);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [resourceQuery, setResourceQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setPoolType(record?.card_pool_type ?? initialPoolType);
    setResourceId(record?.resource_id ?? 0);
    setPulls('50');
    const nextTime = toTimeParts(record?.time);
    setDate(nextTime.date);
    setHour(nextTime.hour);
    setMinute(nextTime.minute);
    setSecond(nextTime.second);
    setCalendarMonth(monthFromDate(nextTime.date));
    setPoolOpen(false);
    setResourceOpen(false);
    setTimeOpen(false);
    setResourceQuery('');
  }, [open, record, initialPoolType]);

  const availableResources = useMemo(() => {
    const quality = record?.quality_level ?? 5;
    const expectedType = ROLE_FIVE_STAR_POOLS.has(poolType) ? 'role' : 'weapon';
    return resources.filter((resource) =>
      resource.quality_level === quality
      && (quality !== 5 || resource.resource_type === expectedType)
      // 漂泊者是主角，不可从唤取中获得
      && !(resource.resource_type === 'role' && resource.name.startsWith('漂泊者')),
    );
  }, [resources, record?.quality_level, poolType]);

  const selectedResource = useMemo(
    () => availableResources.find((resource) => resource.resource_id === resourceId),
    [availableResources, resourceId],
  );

  const filteredResources = useMemo(() => {
    const query = resourceQuery.trim().toLocaleLowerCase();
    if (!query) return availableResources;
    return availableResources.filter((resource) => resource.name.toLocaleLowerCase().includes(query));
  }, [availableResources, resourceQuery]);

  useEffect(() => {
    if (availableResources.length === 0) return;
    if (!availableResources.some((resource) => resource.resource_id === resourceId)) {
      setResourceId(availableResources[0].resource_id);
    }
  }, [availableResources, resourceId]);

  const numericPulls = Number(pulls);
  const pullsValid = editing || (
    pulls.trim() !== ''
    && Number.isInteger(numericPulls)
    && numericPulls >= 1
    && numericPulls <= 80
  );
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return [
      ...Array.from({ length: leadingBlanks }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
    ];
  }, [calendarMonth]);

  const timeValid = /^\d{4}-\d{2}-\d{2}$/.test(date)
    && validTimePart(hour, 23)
    && validTimePart(minute, 59)
    && validTimePart(second, 59);
  const displayTime = `${date.replace(/-/g, '/')} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`;

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pullsValid || !timeValid) return;
    await onSubmit({
      card_pool_type: poolType,
      resource_id: resourceId,
      pulls: numericPulls,
      time: `${date} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4"
      onMouseDown={(event) => { if (event.currentTarget === event.target && !submitting) onClose(); }}
    >
      <form onSubmit={submit} className="glass-card w-full max-w-[500px] overflow-visible rounded-lg shadow-2xl">
        <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-tide">{editing ? '编辑模拟记录' : '插入五星记录'}</h2>
            <p className="mt-1 text-xs text-wave">{editing ? '仅修改当前模拟记录' : '自动补足目标抽数缺少的记录'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="flex h-8 w-8 items-center justify-center rounded-md text-wave hover:bg-white/[0.05] hover:text-tide disabled:opacity-40" title="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <label className={`grid gap-1.5 text-xs text-wave ${poolOpen ? 'relative z-30' : 'relative'}`}>
            卡池
            <button
              type="button"
              onClick={() => { setPoolOpen((value) => !value); setResourceOpen(false); setTimeOpen(false); }}
              className="glass-input flex h-10 w-full items-center justify-between gap-2 px-3 text-left text-sm text-tide"
              aria-haspopup="listbox"
              aria-expanded={poolOpen}
            >
              <span className="truncate">{POOL_TYPES.find((pool) => pool.type === poolType)?.name}</span>
              <ChevronDown size={14} className={`shrink-0 text-wave transition-transform ${poolOpen ? 'rotate-180' : ''}`} />
            </button>
            {poolOpen && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-white/[0.1] bg-[#202020] p-1 shadow-2xl" role="listbox">
                {POOL_TYPES.map((pool) => (
                  <button
                    key={pool.type}
                    type="button"
                    onClick={() => { setPoolType(pool.type); setPoolOpen(false); }}
                    className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-xs ${pool.type === poolType ? 'bg-white/[0.1] text-tide' : 'text-wave hover:bg-white/[0.06] hover:text-tide'}`}
                    role="option"
                    aria-selected={pool.type === poolType}
                  >
                    <span>{pool.name}</span>
                    {pool.type === poolType && <Check size={13} />}
                  </button>
                ))}
              </div>
            )}
          </label>

          <label className={`grid gap-1.5 text-xs text-wave ${resourceOpen ? 'relative z-30' : 'relative'}`}>
            {record?.quality_level ? `${record.quality_level} 星物品` : '五星角色 / 武器'}
            <div className="relative min-w-0">
              <input
                type="text"
                value={resourceOpen ? resourceQuery : (selectedResource?.name ?? '')}
                onFocus={() => { setResourceQuery(''); setResourceOpen(true); setPoolOpen(false); setTimeOpen(false); }}
                onChange={(event) => { setResourceQuery(event.target.value); setResourceOpen(true); }}
                disabled={loadingResources || availableResources.length === 0}
                placeholder={loadingResources ? '正在读取资源目录' : '搜索物品'}
                className="glass-input h-10 w-full px-3 pr-9 text-sm text-tide disabled:opacity-50"
                autoComplete="off"
                role="combobox"
                aria-expanded={resourceOpen}
                aria-controls="mock-resource-options"
              />
              <ChevronDown size={14} className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-wave transition-transform ${resourceOpen ? 'rotate-180' : ''}`} />
            </div>
            {resourceOpen && (
              <div id="mock-resource-options" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-white/[0.1] bg-[#202020] p-1 shadow-2xl" role="listbox">
                {filteredResources.length === 0 ? (
                  <div className="px-3 py-3 text-center text-xs text-wave">没有匹配物品</div>
                ) : filteredResources.map((resource) => (
                  <button
                    key={resource.resource_id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => { setResourceId(resource.resource_id); setResourceQuery(''); setResourceOpen(false); }}
                    className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-xs ${resource.resource_id === resourceId ? 'bg-white/[0.1] text-tide' : 'text-wave hover:bg-white/[0.06] hover:text-tide'}`}
                    role="option"
                    aria-selected={resource.resource_id === resourceId}
                  >
                    <span className="truncate">{resource.name}</span>
                    {resource.resource_id === resourceId && <Check size={13} className="shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </label>

          {!editing && (
            <label className="grid gap-1.5 text-xs text-wave">
              五星抽数
              <input
                type="number"
                min={1}
                max={80}
                step={1}
                value={pulls}
                onChange={(event) => setPulls(event.target.value)}
                className="glass-input h-10 px-3 text-sm tabular-nums text-tide"
                aria-invalid={!pullsValid}
                required
              />
            </label>
          )}

          <div className={`relative grid min-w-0 gap-1.5 text-xs text-wave ${editing ? 'sm:col-span-2' : ''} ${timeOpen ? 'z-30' : ''}`}>
            记录时间
            <button
              type="button"
              onClick={() => { setTimeOpen((value) => !value); setPoolOpen(false); setResourceOpen(false); }}
              className="glass-input relative flex h-10 min-w-0 w-full items-center px-3 pr-10 text-left text-sm tabular-nums text-tide"
              aria-haspopup="dialog"
              aria-expanded={timeOpen}
            >
              <span className="truncate">{displayTime}</span>
              <CalendarDays size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-wave" />
            </button>
            {timeOpen && (
              <div className="absolute bottom-full right-0 z-30 mb-1 w-[360px] max-w-[calc(100vw-3rem)] rounded-md border border-white/[0.1] bg-[#202020] p-3 shadow-2xl" role="dialog" aria-label="选择记录时间">
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} className="flex h-8 w-8 items-center justify-center rounded text-wave hover:bg-white/[0.06] hover:text-tide" title="上个月">
                    <ChevronLeft size={15} />
                  </button>
                  <span className="text-sm font-medium text-tide">{calendarMonth.getFullYear()} 年 {calendarMonth.getMonth() + 1} 月</span>
                  <button type="button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} className="flex h-8 w-8 items-center justify-center rounded text-wave hover:bg-white/[0.06] hover:text-tide" title="下个月">
                    <ChevronRight size={15} />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-7 text-center text-[10px] text-wave">
                  {['一', '二', '三', '四', '五', '六', '日'].map((weekday) => <span key={weekday} className="py-1">{weekday}</span>)}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map((day, index) => {
                    if (day === null) return <span key={`blank-${index}`} className="h-8" />;
                    const dayValue = `${calendarMonth.getFullYear()}-${pad2(calendarMonth.getMonth() + 1)}-${pad2(day)}`;
                    return (
                      <button
                        key={dayValue}
                        type="button"
                        onClick={() => setDate(dayValue)}
                        className={`h-8 rounded text-xs ${dayValue === date ? 'bg-ember text-[#171717]' : 'text-tide hover:bg-white/[0.07]'}`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-end gap-2 border-t border-white/[0.07] pt-3">
                  <Clock3 size={15} className="mb-2.5 shrink-0 text-wave" />
                  {[
                    { label: '时', value: hour, setValue: setHour, max: 23 },
                    { label: '分', value: minute, setValue: setMinute, max: 59 },
                    { label: '秒', value: second, setValue: setSecond, max: 59 },
                  ].map((part, index) => (
                    <div key={part.label} className="flex min-w-0 flex-1 items-end gap-2">
                      {index > 0 && <span className="mb-2.5 text-wave">:</span>}
                      <label className="grid min-w-0 flex-1 gap-1 text-[10px] text-wave">
                        {part.label}
                        <input
                          type="number"
                          min={0}
                          max={part.max}
                          value={part.value}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => { if (/^\d{0,2}$/.test(event.target.value)) part.setValue(event.target.value); }}
                          onBlur={() => part.setValue(normalizeTimePart(part.value, part.max))}
                          className="glass-input h-9 min-w-0 w-full px-2 text-center text-sm tabular-nums text-tide"
                          aria-label={part.label}
                        />
                      </label>
                    </div>
                  ))}
                  <button type="button" onClick={() => setTimeOpen(false)} disabled={!timeValid} className="tide-btn h-9 shrink-0 px-3 text-xs disabled:opacity-40">确定</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {(poolOpen || resourceOpen || timeOpen) && (
          <button type="button" className="fixed inset-0 z-20 cursor-default" onClick={() => { setPoolOpen(false); setResourceOpen(false); setTimeOpen(false); }} aria-label="关闭弹出菜单" />
        )}

        <footer className="flex items-center justify-end gap-2 rounded-b-lg border-t border-white/[0.06] bg-[#262626] px-5 py-4">
          <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 text-sm text-wave hover:text-tide disabled:opacity-40">取消</button>
          <button type="submit" disabled={submitting || loadingResources || resourceId === 0 || !pullsValid || !timeValid} className="tide-btn flex min-w-[108px] items-center justify-center gap-2 px-4 py-2 text-sm">
            {submitting ? <LoaderCircle size={14} className="animate-spin" /> : editing ? <Save size={14} /> : <Plus size={14} />}
            {editing ? '保存修改' : '确认插入'}
          </button>
        </footer>
      </form>
    </div>
  );
}
