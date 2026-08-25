import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import Navbar from './components/Navbar';
import Toast from './components/Toast';
import StatusBar from './components/StatusBar';
import ResonancePulseLayer from './components/ResonancePulseLayer';
import ImportSummaryPanel from './components/ImportSummaryPanel';
import Home from './pages/Home';
import OcrImportPage from './pages/OcrImportPage';
import { useGachaStore } from './store/useGachaStore';
import { useUpdateStore } from './store/useUpdateStore';

const RecordsPage = lazy(() => import('./pages/RecordsPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function DeferredRoute({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>;
}

function RouteLoadingFallback() {
  return (
    <div className="route-loading-state" aria-busy="true" aria-label="正在加载页面">
      <div className="route-loading-line route-loading-line-wide" />
      <div className="route-loading-line route-loading-line-medium" />
      <div className="route-loading-grid"><span /><span /><span /></div>
    </div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <Routes location={location} key={location.pathname}>
      <Route path="/" element={<Home />} />
      <Route path="/records" element={<DeferredRoute><RecordsPage /></DeferredRoute>} />
      <Route path="/analytics" element={<DeferredRoute><AnalyticsPage /></DeferredRoute>} />
      <Route path="/settings" element={<DeferredRoute><SettingsPage /></DeferredRoute>} />
      <Route path="/ocr-import" element={<DeferredRoute><OcrImportPage /></DeferredRoute>} />
    </Routes>
  );
}

export default function App() {
  const toastMessages = useGachaStore((state) => state.toastMessages);
  const removeToast = useGachaStore((state) => state.removeToast);
  const fetchPools = useGachaStore((state) => state.fetchPools);
  const fetchSummaries = useGachaStore((state) => state.fetchSummaries);
  const fetchSettings = useGachaStore((state) => state.fetchSettings);
  const autoCheckUpdate = useUpdateStore(s => s.autoCheck);

  useEffect(() => {
    fetchSettings();
    fetchPools();
    fetchSummaries().catch(() => {});
    // Keep network/TLS work outside the first-screen animation window.
    const timer = window.setTimeout(() => { autoCheckUpdate(); }, 8000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <Router>
        <div className="app-shell relative flex h-screen flex-col">
          <ResonancePulseLayer />
          <Navbar />
          <main className="relative flex-1 overflow-hidden">
            <AnimatedRoutes />
          </main>
          <ImportSummaryPanel />
          <Toast messages={toastMessages} onRemove={removeToast} />
          <StatusBar />
        </div>
      </Router>
    </MotionConfig>
  );
}
