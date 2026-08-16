import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

interface ThemedDateInputProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  label: string;
  className?: string;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseIsoDate = (value?: string) => {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

const monthKey = (date: Date) => date.getFullYear() * 12 + date.getMonth();

export default function ThemedDateInput({ value, onChange, min, max, label, className = '' }: ThemedDateInputProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const selectedDate = parseIsoDate(value);
  const minDate = parseIsoDate(min);
  const maxDate = parseIsoDate(max);
  const fallbackDate = selectedDate ?? maxDate ?? minDate ?? new Date();
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(fallbackDate.getFullYear(), fallbackDate.getMonth(), 1));

  useEffect(() => {
    if (!open) return;
    const next = selectedDate ?? maxDate ?? minDate ?? new Date();
    setVisibleMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 280;
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 338)),
      });
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [max, min, open, value]);

  const days = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const count = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - firstWeekday + 1;
      if (day < 1 || day > count) return null;
      const date = new Date(year, month, day);
      const iso = toIsoDate(date);
      return { day, iso, disabled: Boolean((min && iso < min) || (max && iso > max)) };
    });
  }, [max, min, visibleMonth]);

  const canMovePrevious = !minDate || monthKey(visibleMonth) > monthKey(minDate);
  const canMoveNext = !maxDate || monthKey(visibleMonth) < monthKey(maxDate);
  const today = toIsoDate(new Date());
  const todayAllowed = (!min || today >= min) && (!max || today <= max);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`glass-input flex h-8 w-full items-center justify-between gap-2 px-2 text-left text-[10px] text-tide ${className}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={value ? 'tabular-nums' : 'text-wave'}>{value ? value.replace(/-/g, '/') : '选择日期'}</span>
        <CalendarDays size={13} className="shrink-0 text-[#b9a16f]" />
      </button>
      {open ? createPortal(
        <>
          <button type="button" className="fixed inset-0 z-[90] cursor-default" onClick={() => setOpen(false)} aria-label="关闭日期选择器" />
          <div
            role="dialog"
            aria-label={`${label}日历`}
            className="fixed z-[91] w-[280px] rounded-md border border-white/[0.12] bg-[#242524] p-3 text-tide shadow-[0_20px_60px_rgba(0,0,0,0.58)]"
            style={position}
          >
            <div className="flex items-center justify-between">
              <strong className="text-sm font-medium">{visibleMonth.getFullYear()} 年 {visibleMonth.getMonth() + 1} 月</strong>
              <div className="flex items-center gap-1">
                <button type="button" disabled={!canMovePrevious} onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} className="flex h-8 w-8 items-center justify-center rounded-md text-wave hover:bg-white/[0.06] hover:text-tide disabled:opacity-25" aria-label="上个月"><ChevronLeft size={15} /></button>
                <button type="button" disabled={!canMoveNext} onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} className="flex h-8 w-8 items-center justify-center rounded-md text-wave hover:bg-white/[0.06] hover:text-tide disabled:opacity-25" aria-label="下个月"><ChevronRight size={15} /></button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1 text-center">
              {WEEKDAYS.map((weekday) => <span key={weekday} className="py-1 text-[10px] text-wave">{weekday}</span>)}
              {days.map((item, index) => item ? (
                <button
                  type="button"
                  key={item.iso}
                  disabled={item.disabled}
                  onClick={() => { onChange(item.iso); setOpen(false); }}
                  className={`flex h-8 items-center justify-center rounded text-xs tabular-nums transition-colors ${item.iso === value ? 'bg-[#d8bd84] text-[#1d1e1d]' : item.iso === today ? 'border border-[#8fc8be]/35 text-[#a8d7cf] hover:bg-white/[0.06]' : 'text-tide hover:bg-white/[0.06]'} disabled:text-white/20`}
                >
                  {item.day}
                </button>
              ) : <span key={`blank-${index}`} className="h-8" />)}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-white/[0.07] pt-2">
              <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="h-7 rounded px-2 text-[10px] text-wave hover:bg-white/[0.05] hover:text-tide">清除</button>
              <button type="button" disabled={!todayAllowed} onClick={() => { onChange(today); setOpen(false); }} className="h-7 rounded px-2 text-[10px] text-[#a8d7cf] hover:bg-[#8fc8be]/[0.08] disabled:opacity-25">今天</button>
            </div>
          </div>
        </>,
        document.body,
      ) : null}
    </>
  );
}
