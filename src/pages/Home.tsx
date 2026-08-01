import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { open } from '@tauri-apps/plugin-dialog';
import { Clipboard, Folder, Link, LoaderCircle, Scan, Sparkles, Upload } from 'lucide-react';
import HomeDashboard from '../components/HomeDashboard';
import PageTransition from '../components/PageTransition';
import { useClickRipple } from '../hooks/useClickRipple';
import { gachaApi } from '../services/tauri-api';
import { useGachaStore } from '../store/useGachaStore';

type ScanMode = 'dir' | 'url' | 'json';

export default function Home() {
  const {
    activePlayerId,
    addToast,
    fetchStats,
    fetchRecords,
    fetchPools,
    fetchSettings,
    importJson,
    records,
    scanGacha,
    scanGachaByUrl,
    scanning,
    settings,
    stats,
  } = useGachaStore();
  const createRipple = useClickRipple();
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanMode, setScanMode] = useState<ScanMode>('dir');
  const [gameDirInput, setGameDirInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [jsonPath, setJsonPath] = useState('');
  const [extractedUrl, setExtractedUrl] = useState('');
  const [extractingUrl, setExtractingUrl] = useState(false);
  const [urlExtractError, setUrlExtractError] = useState('');

  useEffect(() => {
    fetchSettings();
    fetchPools();
  }, []);

  useEffect(() => {
    if (!activePlayerId) return;
    fetchStats(activePlayerId);
    fetchRecords();
  }, [activePlayerId]);

  const openScanModal = () => {
    setGameDirInput(settings?.game_dir || '');
    setUrlInput('');
    setJsonPath('');
    setExtractedUrl('');
    setUrlExtractError('');
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

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto overflow-x-hidden">
        <div className="mx-auto max-w-7xl space-y-5 p-6">
          <header className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-tide">抽卡概览</h1>
              <p className="mt-1 text-xs text-wave">重点数据按卡池独立统计</p>
            </div>
            <button onClick={(e) => { createRipple(e); openScanModal(); }} className="tide-btn click-ripple flex items-center gap-2 px-4 py-2">
              <Scan size={16} />
              扫描抽卡
            </button>
          </header>

          {stats && stats.total_draws > 0 ? (
            <HomeDashboard stats={stats} records={records} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-white/[0.06] bg-[#242424] p-12">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.04]">
                <Sparkles size={24} className="text-wave" />
              </div>
              <div className="text-center">
                <h2 className="text-base font-medium text-tide">暂无抽卡数据</h2>
                <p className="mt-1 text-sm text-wave">扫描游戏记录或导入已有 JSON 文件</p>
              </div>
              <button onClick={(e) => { createRipple(e); openScanModal(); }} className="tide-btn click-ripple mt-1 flex items-center gap-2 px-4 py-2">
                <Scan size={16} />
                开始扫描
              </button>
            </div>
          )}
        </div>

        {showScanModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => !scanning && setShowScanModal(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="glass-card w-[480px] p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 className="mb-4 text-lg font-semibold text-tide">扫描抽卡数据</h2>

              <div className="mb-4 flex items-center gap-1 rounded-lg border border-white/[0.04] bg-white/[0.04] p-0.5">
                {([
                  ['dir', '游戏目录', Folder],
                  ['url', '抽卡链接', Link],
                  ['json', '导入 JSON', Upload],
                ] as const).map(([mode, label, Icon]) => (
                  <button
                    key={mode}
                    onClick={() => setScanMode(mode)}
                    disabled={scanning}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs transition-colors ${
                      scanMode === mode ? 'bg-white/[0.08] text-tide' : 'text-wave hover:text-tide-dim disabled:opacity-50'
                    }`}
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
              </div>

              {scanMode === 'dir' && (
                <div className="space-y-2">
                  <p className="text-sm text-wave">请先在游戏中打开抽卡历史记录，再选择游戏安装目录。</p>
                  <label className="mt-3 block">
                    <span className="text-sm text-wave">游戏目录</span>
                    <input
                      type="text"
                      value={gameDirInput}
                      onChange={(event) => setGameDirInput(event.target.value)}
                      placeholder="例如: E:\Wuthering Waves\Wuthering Waves"
                      className="glass-input mt-1 w-full px-3 py-2 text-sm"
                    />
                    <p className="mt-1 text-xs text-wave">目录下需要包含 Client/Saved/Logs/Client.log 文件</p>
                  </label>

                  <div className="mt-3">
                    <button
                      onClick={handleExtractUrl}
                      disabled={extractingUrl || !gameDirInput.trim()}
                      className="flex items-center gap-2 rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs text-wave transition-colors hover:text-tide disabled:opacity-50"
                    >
                      {extractingUrl ? <LoaderCircle size={12} className="animate-spin" /> : <Link size={12} />}
                      {extractingUrl ? '提取中...' : '提取抽卡链接'}
                    </button>

                    {urlExtractError && (
                      <p className="mt-2 text-xs text-[#d99a9a]">{urlExtractError}</p>
                    )}

                    {extractedUrl && (
                      <div className="mt-2 flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-tide" title={extractedUrl}>{extractedUrl}</span>
                        <button onClick={handleCopyUrl} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-wave hover:bg-white/[0.05] hover:text-tide" title="复制链接">
                          <Clipboard size={12} />
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

              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setShowScanModal(false)}
                  disabled={scanning}
                  className="flex-1 rounded-lg border border-white/[0.1] px-4 py-2 text-wave transition-colors hover:text-tide disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={scanMode === 'dir' ? handleScanByDir : scanMode === 'url' ? handleScanByUrl : handleImportJson}
                  disabled={scanning || (scanMode === 'dir' ? !gameDirInput.trim() : scanMode === 'url' ? !urlInput.trim() : !jsonPath.trim())}
                  className="tide-btn flex flex-1 items-center justify-center gap-2 px-4 py-2 disabled:opacity-50"
                >
                  {scanning ? (
                    <>
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                        <Scan size={16} />
                      </motion.div>
                      {scanMode === 'json' ? '导入中...' : '扫描中...'}
                    </>
                  ) : (
                    <>
                      <Scan size={16} />
                      {scanMode === 'json' ? '开始导入' : '开始扫描'}
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </div>
    </PageTransition>
  );
}
