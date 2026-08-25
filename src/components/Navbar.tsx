import { useRef, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useGachaStore } from '../store/useGachaStore';
import { useUpdateStore } from '../store/useUpdateStore';
import { displayUid } from '../lib/shareMode';
import appIcon from '../../src-tauri/icons/32x32.png';
import ResonanceCloseButton from './ResonanceCloseButton';
import ResonanceActionIcon from './ResonanceActionIcon';
import ResonanceIcon, { type ResonanceModeIconKind } from './ResonanceModeIcon';
import WuwaControlIcon from './WuwaControlIcon';

const navItems: Array<{ path: string; label: string; kind: ResonanceModeIconKind; preload?: () => Promise<unknown> }> = [
  { path: '/', label: '首页', kind: 'origin' },
  { path: '/records', label: '记录', kind: 'echo', preload: () => import('../pages/RecordsPage') },
  { path: '/analytics', label: '分析', kind: 'chart', preload: () => import('../pages/AnalyticsPage') },
  { path: '/settings', label: '设置', kind: 'calibration', preload: () => import('../pages/SettingsPage') },
];

export default function Navbar() {
  const location = useLocation();
  const pools = useGachaStore((state) => state.pools);
  const activePlayerId = useGachaStore((state) => state.activePlayerId);
  const setActivePlayer = useGachaStore((state) => state.setActivePlayer);
  const refreshAll = useGachaStore((state) => state.refreshAll);
  const availableUpdate = useUpdateStore((state) => state.availableUpdate);
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeIndex = navItems.findIndex((item) => item.path === location.pathname);
    if (activeIndex === -1) {
      setIndicatorStyle({ left: 0, width: 0 });
      return;
    }
    const links = container.querySelectorAll('a');
    const activeLink = links[activeIndex] as HTMLElement;
    if (!activeLink) return;
    setIndicatorStyle({
      left: activeLink.offsetLeft,
      width: activeLink.offsetWidth,
    });
  }, [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  useEffect(() => {
    const preload = () => {
      navItems.forEach((item) => {
        if (item.preload && item.path !== '/analytics') void item.preload();
      });
    };
    const runtimeWindow = window as unknown as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const requestIdle = runtimeWindow.requestIdleCallback;
    const idle = requestIdle
      ? requestIdle(preload, { timeout: 3200 })
      : window.setTimeout(preload, 1800);
    return () => {
      const cancelIdle = runtimeWindow.cancelIdleCallback;
      if (requestIdle) {
        cancelIdle?.(idle);
      } else {
        window.clearTimeout(idle as number);
      }
    };
  }, []);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  };

  const handleMinimize = async () => {
    try { await getCurrentWindow().minimize(); } catch (e) { console.error(e); }
  };
  const handleMaximize = async () => {
    try { await getCurrentWindow().toggleMaximize(); } catch (e) { console.error(e); }
  };
  const handleClose = async () => {
    try { await getCurrentWindow().close(); } catch (e) { console.error(e); }
  };

  return (
    <nav
      data-tauri-drag-region
      className="app-navbar relative flex h-12 shrink-0 select-none items-center justify-between"
    >
      {/* 左侧：标题 + 分隔线 + 导航标签 */}
      <div className="flex items-center h-full">
        <div className="flex h-full items-center gap-2.5 pl-5 pr-4">
          <img src={appIcon} alt="" className="app-brand-icon" aria-hidden="true" />
          <span className="flex items-baseline gap-2 whitespace-nowrap">
            <span className="brand-title">Wuwa Gacha Tool</span>
            <span className="brand-author">BY Juliy</span>
          </span>
        </div>

        <div className="nav-divider h-5 w-px" />

        <div ref={containerRef} className="relative flex items-center gap-1 pl-2.5 pr-5 h-full">
          <motion.div
            className="nav-active-frame absolute overflow-hidden"
            style={{
              top: 6,
              bottom: 6,
            }}
            animate={{ left: indicatorStyle.left, width: indicatorStyle.width }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          >
            <span className="nav-active-surface" />
            <span className="nav-active-node" />
          </motion.div>
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onMouseEnter={item.preload}
                onFocus={item.preload}
                onPointerDown={item.preload}
                aria-label={item.label}
                title={item.label}
                data-active={isActive ? 'true' : 'false'}
                className={`app-nav-link relative z-10 flex items-center gap-2 px-4 py-2 text-sm font-medium ${
                  isActive ? 'text-tide' : 'text-wave hover:text-tide-dim'
                }`}
              >
                <ResonanceActionIcon
                  size="sm"
                  tone={isActive ? 'gold' : 'default'}
                  framed={false}
                  className={`nav-semantic-icon nav-semantic-icon-${item.kind}`}
                >
                  <ResonanceIcon kind={item.kind} />
                </ResonanceActionIcon>
                <span>{item.label}</span>
                {item.path === '/settings' && availableUpdate && (
                  <span className="nav-status-diamond" aria-hidden="true" />
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* 右侧：玩家选择 + 刷新 + 窗口控件 */}
      <div className="flex items-center h-full" data-tauri-drag-region={false}>
        {pools.length > 0 && (
          <div className="relative mr-2">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm glass-input"
            >
              <span className="text-tide">{activePlayerId ? displayUid(activePlayerId) : '选择玩家'}</span>
              <ResonanceIcon kind="chevron" size={14} className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>
            {menuOpen && <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />}
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4, scale: 0.985 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute right-0 top-full mt-2 w-48 rounded-lg overflow-hidden z-50 glass-card"
                >
                  {pools.map((id) => (
                    <button
                      key={id}
                      onClick={() => { setActivePlayer(id); setMenuOpen(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm flex items-center justify-between hover:bg-[rgba(212,212,212,0.06)] transition-colors"
                      style={{ color: activePlayerId === id ? '#d4d4d4' : '#b4b4b4' }}
                    >
                      {displayUid(id)}
                      {activePlayerId === id && <ResonanceIcon kind="check" size={14} className="text-tide" />}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="utility-control mr-1 flex h-9 w-9 items-center justify-center text-wave hover:text-tide"
          title={refreshing ? '正在刷新' : '刷新'}
          aria-label={refreshing ? '正在刷新' : '刷新'}
        >
          <WuwaControlIcon kind="refresh" active={refreshing} />
        </button>

        <button
          onClick={handleMinimize}
          className="window-control flex h-full w-12 items-center justify-center text-wave hover:text-tide-dim"
          aria-label="最小化窗口"
        >
          <WuwaControlIcon kind="minimize" />
        </button>
        <button
          onClick={handleMaximize}
          className="window-control flex h-full w-12 items-center justify-center text-wave hover:text-tide-dim"
          aria-label="最大化或还原窗口"
        >
          <WuwaControlIcon kind="maximize" />
        </button>
        <ResonanceCloseButton
          onClick={handleClose}
          className="window-control window-control-close window-resonance-close"
          aria-label="关闭窗口"
          title="关闭窗口"
        />
      </div>
    </nav>
  );
}
