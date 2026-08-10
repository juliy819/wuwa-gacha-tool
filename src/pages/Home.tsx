import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { LoaderCircle } from 'lucide-react';
import HomeDashboard from '../components/HomeDashboard';
import PageTransition from '../components/PageTransition';
import Modal from '../components/Modal';
import ResonanceField from '../components/ResonanceField';
import ResonanceEmptyState from '../components/ResonanceEmptyState';
import ResonanceCloseButton from '../components/ResonanceCloseButton';
import ResonanceActionIcon from '../components/ResonanceActionIcon';
import ResonanceIcon from '../components/ResonanceModeIcon';
import { useClickRipple } from '../hooks/useClickRipple';
import { gachaApi } from '../services/tauri-api';
import { useGachaStore } from '../store/useGachaStore';
import type { CloudGachaLink } from '../types';

type ScanMode = 'dir' | 'cloud' | 'url' | 'json';

export default function Home() {
  const activePlayerId = useGachaStore((state) => state.activePlayerId);
  const addToast = useGachaStore((state) => state.addToast);
  const fetchStats = useGachaStore((state) => state.fetchStats);
  const fetchRecords = useGachaStore((state) => state.fetchRecords);
  const importJson = useGachaStore((state) => state.importJson);
  const initialized = useGachaStore((state) => state.initialized);
  const records = useGachaStore((state) => state.records);
  const recordsLoaded = useGachaStore((state) => state.recordsLoaded);
  const recordsPlayerId = useGachaStore((state) => state.recordsPlayerId);
  const scanGacha = useGachaStore((state) => state.scanGacha);
  const scanGachaByUrl = useGachaStore((state) => state.scanGachaByUrl);
  const scanning = useGachaStore((state) => state.scanning);
  const settings = useGachaStore((state) => state.settings);
  const stats = useGachaStore((state) => state.stats);
  const statsPlayerId = useGachaStore((state) => state.statsPlayerId);
  const createRipple = useClickRipple();
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanMode, setScanMode] = useState<ScanMode>('dir');
  const [gameDirInput, setGameDirInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [jsonPath, setJsonPath] = useState('');
  const [extractedUrl, setExtractedUrl] = useState('');
  const [extractingUrl, setExtractingUrl] = useState(false);
  const [urlExtractError, setUrlExtractError] = useState('');
  const [cloudLink, setCloudLink] = useState<CloudGachaLink | null>(null);
  const [cloudOpening, setCloudOpening] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const scanContentRef = useRef<HTMLDivElement>(null);
  const [scanContentHeight, setScanContentHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!showScanModal || !scanContentRef.current) return;
    const content = scanContentRef.current;
    const updateHeight = () => setScanContentHeight(content.offsetHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(content);
    return () => observer.disconnect();
  }, [scanMode, showScanModal]);

  useEffect(() => {
    if (!activePlayerId) return;
    if (statsPlayerId === activePlayerId) return;
    fetchStats(activePlayerId);
  }, [activePlayerId, fetchStats, statsPlayerId]);

  useEffect(() => {
    if (!activePlayerId) return;
    if (!recordsLoaded || recordsPlayerId !== activePlayerId) {
      const timer = window.setTimeout(() => {
        fetchRecords();
      }, 280);
      return () => window.clearTimeout(timer);
    }
  }, [activePlayerId, fetchRecords, recordsLoaded, recordsPlayerId]);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;

    const unlisteners: Array<() => void> = [];
    let cancelled = false;

    Promise.all([
      listen<CloudGachaLink>('cloud-gacha-link', (event) => {
        setCloudLink(event.payload);
        setCloudError('');
        setCloudOpening(false);
        addToast('success', `已从云鸣潮提取 UID ${event.payload.player_id} 的抽卡链接`);
        void gachaApi.closeCloudGachaWindow();
      }),
      listen<string>('cloud-gacha-error', (event) => {
        setCloudError(event.payload);
        setCloudOpening(false);
      }),
    ]).then((listeners) => {
      if (cancelled) {
        listeners.forEach((unlisten) => unlisten());
      } else {
        unlisteners.push(...listeners);
      }
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [addToast]);

  const openScanModal = () => {
    setGameDirInput(settings?.game_dir || '');
    setUrlInput('');
    setJsonPath('');
    setExtractedUrl('');
    setUrlExtractError('');
    setCloudLink(null);
    setCloudError('');
    setScanMode('dir');
    setShowScanModal(true);
  };

  const handleScanByDir = async () => {
    const dir = gameDirInput || settings?.game_dir || '';
    if (!dir) return;
    await scanGacha(dir);
    if (!useGachaStore.getState().error) setShowScanModal(false);
  };

  const handleScanByUrl = async () => {
    const url = urlInput.trim();
    if (!url) return;
    await scanGachaByUrl(url);
    if (!useGachaStore.getState().error) setShowScanModal(false);
  };

  const handleSelectJson = async () => {
    const selected = await open({ filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (selected) setJsonPath(selected as string);
  };

  const handleSelectGameDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: gameDirInput.trim() || settings?.game_dir || undefined,
    });
    if (typeof selected === 'string') setGameDirInput(selected);
  };

  const handleImportJson = async () => {
    if (!jsonPath) return;
    await importJson(jsonPath);
    if (!useGachaStore.getState().error) setShowScanModal(false);
  };

  const handleExtractUrl = async () => {
    const dir = gameDirInput.trim() || settings?.game_dir || '';
    if (!dir) return;
    setExtractingUrl(true);
    setUrlExtractError('');
    try {
      const url = await gachaApi.decodeLog(dir);
      setExtractedUrl(url);
    } catch (e) {
      setExtractedUrl('');
      setUrlExtractError(String(e));
    } finally {
      setExtractingUrl(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!extractedUrl) return;
    try {
      await navigator.clipboard.writeText(extractedUrl);
      addToast('success', '抽卡链接已复制');
    } catch {
      addToast('error', '复制失败');
    }
  };

  const handleOpenCloud = async () => {
    setCloudOpening(true);
    setCloudError('');
    try {
      await gachaApi.openCloudGachaWindow();
    } catch (e) {
      setCloudError(String(e));
    } finally {
      setCloudOpening(false);
    }
  };

  const handleCopyCloudUrl = async () => {
    if (!cloudLink) return;
    try {
      await navigator.clipboard.writeText(cloudLink.url);
      addToast('success', '云鸣潮抽卡链接已复制');
    } catch {
      addToast('error', '复制失败');
    }
  };

  const handleImportCloudUrl = async () => {
    if (!cloudLink) return;
    await scanGachaByUrl(cloudLink.url);
    if (!useGachaStore.getState().error) setShowScanModal(false);
  };

  return (
    <PageTransition>
      <div className="page-scroll h-full overflow-y-auto overflow-x-hidden">
        <div className="page-container home-page-container w-full space-y-5 p-6">
          <header className="page-header home-page-header relative flex items-end justify-between gap-4 overflow-hidden py-1">
            <ResonanceField />
            <div className="relative z-10">
              <h1 className="page-title text-xl font-semibold text-tide">抽卡概览</h1>
              <p className="page-subtitle mt-1 text-xs text-wave">重点数据按卡池独立统计</p>
            </div>
            <button onClick={(e) => { createRipple(e); openScanModal(); }} className="tide-btn click-ripple relative z-10 flex items-center gap-2 px-4 py-2">
              <ResonanceActionIcon size="sm" tone="gold"><ResonanceIcon kind="scan" size={14} /></ResonanceActionIcon>
              扫描抽卡
            </button>
          </header>

          {!initialized || (activePlayerId && statsPlayerId !== activePlayerId) ? (
            <div className="resonance-panel min-h-[360px]" aria-busy="true" aria-label="Loading gacha overview" />
          ) : stats && stats.total_draws > 0 ? (
            <HomeDashboard stats={stats} records={records} />
          ) : (
            <ResonanceEmptyState
              variant="scan"
              title="暂无抽卡数据"
              description="扫描游戏记录或导入已有 JSON 文件"
              className="resonance-panel min-h-[360px]"
            >
              <button onClick={(e) => { createRipple(e); openScanModal(); }} className="tide-btn click-ripple mt-1 flex items-center gap-2 px-4 py-2">
                <ResonanceActionIcon size="sm" tone="gold"><ResonanceIcon kind="scan" size={14} /></ResonanceActionIcon>
                开始扫描
              </button>
            </ResonanceEmptyState>
          )}
        </div>

        <Modal
          open={showScanModal}
          onClose={() => setShowScanModal(false)}
          closeDisabled={scanning || cloudOpening}
          className="max-w-[480px] p-6"
          labelledBy="scan-dialog-title"
          placement="top"
        >
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2 id="scan-dialog-title" className="modal-title text-lg font-semibold text-tide">扫描抽卡数据</h2>
                <ResonanceCloseButton onClick={() => setShowScanModal(false)} disabled={scanning || cloudOpening} />
              </div>

              <div className="resonance-segmented mb-4 flex items-center gap-1 p-0.5">
                {([
                  ['dir', '游戏目录', 'directory'],
                  ['cloud', '云鸣潮', 'cloud'],
                  ['url', '抽卡链接', 'coupling'],
                  ['json', '导入 JSON', 'ingress'],
                ] as const).map(([mode, label, iconKind]) => (
                  <button
                    key={mode}
                    onClick={() => setScanMode(mode)}
                    disabled={scanning}
                    className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs ${
                      scanMode === mode ? 'text-tide' : 'text-wave hover:text-tide-dim disabled:opacity-50'
                    }`}
                  >
                    {scanMode === mode && (
                      <motion.span
                        layoutId="scan-mode-indicator"
                        className="resonance-tab-indicator absolute inset-0"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      >
                        <span className="resonance-tab-surface" />
                      </motion.span>
                    )}
                    <ResonanceActionIcon size="sm" tone={scanMode === mode ? 'gold' : 'default'} framed={false} className="relative z-10">
                      <ResonanceIcon kind={iconKind} />
                    </ResonanceActionIcon>
                    <span className="relative z-10">{label}</span>
                  </button>
                ))}
              </div>

              <motion.div
                initial={false}
                animate={scanContentHeight === null ? undefined : { height: scanContentHeight }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
              <motion.div
                ref={scanContentRef}
                key={scanMode}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
              {scanMode === 'dir' && (
                <div className="space-y-2">
                  <p className="text-sm text-wave">请先在游戏中打开抽卡历史记录，再选择游戏安装目录。</p>
                  <div className="mt-3">
                    <label htmlFor="scan-game-dir" className="text-sm text-wave">游戏目录</label>
                    <div className="mt-1 flex gap-2">
                      <input
                        id="scan-game-dir"
                        type="text"
                        value={gameDirInput}
                        onChange={(event) => setGameDirInput(event.target.value)}
                        placeholder="例如: E:\Wuthering Waves\Wuthering Waves"
                        className="glass-input min-w-0 flex-1 px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={handleSelectGameDir}
                        disabled={scanning || extractingUrl}
                        className="glass-input flex shrink-0 items-center gap-1.5 px-3 text-xs text-wave hover:text-tide disabled:opacity-50"
                      >
                        <ResonanceIcon kind="directory" size={14} />选择
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-wave">目录下需要包含 Client/Saved/Logs/Client.log 文件</p>
                  </div>

                  <div className="mt-3">
                    <button
                      onClick={handleExtractUrl}
                      disabled={extractingUrl || !gameDirInput.trim()}
                      className="flex items-center gap-2 rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs text-wave transition-colors hover:text-tide disabled:opacity-50"
                    >
                      {extractingUrl ? <LoaderCircle size={12} className="animate-spin" /> : <ResonanceIcon kind="coupling" size={13} />}
                      {extractingUrl ? '提取中...' : '提取抽卡链接'}
                    </button>

                    {urlExtractError && (
                      <p className="mt-2 text-xs text-[#d99a9a]">{urlExtractError}</p>
                    )}

                    {extractedUrl && (
                      <div className="mt-2 flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-tide" title={extractedUrl}>{extractedUrl}</span>
                        <button onClick={handleCopyUrl} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-wave hover:bg-white/[0.05] hover:text-tide" title="复制链接">
                          <ResonanceIcon kind="copy" size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {scanMode === 'url' && (
                <div className="space-y-2">
                  <p className="text-sm text-wave">直接粘贴抽卡历史记录页面的完整链接。</p>
                  <label className="mt-3 block">
                    <span className="text-sm text-wave">抽卡链接</span>
                    <textarea
                      value={urlInput}
                      onChange={(event) => setUrlInput(event.target.value)}
                      placeholder="粘贴完整的抽卡记录链接"
                      rows={4}
                      className="glass-input mt-1 w-full resize-none px-3 py-2 font-mono text-sm"
                    />
                    <p className="mt-1 text-xs text-wave">链接需从游戏内抽卡历史记录页面获取</p>
                  </label>
                </div>
              )}

              {scanMode === 'cloud' && (
                <div className="space-y-3">
                  <div className="rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-wave">
                        <ResonanceIcon kind="cloud" size={17} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-tide">
                          {cloudLink ? '抽卡链接提取完成' : '从云鸣潮获取抽卡链接'}
                        </p>
                        {cloudLink ? (
                          <p className="mt-1 text-xs leading-5 text-wave">
                            已识别玩家 UID {cloudLink.player_id}，链接仅保留在当前窗口。
                          </p>
                        ) : (
                          <ol className="mt-2 space-y-1 text-xs leading-5 text-wave">
                            <li>1. 点击下方按钮打开云鸣潮。</li>
                            <li>2. 首次使用时，在云鸣潮窗口完成手机号验证码登录。</li>
                            <li>3. 登录成功后无需操作，程序会自动打开“工具 → 唤取记录”并提取链接。</li>
                          </ol>
                        )}
                      </div>
                    </div>

                    {!cloudLink && (
                      <div className="mt-3 flex items-start gap-2 border-t border-white/[0.06] pt-3 text-xs leading-5 text-[#d9b98c]">
                        <ResonanceIcon kind="warning" size={15} className="mt-0.5 shrink-0" />
                        <p>云鸣潮不支持多端同时登录。在本工具中登录，可能会使其他设备上的云鸣潮退出登录。</p>
                      </div>
                    )}
                  </div>

                  {cloudError && (
                    <p className="rounded-md border border-[#d99a9a]/20 bg-[#d99a9a]/[0.06] px-3 py-2 text-xs leading-5 text-[#d99a9a]">
                      {cloudError}
                    </p>
                  )}

                  {cloudLink && (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-sm text-wave">提取的抽卡链接</span>
                        <button
                          onClick={handleOpenCloud}
                          disabled={cloudOpening || scanning}
                          className="flex items-center gap-1 text-xs text-wave transition-colors hover:text-tide disabled:opacity-50"
                        >
                          <ResonanceIcon kind="refresh" size={12} />
                          重新获取
                        </button>
                      </div>
                      <div className="flex items-start gap-2 rounded-md border border-white/[0.06] bg-[#1d1d1d] px-3 py-2.5">
                        <p className="min-w-0 flex-1 break-all font-mono text-xs leading-5 text-tide" title={cloudLink.url}>
                          {cloudLink.url}
                        </p>
                        <button
                          onClick={handleCopyCloudUrl}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-wave transition-colors hover:bg-white/[0.05] hover:text-tide"
                          title="复制链接"
                        >
                          <ResonanceIcon kind="copy" size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {scanMode === 'json' && (
                <div className="space-y-2">
                  <p className="text-sm text-wave">从本地 JSON 文件导入已有抽卡数据。</p>
                  <div className="mt-3 space-y-2">
                    <span className="text-sm text-wave">JSON 文件</span>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={jsonPath}
                        onChange={(event) => setJsonPath(event.target.value)}
                        placeholder="选择或输入 JSON 文件路径"
                        className="glass-input flex-1 px-3 py-2 text-sm"
                      />
                      <button
                        onClick={handleSelectJson}
                        disabled={scanning}
                        className="rounded-lg border border-white/[0.1] px-3 py-2 text-sm text-wave transition-colors hover:text-tide disabled:opacity-50"
                      >
                        选择文件
                      </button>
                    </div>
                    <p className="text-xs text-wave">JSON 格式需与游戏抽卡接口的原始返回一致</p>
                  </div>
                </div>
              )}
              </motion.div>
              </motion.div>

              <div className="mt-4 flex gap-3 border-t border-white/[0.06] pt-4">
                <button
                  onClick={() => setShowScanModal(false)}
                  disabled={scanning}
                  className="flex-1 rounded-lg border border-white/[0.1] px-4 py-2 text-wave transition-colors hover:text-tide disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={scanMode === 'dir'
                    ? handleScanByDir
                    : scanMode === 'cloud'
                      ? cloudLink ? handleImportCloudUrl : handleOpenCloud
                      : scanMode === 'url'
                        ? handleScanByUrl
                        : handleImportJson}
                  disabled={scanning || cloudOpening || (scanMode === 'dir'
                    ? !gameDirInput.trim()
                    : scanMode === 'url'
                      ? !urlInput.trim()
                      : scanMode === 'json'
                        ? !jsonPath.trim()
                        : false)}
                  className="tide-btn flex flex-1 items-center justify-center gap-2 px-4 py-2 disabled:opacity-50"
                >
                  {scanning || cloudOpening ? (
                    <>
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                        <ResonanceActionIcon size="sm" tone="gold"><ResonanceIcon kind="scan" size={14} /></ResonanceActionIcon>
                      </motion.div>
                      {cloudOpening ? '正在打开...' : scanMode === 'dir' ? '扫描中...' : '导入中...'}
                    </>
                  ) : (
                    <>
                      <ResonanceActionIcon size="sm" tone="gold">
                      {scanMode === 'cloud' && !cloudLink
                        ? <ResonanceIcon kind="external" size={14} />
                        : scanMode === 'json'
                          ? <ResonanceIcon kind="ingress" size={14} />
                          : scanMode === 'url'
                            ? <ResonanceIcon kind="coupling" size={14} />
                            : <ResonanceIcon kind="scan" size={14} />}
                      </ResonanceActionIcon>
                      {scanMode === 'cloud'
                        ? cloudLink ? '导入此链接' : '打开云鸣潮'
                        : scanMode === 'json'
                          ? '开始导入'
                          : scanMode === 'url'
                            ? '导入链接'
                            : '开始扫描'}
                    </>
                  )}
                </button>
              </div>
        </Modal>
      </div>
    </PageTransition>
  );
}
