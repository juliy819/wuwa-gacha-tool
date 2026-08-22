import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle } from 'lucide-react';
import type { GachaRecord, GachaResource } from '../types';
import { POOL_TYPES } from '../types';
import Modal from './Modal';
import ResonanceCloseButton from './ResonanceCloseButton';
import ResonanceIcon from './ResonanceModeIcon';
import { playUiFeedback } from '../lib/uiFeedback';

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

// 常驻五星角色（维里奈、卡卡罗、鉴心、凌阳、安可）
const STANDARD_CHARACTER_IDS = new Set([1104, 1203, 1301, 1405, 1503]);

// 常驻五星武器（武器常驻唤取可选，武器活动唤取等排除）
const STANDARD_WEAPONS = new Set([
  '千古洑流', '浩境粼光', '停驻之烟', '擎渊怒涛', '漪澜浮录',
  '镭射切变', '源能机锋', '相位涟漪', '脉冲协臂', '玻色星仪',
]);

// 角色常驻唤取 / 新手唤取 / 新手自选唤取：仅可选常驻五星角色
const STANDARD_ROLE_POOLS = new Set(['3', '5', '6', '7']);
// 武器常驻唤取：仅可选常驻五星武器
const STANDARD_WEAPON_POOLS = new Set(['4']);
// 武器活动唤取 / 武器新旅唤取 / 武器联动唤取 / 武器忆旅唤取：排除常驻五星武器
const EVENT_WEAPON_POOLS = new Set(['2', '9', '11', '13']);

type TimeParts = {
  date: string;
  hour: string;
  minute: string;
  second: string;
};

