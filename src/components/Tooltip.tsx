import { createPortal } from 'react-dom';
import { useEffect, useState, useRef, useCallback } from 'react';

// 全局单实例 + 鼠标跟随定位
// - 同一时刻只允许一个 Tooltip 显示，避免快速划过时的拖影
// - 跟随鼠标位置（光标右下偏移），而不是固定在元素中心

type TooltipId = symbol;
let activeTooltipId: TooltipId | null = null;
const hideSubscribers = new Set<(id: TooltipId) => void>();
const showDelayMs = 260;
const hideDelayMs = 180;

const requestExclusive = (id: TooltipId) => {
  hideSubscribers.forEach((fn) => fn(id));
  activeTooltipId = id;
};

const releaseExclusive = (id: TooltipId) => {
  if (activeTooltipId === id) activeTooltipId = null;
};

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export default function Tooltip({ children, content, className = '', contentClassName = '' }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const idRef = useRef<TooltipId>(Symbol('tooltip'));
  const mouseRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number>();

  // 订阅全局互斥
  useEffect(() => {
    const subscriber = (exceptId: TooltipId) => {
      if (idRef.current !== exceptId && visible) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        if (showTimer.current) clearTimeout(showTimer.current);
        setVisible(false);
      }
    };
    hideSubscribers.add(subscriber);
    return () => {
      hideSubscribers.delete(subscriber);
      if (activeTooltipId === idRef.current) activeTooltipId = null;
    };
  }, [visible]);

  // 跟随鼠标定位：在 requestAnimationFrame 中计算，避免布局跳动
  const updatePosition = useCallback(() => {
    const tipEl = tooltipRef.current;
    if (!tipEl) return;
    const tipRect = tipEl.getBoundingClientRect();
    const gap = 12;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const { x, y } = mouseRef.current;

    // 默认在鼠标右下方
    let left = x + gap;
    let top = y + gap;

    // 水平方向：右侧不够放左侧
    if (left + tipRect.width + 8 > vw) {
      left = x - tipRect.width - gap;
    }
    if (left < 8) left = 8;

    // 垂直方向：下方不够放上方
    if (top + tipRect.height + 8 > vh) {
      top = y - tipRect.height - gap;
    }
    if (top < 8) top = 8;

    setPos({ top, left });
  }, []);

  // 可见时持续跟踪鼠标
  useEffect(() => {
    if (!visible) return;

    const onMove = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updatePosition);
    };
    window.addEventListener('mousemove', onMove);
    // 初始位置计算
    rafRef.current = requestAnimationFrame(updatePosition);

    return () => {
      window.removeEventListener('mousemove', onMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [visible, updatePosition]);

  const show = useCallback((e?: React.MouseEvent) => {
    if (e) mouseRef.current = { x: e.clientX, y: e.clientY };
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (visible) {
      // 已经可见就立即更新位置
      requestAnimationFrame(updatePosition);
      return;
    }
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => {
      requestExclusive(idRef.current);
      setVisible(true);
      // 等 DOM 渲染后算位置
      requestAnimationFrame(() => requestAnimationFrame(updatePosition));
    }, showDelayMs);
  }, [visible, updatePosition]);

  const hide = useCallback(() => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setVisible(false);
      releaseExclusive(idRef.current);
    }, hideDelayMs);
  }, []);

  // 滚/缩时隐藏
  useEffect(() => {
    if (!visible) return;
    const handle = () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setVisible(false);
      releaseExclusive(idRef.current);
    };
    window.addEventListener('scroll', handle, true);
    window.addEventListener('resize', handle);
    return () => {
      window.removeEventListener('scroll', handle, true);
      window.removeEventListener('resize', handle);
    };
  }, [visible]);

  return (
    <>
      <div
        ref={triggerRef}
        className={className}
        onMouseEnter={show}
        onMouseMove={(e) => { mouseRef.current = { x: e.clientX, y: e.clientY }; }}
        onMouseLeave={hide}
      >
        {children}
      </div>
      {visible && createPortal(
        <div
          ref={tooltipRef}
          className={`fixed z-[9999] pointer-events-none px-3 py-2 rounded-lg glass-card text-xs shadow-xl whitespace-nowrap ${contentClassName}`}
          style={{ top: pos.top, left: pos.left }}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
}
