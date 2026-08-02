import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import Navbar from './components/Navbar';
import Toast from './components/Toast';
import StatusBar from './components/StatusBar';
import PageTransition from './components/PageTransition';
import Home from './pages/Home';
import RecordsPage from './pages/RecordsPage';
import SettingsPage from './pages/SettingsPage';
import { useGachaStore } from './store/useGachaStore';
import { useUpdateStore } from './store/useUpdateStore';

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<PageTransition><Home /></PageTransition>} />
        <Route path="/records" element={<PageTransition><RecordsPage /></PageTransition>} />
        <Route path="/settings" element={<PageTransition><SettingsPage /></PageTransition>} />
      </Routes>
    </AnimatePresence>
  );
}

export default function App() {
  const { toastMessages, removeToast, fetchPools, fetchSummaries, fetchSettings } = useGachaStore();
  const autoCheckUpdate = useUpdateStore(s => s.autoCheck);

  useEffect(() => {
    fetchSettings();
    fetchPools();
    fetchSummaries().catch(() => {});
    // 延迟 3s 异步检查更新，避免与启动初始化抢资源
    const timer = setTimeout(() => { autoCheckUpdate(); }, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Router>
      <div className="h-screen flex flex-col relative" style={{ background: '#1f1f1f' }}>
        <Navbar />
        <main className="flex-1 overflow-hidden">
          <AnimatedRoutes />
        </main>
        <Toast messages={toastMessages} onRemove={removeToast} />
        <StatusBar />
      </div>
    </Router>
  );
}