const pad2 = (value: number) => String(value).padStart(2, '0');
const FIRST_GACHA_YEAR = 2024;

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) return null;
  return parsed;
}

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
  const timeButtonRef = useRef<HTMLButtonElement>(null);
  const timePanelRef = useRef<HTMLDivElement>(null);
  const [timePanelStyle, setTimePanelStyle] = useState<React.CSSProperties>({});

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

  useLayoutEffect(() => {
    if (!timeOpen) return;
    const updatePosition = () => {
      const trigger = timeButtonRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 12;
      const width = Math.min(360, window.innerWidth - 24);
      const maxHeight = Math.max(160, window.innerHeight - viewportPadding * 2);
      const measuredHeight = timePanelRef.current?.getBoundingClientRect().height ?? 360;
      const panelHeight = Math.min(measuredHeight, maxHeight);
      const viewportLeft = Math.max(viewportPadding, Math.min(rect.right - width, window.innerWidth - width - viewportPadding));
      const aboveTop = rect.top - panelHeight - 8;
      const belowTop = rect.bottom + 8;
      const maxTop = Math.max(viewportPadding, window.innerHeight - panelHeight - viewportPadding);
      const viewportTop = belowTop + panelHeight <= window.innerHeight - viewportPadding
        ? belowTop
        : aboveTop >= viewportPadding
          ? aboveTop
          : maxTop;
      setTimePanelStyle({
        left: viewportLeft,
        top: viewportTop,
        width,
        maxHeight: `calc(100vh - ${viewportPadding * 2}px)`,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [timeOpen]);

  const availableResources = useMemo(() => {
    const quality = record?.quality_level ?? 5;
    const expectedType = ROLE_FIVE_STAR_POOLS.has(poolType) ? 'role' : 'weapon';
    return resources.filter((resource) => {
      if (resource.quality_level !== quality) return false;
      // 漂泊者是主角，不可从唤取中获得
      if (resource.resource_type === 'role' && resource.name.startsWith('漂泊者')) return false;
      if (quality !== 5) return true;
      if (resource.resource_type !== expectedType) return false;
      // 角色常驻唤取 / 新手唤取 / 新手自选唤取：仅可选常驻五星角色
      if (STANDARD_ROLE_POOLS.has(poolType)) return STANDARD_CHARACTER_IDS.has(resource.resource_id);
      // 武器常驻唤取：仅可选常驻五星武器
      if (STANDARD_WEAPON_POOLS.has(poolType)) return STANDARD_WEAPONS.has(resource.name);
      // 武器活动唤取 / 武器新旅唤取 / 武器联动唤取 / 武器忆旅唤取：排除常驻五星武器
      if (EVENT_WEAPON_POOLS.has(poolType)) return !STANDARD_WEAPONS.has(resource.name);
      // 角色活动唤取 / 新手唤取 / 角色新旅唤取 / 角色联动唤取 / 角色忆旅唤取：所有五星角色（漂泊者已排除）
      return true;
    });
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
  const hardPity = poolType === '5' ? 50 : 80;
  const pullsValid = editing || (
    pulls.trim() !== ''
    && Number.isInteger(numericPulls)
    && numericPulls >= 1
    && numericPulls <= hardPity
  );
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - leadingBlanks + 1;
      return day >= 1 && day <= daysInMonth ? day : null;
    });
  }, [calendarMonth]);

  const dateValid = parseDate(date) !== null;
  const timeValid = dateValid
    && validTimePart(hour, 23)
    && validTimePart(minute, 59)
    && validTimePart(second, 59);
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from(
    { length: Math.max(1, currentYear - FIRST_GACHA_YEAR + 1) },
    (_, index) => currentYear - index,
  );
  if (!yearOptions.includes(calendarMonth.getFullYear())) {
    yearOptions.push(calendarMonth.getFullYear());
    yearOptions.sort((left, right) => right - left);
  }
  const displayTime = `${date.replace(/-/g, '/')} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pullsValid || !timeValid) return;
    await onSubmit({
      card_pool_type: poolType,
      resource_id: resourceId,
      pulls: numericPulls,
      time: `${date} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`,
    });
    void playUiFeedback(editing ? 'data-rebuilt' : 'record-inserted');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={submitting}
      className="allow-popover-overflow max-w-[500px] overflow-visible"
      labelledBy="mock-gacha-dialog-title"
    >
      <form
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || (!poolOpen && !resourceOpen && !timeOpen)) return;
          event.preventDefault();
          event.stopPropagation();
          setPoolOpen(false);
          setResourceOpen(false);
          setTimeOpen(false);
        }}
        className="w-full"
      >
        <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 id="mock-gacha-dialog-title" className="text-sm font-semibold text-tide">{editing ? '编辑模拟记录' : '插入五星记录'}</h2>
            <p className="mt-1 text-xs text-wave">{editing ? '仅修改当前模拟记录' : '自动补足目标抽数缺少的记录'}</p>
          </div>
          <ResonanceCloseButton onClick={onClose} disabled={submitting} />
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
              <ResonanceIcon kind="chevron" size={14} className={`shrink-0 text-wave transition-transform ${poolOpen ? 'rotate-180' : ''}`} />
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
                    {pool.type === poolType && <ResonanceIcon kind="check" size={13} />}
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
              <ResonanceIcon kind="chevron" size={14} className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-wave transition-transform ${resourceOpen ? 'rotate-180' : ''}`} />
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
                    {resource.resource_id === resourceId && <ResonanceIcon kind="check" size={13} className="shrink-0" />}
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
                max={hardPity}
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
              ref={timeButtonRef}
              type="button"
              onClick={() => { setTimeOpen((value) => !value); setPoolOpen(false); setResourceOpen(false); }}
              className="glass-input relative flex h-10 min-w-0 w-full items-center px-3 pr-10 text-left text-sm tabular-nums text-tide"
              aria-haspopup="dialog"
              aria-expanded={timeOpen}
            >
              <span className="truncate">{displayTime}</span>
              <ResonanceIcon kind="calendar" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-wave" />
            </button>
            {timeOpen && createPortal(
              <div ref={timePanelRef} className="fixed z-[60] w-[360px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-md border border-white/[0.1] bg-[#202020] p-2.5 shadow-2xl" style={timePanelStyle} role="dialog" aria-label="选择记录时间">
                <div className="grid grid-cols-[28px_1fr_28px] items-center gap-2">
                  <button type="button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} className="flex h-7 w-7 items-center justify-center rounded text-wave hover:bg-white/[0.06] hover:text-tide" title="上个月" aria-label="上个月">
                    <ResonanceIcon kind="previous" size={15} />
                  </button>
                  <div className="flex min-w-0 items-center justify-center gap-2">
                    <div className="relative min-w-0 flex-1">
                      <select
                        value={calendarMonth.getFullYear()}
                        onChange={(event) => setCalendarMonth(new Date(Number(event.target.value), calendarMonth.getMonth(), 1))}
                        className="glass-input h-7 w-full appearance-none px-7 text-center text-xs tabular-nums text-tide"
                        aria-label="选择年份"
                      >
                        {yearOptions.map((year) => <option key={year} value={year}>{year} 年</option>)}
                      </select>
                      <ResonanceIcon kind="chevron" size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-wave" />
                    </div>
                    <div className="relative min-w-0 flex-1">
                      <select
                        value={calendarMonth.getMonth()}
                        onChange={(event) => setCalendarMonth(new Date(calendarMonth.getFullYear(), Number(event.target.value), 1))}
                        className="glass-input h-7 w-full appearance-none px-7 text-center text-xs tabular-nums text-tide"
                        aria-label="选择月份"
                      >
                        {Array.from({ length: 12 }, (_, month) => <option key={month} value={month}>{month + 1} 月</option>)}
                      </select>
                      <ResonanceIcon kind="chevron" size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-wave" />
                    </div>
                  </div>
                  <button type="button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} className="flex h-7 w-7 items-center justify-center rounded text-wave hover:bg-white/[0.06] hover:text-tide" title="下个月" aria-label="下个月">
                    <ResonanceIcon kind="next" size={15} />
                  </button>
                </div>
                <div className="mt-1.5 grid grid-cols-7 text-center text-[10px] text-wave">
                  {['一', '二', '三', '四', '五', '六', '日'].map((weekday) => <span key={weekday} className="py-0.5">{weekday}</span>)}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {calendarDays.map((day, index) => {
                    if (day === null) return <span key={`blank-${index}`} className="h-7" />;
                    const dayValue = `${calendarMonth.getFullYear()}-${pad2(calendarMonth.getMonth() + 1)}-${pad2(day)}`;
                    return (
                      <button
                        key={dayValue}
                        type="button"
                        onClick={() => setDate(dayValue)}
                        className={`h-7 rounded text-xs ${dayValue === date ? 'bg-ember text-[#171717]' : 'text-tide hover:bg-white/[0.07]'}`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-end gap-2 border-t border-white/[0.07] pt-2">
                  <label className="grid min-w-0 flex-1 gap-1 text-[10px] text-wave">
                    日期
                    <input
                      type="text"
                      inputMode="numeric"
                      value={date}
                      maxLength={10}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => {
                        const nextDate = event.target.value;
                        if (!/^[\d-]{0,10}$/.test(nextDate)) return;
                        setDate(nextDate);
                        const parsed = parseDate(nextDate);
                        if (parsed) setCalendarMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
                      }}
                      className="glass-input h-8 min-w-0 w-full px-2 text-center text-xs tabular-nums text-tide"
                      placeholder="YYYY-MM-DD"
                      aria-label="日期"
                      aria-invalid={!dateValid}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const today = new Date();
                      setDate(`${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`);
                      setCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                    }}
                    className="h-8 shrink-0 rounded px-3 text-xs text-wave hover:bg-white/[0.06] hover:text-tide"
                  >
                    今天
                  </button>
                </div>
                <div className="mt-1.5 flex items-end gap-2">
                  <ResonanceIcon kind="clock" size={16} className="mb-2 shrink-0 text-wave" />
                  {[
                    { label: '时', value: hour, setValue: setHour, max: 23 },
                    { label: '分', value: minute, setValue: setMinute, max: 59 },
                    { label: '秒', value: second, setValue: setSecond, max: 59 },
                  ].map((part, index) => (
                    <div key={part.label} className="flex min-w-0 flex-1 items-end gap-2">
                      {index > 0 && <span className="mb-2 text-wave">:</span>}
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
                          className="glass-input h-8 min-w-0 w-full px-2 text-center text-sm tabular-nums text-tide"
                          aria-label={part.label}
                        />
                      </label>
                    </div>
                  ))}
                  <button type="button" onClick={() => setTimeOpen(false)} disabled={!timeValid} className="tide-btn h-8 shrink-0 px-3 text-xs disabled:opacity-40">确定</button>
                </div>
              </div>,
              document.body,
            )}
          </div>
        </div>

        {(poolOpen || resourceOpen || timeOpen) && (
          <button type="button" className="fixed inset-0 z-20 cursor-default" onClick={() => { setPoolOpen(false); setResourceOpen(false); setTimeOpen(false); }} aria-label="关闭弹出菜单" />
        )}

        <footer className="flex items-center justify-end gap-2 border-t border-white/[0.06] bg-transparent px-5 py-4">
          <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 text-sm text-wave hover:text-tide disabled:opacity-40">取消</button>
          <button type="submit" disabled={submitting || loadingResources || resourceId === 0 || !pullsValid || !timeValid} className="tide-btn flex min-w-[108px] items-center justify-center gap-2 px-4 py-2 text-sm">
            {submitting ? <LoaderCircle size={14} className="animate-spin" /> : editing ? <ResonanceIcon kind="save" size={15} /> : <ResonanceIcon kind="add" size={15} />}
            {editing ? '保存修改' : '确认插入'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
