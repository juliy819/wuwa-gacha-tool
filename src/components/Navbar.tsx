import { useRef, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, RefreshCw, Settings as SettingsIcon, ChevronDown, Check, Minus, X, Maximize2 } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useGachaStore } from '../store/useGachaStore';

const navItems = [
  { path: '/', label: '首页', Icon: Home },
  { path: '/records', label: '记录', Icon: RefreshCw },
  { path: '/settings', label: '设置', Icon: SettingsIcon },
];

export default function Navbar() {
  const location = useLocation();
  const { pools, activePlayerId, setActivePlayer, refreshAll } = useGachaStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeIndex = navItems.findIndex((item) => item.path === location.pathname);
    if (activeIndex === -1) return;
    const links = container.querySelectorAll('a');
    const activeLink = links[activeIndex] as HTMLElement;
    if (!activeLink) return;
    setIndicatorStyle({
      left: activeLink.offsetLeft,
      width: activeLink.offsetWidth,
    });
  }, [location.pathname]);

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
      className="relative flex items-center justify-between border-b select-none h-12 shrink-0"
      style={{ background: '#1a1a1a', borderColor: 'rgba(255, 255, 255, 0.06)' }}
    >
      {/* 左侧：标题 + 分隔线 + 导航标签 */}
      <div className="flex items-center h-full">
        <div className="flex items-center gap-2.5 pl-5 pr-3 h-full">
          <span className="text-sm font-medium text-tide tracking-wide whitespace-nowrap">
            Wuwa Gacha Tool - BY Juliy
          </span>
        </div>

        <div className="h-4 w-px" style={{ background: 'rgba(255, 255, 255, 0.08)' }} />

        <div ref={containerRef} className="relative flex items-center gap-1 pl-2.5 pr-5 h-full">
          <motion.div
            className="absolute rounded-md overflow-hidden"
            style={{
              top: 6,
              bottom: 6,
              background: '#2f2f2f',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
            animate={{ left: indicatorStyle.left, width: indicatorStyle.width }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          />
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.Icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`relative z-10 flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm tracking-wide transition-colors duration-200 ${
                  isActive ? 'text-tide' : 'text-wave hover:text-tide-dim'
                }`}
              >
                <Icon size={15} strokeWidth={isActive ? 2.2 : 1.6} />
                <span>{item.label}</span>
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
              <span className="text-tide">{activePlayerId || '选择玩家'}</span>
              <ChevronDown size={14} className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute right-0 top-full mt-2 w-48 rounded-lg overflow-hidden z-50 glass-card"
                >
                  {pools.map((id) => (
                    <button
                      key={id}
                      onClick={() => { setActivePlayer(id); setMenuOpen(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm flex items-center justify-between hover:bg-[rgba(212,212,212,0.06)] transition-colors"
                      style={{ color: activePlayerId === id ? '#d4d4d4' : '#b4b4b4' }}
                    >
                      {id}
                      {activePlayerId === id && <Check size={14} className="text-tide" />}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </div>
        )}

        <button
          onClick={refreshAll}
          className="flex items-center justify-center w-9 h-9 mr-1 text-wave hover:text-tide rounded-md hover:bg-white/[0.04] transition-all"
          title="刷新"
        >
          <RefreshCw size={15} />
        </button>

        <button
          onClick={handleMinimize}
          className="flex items-center justify-center w-12 h-full text-wave hover:text-tide-dim hover:bg-white/[0.04] transition-all"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={handleMaximize}
          className="flex items-center justify-center w-12 h-full text-wave hover:text-tide-dim hover:bg-white/[0.04] transition-all"
        >
          <Maximize2 size={12} />
        </button>
        <button
          onClick={handleClose}
          className="flex items-center justify-center w-12 h-full text-wave hover:text-white hover:bg-[rgba(255,80,80,0.2)] transition-all"
        >
          <X size={14} />
        </button>
      </div>
    </nav>
  );
}
