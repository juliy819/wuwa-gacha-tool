import { useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { AnimatePresence, motion, Reorder } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, Copy, Download, GripVertical, ImagePlus, LoaderCircle, Plus, RefreshCw, ScanSearch, Settings2, Trash2 } from 'lucide-react';
import DatePickerField from '../components/DatePickerField';
import Modal from '../components/Modal';
import ResourceIcon from '../components/ResourceIcon';
import ResonanceCloseButton from '../components/ResonanceCloseButton';
import ResonanceIcon from '../components/ResonanceModeIcon';
import Tooltip from '../components/Tooltip';
import { gachaApi } from '../services/tauri-api';
import { useGachaStore } from '../store/useGachaStore';
import type { GachaResource, OcrCandidateRow, OcrComponentStatus, OcrDownloadProgress, OcrImageSummary, OcrRecognitionProgress } from '../types';
import { POOL_TYPES } from '../types';

type ImportMode = 'screenshot' | 'manual';
type EditableRow = OcrCandidateRow & {
  manuallyConfirmed: boolean;
  pullsInput: string;
};
type PendingReset = { type: 'screenshots' };

const ROLE_POOLS = new Set(['1', '3', '5', '6', '7', '8', '10', '12']);
const STANDARD_CHARACTER_IDS = new Set([1104, 1203, 1301, 1405, 1503]);
const STANDARD_ROLE_POOLS = new Set(['3', '5', '6', '7']);
const STANDARD_WEAPON_IDS = new Set([
  21010015, 21020015, 21030015, 21040015, 21050015,
  21010045, 21020045, 21030045, 21040045, 21050045,
]);
const today = new Date();
const pad2 = (value: number) => String(value).padStart(2, '0');
const toDateInput = (value: Date) => `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;

function distributedTime(index: number, total: number, start: string, end: string) {
  const earliest = new Date(`${start}T00:00:00`).getTime();
  const latest = new Date(`${end}T23:59:59`).getTime();
  const ratio = total <= 1 ? 1 : 1 - index / (total - 1);
  const value = new Date(earliest + (latest - earliest) * ratio);
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())} ${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`;
}

function makeManualRow(resource: GachaResource, suffix: string | number = Date.now()): EditableRow {
  return {
    key: `manual-${suffix}`,
    source: '批量手动',
    strategy: 'manual',
    y: Number.MAX_SAFE_INTEGER,
    resource_id: resource.resource_id,
    resource_type: resource.resource_type,
    name: resource.name,
    pulls: 1,
    pullsInput: '1',
    ocr_confidence: 1,
    icon_inliers: 0,
    icon_margin: 0,
    high_confidence: true,
    manuallyConfirmed: true,
    alternatives: [],
  };
}

const expectedResourceType = (pool: string): GachaResource['resource_type'] => ROLE_POOLS.has(pool) ? 'role' : 'weapon';

function resourceFitsPool(row: Pick<EditableRow, 'resource_id' | 'resource_type'>, pool: string) {
  if (row.resource_type !== expectedResourceType(pool)) return false;
  if (STANDARD_ROLE_POOLS.has(pool)) return STANDARD_CHARACTER_IDS.has(row.resource_id);
  if (pool === '4') return STANDARD_WEAPON_IDS.has(row.resource_id);
  return true;
}

function inferCorePool(rows: EditableRow[]) {
  if (!rows.length) return null;
  const kinds = new Set(rows.map((row) => row.resource_type));
  if (kinds.size !== 1) return null;
  if (rows[0].resource_type === 'role') {
    return rows.every((row) => STANDARD_CHARACTER_IDS.has(row.resource_id)) ? '3' : '1';
  }
  return rows.every((row) => STANDARD_WEAPON_IDS.has(row.resource_id)) ? '4' : '2';
}

function hasConsecutiveStandardRoles(rows: EditableRow[], pool: string, index: number) {
  if (pool !== '1') return false;
  const current = rows[index];
  const previous = rows[index - 1];
  const next = rows[index + 1];
  return Boolean(current && STANDARD_CHARACTER_IDS.has(current.resource_id)
    && ((previous && STANDARD_CHARACTER_IDS.has(previous.resource_id))
      || (next && STANDARD_CHARACTER_IDS.has(next.resource_id))));
}

function hasStandardWeaponInFeaturedPool(row: EditableRow, pool: string) {
  return pool === '2' && STANDARD_WEAPON_IDS.has(row.resource_id);
}

export default function OcrImportPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const mode: ImportMode = params.get('mode') === 'manual' ? 'manual' : 'screenshot';
  const activePlayerId = useGachaStore((state) => state.activePlayerId);
  const [targetPlayerId, setTargetPlayerId] = useState(activePlayerId ?? '');
  const addToast = useGachaStore((state) => state.addToast);
  const refreshAll = useGachaStore((state) => state.refreshAll);
  const [pool, setPool] = useState('1');
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [images, setImages] = useState<OcrImageSummary[]>([]);
  const [resources, setResources] = useState<GachaResource[]>([]);
  const [start, setStart] = useState(toDateInput(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())));
  const [end, setEnd] = useState(toDateInput(today));
  const [recognizing, setRecognizing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingReset, setPendingReset] = useState<PendingReset | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [importError, setImportError] = useState('');
  const [inferredPool, setInferredPool] = useState<string | null>(null);
  const [component, setComponent] = useState<OcrComponentStatus | null>(null);
  const [componentBusy, setComponentBusy] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<OcrDownloadProgress | null>(null);
  const [removeConfirming, setRemoveConfirming] = useState(false);
  const [checkingComponentUpdate, setCheckingComponentUpdate] = useState(false);
  const [recognitionProgress, setRecognitionProgress] = useState<OcrRecognitionProgress | null>(null);
  const [allowDateOverlap, setAllowDateOverlap] = useState(false);
  const [dateOverlap, setDateOverlap] = useState<{ count: number; earliest: string; latest: string } | null>(null);

  const hardPity = pool === '5' ? 50 : 80;
  const fiveStarResources = useMemo(() => resources.filter((resource) => {
    if (resource.quality_level !== 5) return false;
    if (resource.name.startsWith('漂泊者')) return false;
    return true;
  }), [resources]);
  const resourcesById = useMemo(() => new Map(fiveStarResources.map((resource) => [resource.resource_id, resource])), [fiveStarResources]);
  const dates = useMemo(() => rows.map((_, index) => distributedTime(index, rows.length, start, end)), [end, rows, start]);
  const rowIsValid = (row: EditableRow) => /^\d+$/.test(row.pullsInput) && Number(row.pullsInput) >= 1 && Number(row.pullsInput) <= hardPity;
  const rowKnown = (row: EditableRow) => resourcesById.has(row.resource_id);
  const anomalyIndices = useMemo(() => new Set(rows.map((row, index) => index).filter((index) => hasConsecutiveStandardRoles(rows, pool, index) || hasStandardWeaponInFeaturedPool(rows[index], pool))), [pool, rows]);
  const rowNeedsReview = (row: EditableRow, index: number) => anomalyIndices.has(index)
    || (mode === 'screenshot' && (!rowKnown(row) || (!row.high_confidence && !row.manuallyConfirmed)));
  const reviewCount = rows.filter((row, index) => rowNeedsReview(row, index)).length;
  const mismatchCount = rows.filter((row) => !resourceFitsPool(row, pool)).length;
  const recognizedKinds = useMemo(() => new Set(rows.map((row) => row.resource_type)), [rows]);
  const invalidCount = rows.filter((row) => !rowIsValid(row)).length;
  const dateRangeValid = Boolean(start && end && start <= end);

  useEffect(() => {
    if (activePlayerId && !targetPlayerId) setTargetPlayerId(activePlayerId);
  }, [activePlayerId, targetPlayerId]);

  useEffect(() => {
    let cancelled = false;
    setDateOverlap(null);
    setAllowDateOverlap(false);
    if (!targetPlayerId.trim() || !dateRangeValid || !rows.length) return () => { cancelled = true; };
    void gachaApi.getAllRecords(targetPlayerId.trim()).then((records) => {
      if (cancelled) return;
      const inRange = records.filter((record) => record.card_pool_type === pool && record.time.slice(0, 10) >= start && record.time.slice(0, 10) <= end);
      if (!inRange.length) return;
      const times = inRange.map((record) => record.time).sort();
      setDateOverlap({ count: inRange.length, earliest: times[0].slice(0, 10), latest: times[times.length - 1].slice(0, 10) });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [dateRangeValid, end, pool, rows.length, start, targetPlayerId]);

  useEffect(() => {
    void gachaApi.getGachaResources().then(setResources).catch(() => setError('资源目录加载失败，请检查网络后重试'));
    if (mode === 'screenshot') {
      void gachaApi.getOcrComponentStatus().then((status) => {
        setComponent(status);
        if (!status.installed || !status.healthy) return;
        setCheckingComponentUpdate(true);
        void gachaApi.checkOcrComponentUpdate()
          .then((update) => setComponent((current) => current ? { ...current, latest_version: update.latest_version, update_available: update.update_available } : current))
          .finally(() => setCheckingComponentUpdate(false));
      }).catch((statusError) => setError(String(statusError)));
      let unlisten: (() => void) | undefined;
      void listen<OcrDownloadProgress>('ocr-download-progress', (event) => setDownloadProgress(event.payload))
        .then((dispose) => { unlisten = dispose; });
      let unlistenRecognition: (() => void) | undefined;
      void listen<OcrRecognitionProgress>('ocr-recognition-progress', (event) => setRecognitionProgress(event.payload))
        .then((dispose) => { unlistenRecognition = dispose; });
      return () => { unlisten?.(); unlistenRecognition?.(); };
    }
  }, [mode]);

  const installComponent = async () => {
    setComponentBusy(true);
    setDownloadProgress({ phase: 'manifest', downloaded: 0, total: null });
    setError('');
    try {
      setComponent(await gachaApi.installOcrComponent());
    } catch (installError) {
      setError(String(installError));
    } finally {
      setComponentBusy(false);
      setDownloadProgress(null);
    }
  };

  const removeComponent = async () => {
    setRemoveConfirming(false);
    setComponentBusy(true);
    setError('');
    try {
      setComponent(await gachaApi.removeOcrComponent());
    } catch (removeError) {
      setError(String(removeError));
    } finally {
      setComponentBusy(false);
    }
  };

  const updateRow = (key: string, patch: Partial<EditableRow>) => {
    setRows((value) => value.map((row) => row.key === key ? { ...row, ...patch } : row));
  };

  const moveRow = (index: number, offset: -1 | 1) => {
    setRows((value) => {
      const target = index + offset;
      if (target < 0 || target >= value.length) return value;
      const next = [...value];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const runScreenshotPicker = async () => {
    const selected = await open({ multiple: true, filters: [{ name: '截图', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (!paths.length) return;
    setRecognizing(true);
    setRecognitionProgress({ completed_images: 0, total_images: paths.length, recognized_rows: 0, source: '' });
    setConfirming(false);
    setError('');
    try {
      const result = await gachaApi.recognizeGachaScreenshots(paths);
      const recognizedRows = result.rows.map((row) => {
        const resource = resourcesById.get(row.resource_id);
        return {
          ...row,
          name: resource?.name ?? row.name,
          resource_type: resource?.resource_type ?? row.resource_type,
          pullsInput: String(row.pulls),
          manuallyConfirmed: false,
        };
      });
      const inferred = inferCorePool(recognizedRows);
      setRows(recognizedRows);
      if (inferred) setPool(inferred);
      setInferredPool(inferred);
      setImages(result.images);
      if (!result.rows.length) setError('没有检测到可识别的五星记录，请检查截图样式');
    } catch (recognitionError) {
      setRows([]);
      setImages([]);
      setInferredPool(null);
      setError(String(recognitionError));
    } finally {
      setRecognizing(false);
      setRecognitionProgress(null);
    }
  };

  const requestScreenshots = () => {
    if (rows.length) setPendingReset({ type: 'screenshots' });
    else void runScreenshotPicker();
  };

  const requestPool = (nextPool: string) => {
    setPool(nextPool);
    setInferredPool(null);
  };

  const confirmReset = () => {
    const action = pendingReset;
    setPendingReset(null);
    setRows([]);
    setImages([]);
    setError('');
    if (action?.type === 'screenshots') void runScreenshotPicker();
  };

  const changeResource = (row: EditableRow, resourceId: number) => {
    const resource = resourcesById.get(resourceId);
    if (!resource) return;
    setInferredPool(null);
    updateRow(row.key, { resource_id: resource.resource_id, resource_type: resource.resource_type, name: resource.name, manuallyConfirmed: true, high_confidence: true });
  };

  const addRow = () => {
    const resource = fiveStarResources.find((item) => item.resource_type === expectedResourceType(pool));
    if (resource) setRows((value) => [...value, makeManualRow(resource, `${Date.now()}-${value.length}`)]);
  };

  const duplicateRow = (row: EditableRow, index: number) => {
    const duplicate = { ...row, key: `copy-${Date.now()}-${index}`, source: '复制条目', manuallyConfirmed: true, high_confidence: true };
    setRows((value) => [...value.slice(0, index + 1), duplicate, ...value.slice(index + 1)]);
  };

  const importRows = async () => {
    if (!targetPlayerId.trim() || reviewCount || mismatchCount || invalidCount || !dateRangeValid || !rows.length || (dateOverlap && !allowDateOverlap)) return;
    setImporting(true);
    setImportError('');
    try {
      const requests = rows.map((row, index) => ({
        player_id: targetPlayerId.trim(),
        card_pool_type: pool,
        resource_id: row.resource_id,
        pulls: Number(row.pullsInput),
        time: dates[index],
      })).reverse();
      const result = await gachaApi.importOcrGachaRows(requests, allowDateOverlap);
      addToast('success', `已导入 ${result.five_star_count} 条五星，共写入 ${result.inserted_record_count} 条模拟记录`);
      setConfirming(false);
      setRows([]);
      setImages([]);
      await refreshAll();
    } catch (importError) {
      setImportError(String(importError));
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="batch-import-page h-full overflow-x-hidden overflow-y-auto px-5 py-5">
      <div className="mx-auto max-w-[1440px]">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.07] pb-4">
          <div className="flex min-w-0 items-start gap-3">
            <Tooltip content="返回首页"><button type="button" onClick={() => void navigate('/')} className="mt-0.5 flex h-8 w-8 items-center justify-center text-wave hover:text-tide" aria-label="返回首页"><ArrowLeft size={17} /></button></Tooltip>
            <div>
              <span className="inline-flex border border-white/[0.08] bg-white/[0.025] px-2 py-0.5 text-[10px] text-wave">{mode === 'screenshot' ? '截图识别' : '批量手动'}</span>
              <h1 className="mt-1.5 text-xl font-semibold text-tide">{mode === 'screenshot' ? '抽卡截图导入' : '批量手动导入'}</h1>
              <p className="mt-1 text-xs text-wave">{mode === 'screenshot' ? '识别后请核对五星、抽数与顺序，确认后再写入。' : '编辑多条五星与抽数，一次性生成模拟记录。'}</p>
            </div>
          </div>
          {mode === 'screenshot' ? (
            <button type="button" onClick={requestScreenshots} disabled={recognizing || importing || !fiveStarResources.length || !component?.healthy} className="tide-btn flex h-9 items-center gap-2 px-4 text-sm">
              {recognizing ? <LoaderCircle size={15} className="animate-spin" /> : <ImagePlus size={15} />}{recognizing ? '本地识别中' : rows.length ? '重新选择截图' : '选择截图'}
            </button>
          ) : (
            <button type="button" onClick={addRow} disabled={!fiveStarResources.length || importing} className="tide-btn flex h-9 items-center gap-2 px-4 text-sm"><Plus size={15} />添加记录</button>
          )}
        </header>

        <div className="mt-4 grid gap-4 md:grid-cols-[230px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <section className="border-b border-white/[0.07] pb-3">
              <h2 className="text-sm font-medium text-tide">导入范围</h2>
              <label className="mt-2.5 grid gap-1 text-xs text-wave">目标 UID
                <input value={targetPlayerId} onChange={(event) => setTargetPlayerId(event.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="请输入游戏 UID" className={`glass-input h-9 w-full px-3 text-sm text-tide ${targetPlayerId.trim() ? '' : '!border-amber-300/55'}`} />
              </label>
              <label className="mt-2.5 grid gap-1 text-xs text-wave">目标卡池
                <span className="relative block">
                  <select value={pool} onChange={(event) => requestPool(event.target.value)} className="glass-input h-9 w-full appearance-none px-3 pr-9 text-sm text-tide">
                    {POOL_TYPES.map((item) => <option key={item.type} value={item.type}>{item.name}</option>)}
                  </select>
                  <ResonanceIcon kind="chevron" size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-wave" />
                </span>
              </label>
              {inferredPool && <p className="mt-2 text-[11px] leading-5 text-[#a8d7cf]">已根据识别结果归类为“{POOL_TYPES.find((item) => item.type === inferredPool)?.name}”。</p>}
              {mode === 'screenshot' && rows.length > 0 && recognizedKinds.size > 1 && <p className="mt-2 text-[11px] leading-5 text-amber-300">同批结果同时包含角色和武器，未自动切换卡池，请逐条核对。</p>}
              <p className="mt-1.5 text-[11px] leading-4 text-wave">切换卡池不会修改或清空右侧记录。</p>
            </section>

            <section className="border-b border-white/[0.07] pb-3">
              <h2 className="text-sm font-medium text-tide">记录日期</h2>
              <div className="mt-2.5 grid grid-cols-2 gap-2"><DatePickerField label="最早" value={start} onChange={setStart} max={end} /><DatePickerField label="最晚" value={end} onChange={setEnd} min={start} /></div>
              <p className="mt-1.5 text-[11px] leading-4 text-wave">顶部为最新记录，日期随排序自动重算。</p>
            </section>

            {mode === 'screenshot' && <section>
              <h2 className="text-sm font-medium text-tide">OCR 组件</h2>
              {!component ? <div className="mt-2.5 flex items-center gap-2 text-xs text-wave"><LoaderCircle size={13} className="animate-spin" />正在检测本地环境</div> : component.healthy && !component.update_available ? (
                <details className="group mt-2.5">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-xs [&::-webkit-details-marker]:hidden">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" />
                    <span className="min-w-0 flex-1 truncate text-tide">已就绪 · {component.version}</span>
                    {checkingComponentUpdate ? <LoaderCircle size={12} className="shrink-0 animate-spin text-wave" /> : <Settings2 size={12} className="shrink-0 text-wave" />}
                    <ChevronDown size={12} className="shrink-0 text-wave transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-2.5 border-l border-white/[0.08] pl-3">
                    <button type="button" onClick={() => setRemoveConfirming(true)} className="flex h-7 items-center gap-1.5 text-[11px] text-wave hover:text-red-300"><Trash2 size={13} />删除本地组件</button>
                    <p className="mt-1.5 break-all text-[10px] leading-4 text-wave/70">{component.install_dir}</p>
                  </div>
                </details>
              ) : (
                <div className="mt-2.5">
                  <div className="flex items-center gap-2 text-xs"><span className={`h-1.5 w-1.5 rounded-full ${component.healthy ? 'bg-emerald-300' : component.supported ? 'bg-amber-300' : 'bg-red-400'}`} /><span className="text-tide">{component.healthy ? `已就绪 · ${component.version}` : component.supported ? component.installed ? '组件需要修复' : '尚未安装' : '当前环境不支持'}</span></div>
                  {checkingComponentUpdate && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-wave"><LoaderCircle size={11} className="animate-spin" />正在检查组件更新</p>}
                  {component.update_available && <div className="mt-2 border-l-2 border-[#8fc8be] bg-[#8fc8be]/[0.06] px-2.5 py-2 text-[11px] leading-5"><span className="block text-[#b8e1da]">发现 OCR 组件新版本</span><span className="text-wave">{component.version} → {component.latest_version}</span></div>}
                  {!component.healthy && <p className="mt-2 text-[11px] leading-5 text-wave">{component.reason}</p>}
                  {component.supported && (!component.healthy || component.update_available) && <>
                    <button type="button" disabled={componentBusy} onClick={() => void installComponent()} className="tide-btn mt-3 flex h-8 items-center gap-2 px-3 text-xs">{componentBusy ? <LoaderCircle size={13} className="animate-spin" /> : component.installed ? <RefreshCw size={13} /> : <Download size={13} />}{componentBusy ? '正在下载并校验' : component.update_available ? `更新至 ${component.latest_version}` : component.installed ? '修复组件' : '下载 OCR 组件'}</button>
                    {componentBusy && <div className="mt-2"><div className="flex justify-between text-[10px] text-wave"><span>{downloadProgress?.phase === 'manifest' ? '获取组件清单' : '下载 OCR 组件'}</span><span>{downloadProgress?.total ? `${Math.floor(downloadProgress.downloaded / downloadProgress.total * 100)}%` : '准备中'}</span></div><div className="mt-1 h-1.5 overflow-hidden bg-white/[0.08]"><div className="h-full bg-[#8fc8be] transition-[width] duration-200" style={{ width: downloadProgress?.total ? `${Math.min(100, downloadProgress.downloaded / downloadProgress.total * 100)}%` : '8%' }} /></div></div>}
                  </>}
                  {component.installed && !componentBusy && <button type="button" onClick={() => setRemoveConfirming(true)} className="mt-3 flex h-7 items-center gap-1.5 text-[11px] text-wave hover:text-red-300"><Trash2 size={13} />删除本地组件</button>}
                  <p className="mt-2 break-all text-[10px] leading-4 text-wave/70">{component.install_dir}</p>
                </div>
              )}
            </section>}
          </aside>

          <main className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <div><h2 className="text-sm font-medium text-tide">{mode === 'screenshot' ? '五星记录校验' : '五星记录'}</h2><p className="mt-1 text-xs text-wave">可修改、复制、拖拽排序或删除条目。</p></div>
              <button type="button" onClick={addRow} disabled={!fiveStarResources.length || importing} className="flex h-8 items-center gap-1.5 px-2 text-xs text-wave hover:text-tide"><Plus size={14} />添加</button>
            </div>

            {mode === 'screenshot' && <section className="mt-3 border border-white/[0.07] bg-white/[0.018] px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="font-medium text-tide">识别摘要</span>
                  {images.length ? <span className="truncate text-wave">{images.length} 张截图 · 共识别 {rows.length} 条五星</span> : <span className="text-wave">尚未选择截图</span>}
                </div>
                {rows.length > 0 && <div className="flex shrink-0 items-center gap-3 text-xs"><span className="text-tide"><strong className="mr-1 text-base">{rows.length}</strong>记录</span><span className="text-emerald-300"><strong className="mr-1 text-base">{rows.length - reviewCount}</strong>可导入</span><span className="text-amber-300"><strong className="mr-1 text-base">{reviewCount}</strong>待核对</span></div>}
              </div>
              {images.length > 0 && <div className="mt-2 flex max-h-8 flex-wrap gap-x-4 gap-y-1 overflow-y-auto border-t border-white/[0.06] pt-2 text-[11px] text-wave">{images.map((image) => <span key={`${image.source}-${image.strategy}`} className="max-w-full truncate" title={image.source}>{image.source} · {image.rows} 条</span>)}</div>}
            </section>}

            {error && <div className="mt-3 flex gap-2 border-l-2 border-red-400 bg-red-400/[0.06] px-3 py-2 text-xs text-red-200"><AlertTriangle size={15} className="shrink-0" />{error}</div>}
            {recognizing && <div className="mt-3 border border-white/[0.07] bg-white/[0.02] px-3 py-3"><div className="flex items-center justify-between gap-3 text-xs"><span className="flex min-w-0 items-center gap-2 text-tide"><LoaderCircle size={13} className="shrink-0 animate-spin" /><span className="truncate">{recognitionProgress?.strategy === 'starting' ? `正在启动 OCR 组件 · ${recognitionProgress.source}` : recognitionProgress?.total_images ? `正在分析 ${Math.min(recognitionProgress.completed_images + 1, recognitionProgress.total_images)}/${recognitionProgress.total_images} 张 · ${recognitionProgress.source}` : '正在初始化 OCR 引擎'}</span></span><span className="shrink-0 tabular-nums text-[#a8d7cf]">已识别 {recognitionProgress?.recognized_rows ?? 0} 条</span></div><div className="ocr-recognition-progress mt-2 h-1.5 overflow-hidden bg-white/[0.08]"><div className="h-full w-1/3 bg-[#8fc8be]" /></div></div>}

            <Reorder.Group axis="y" values={rows} onReorder={setRows} className="mt-3 space-y-2">
              <AnimatePresence initial={false}>{rows.map((row, index) => {
                const pullsValid = rowIsValid(row);
                const sequenceAnomaly = anomalyIndices.has(index);
                const needsReview = rowNeedsReview(row, index);
                const incompatible = !rowKnown(row) || !resourceFitsPool(row, pool);
                const expectedType = expectedResourceType(pool);
                const compatibleResources = fiveStarResources.filter((resource) => resource.resource_type === expectedType && resourceFitsPool(resource, pool));
                const currentResource = fiveStarResources.find((resource) => resource.resource_id === row.resource_id);
                const rowResources = currentResource && !compatibleResources.some((resource) => resource.resource_id === currentResource.resource_id)
                  ? [currentResource, ...compatibleResources]
                  : compatibleResources;
                return (
                  <Reorder.Item key={row.key} value={row} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 1, x: 0, height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }} transition={{ layout: { type: 'spring', stiffness: 430, damping: 34 }, opacity: { duration: 0.16 } }} onDragStart={() => setDraggingKey(row.key)} onDragEnd={() => setDraggingKey(null)} className={`batch-import-row ${mode === 'screenshot' ? 'batch-import-row-ocr' : 'batch-import-row-manual'} grid min-h-[72px] items-start gap-2 border px-2 py-2 ${draggingKey === row.key ? 'z-20 border-[#8fc8be]/50 bg-[#252a29] shadow-xl' : incompatible ? 'border-red-400/45 bg-red-400/[0.045]' : needsReview ? 'border-amber-300/30 bg-amber-300/[0.04]' : 'border-white/[0.07] bg-white/[0.018]'}`}>
                    <Tooltip content="拖拽调整顺序"><button type="button" className="flex h-9 w-6 place-self-center cursor-grab items-center justify-center text-wave active:cursor-grabbing" aria-label={`拖拽 ${row.name}`}><GripVertical size={15} /></button></Tooltip>
                    <ResourceIcon resourceId={row.resource_id} alt={row.name} className="h-11 w-11 self-center object-cover" fallback={<div className="flex h-11 w-11 self-center items-center justify-center bg-white/[0.06] text-xs text-wave">?</div>} />
                    <label className="grid min-w-0 gap-1 text-[10px] text-wave">角色/武器
                      <span className="relative block">
                        <select value={row.resource_id} onChange={(event) => changeResource(row, Number(event.target.value))} className="glass-input h-9 w-full appearance-none px-3 pr-9 text-sm text-tide">
                          {!resourcesById.has(row.resource_id) && <option value={row.resource_id}>{row.name}（素材待更新）</option>}
                          {rowResources.map((resource) => <option key={resource.resource_id} value={resource.resource_id}>{resource.name}</option>)}
                        </select>
                        <ResonanceIcon kind="chevron" size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-wave" />
                      </span>
                    </label>
                    <label className="grid gap-1 text-[10px] text-wave">抽数
                      <Tooltip content={pullsValid ? `1 至 ${hardPity} 抽` : `请输入 1 至 ${hardPity} 的整数`}>
                        <input type="text" inputMode="numeric" value={row.pullsInput} onFocus={(event) => event.currentTarget.select()} onChange={(event) => { if (/^\d*$/.test(event.target.value)) updateRow(row.key, { pullsInput: event.target.value, manuallyConfirmed: true }); }} className={`glass-input h-9 w-full px-3 text-sm tabular-nums text-tide ${pullsValid ? '' : '!border-red-400/70 bg-red-400/[0.05]'}`} aria-invalid={!pullsValid} />
                      </Tooltip>
                    </label>
                    <div className="min-w-0 pt-0.5 text-[10px] text-wave"><span className="block">日期/顺序</span><span className="mt-1 block tabular-nums text-tide">{dates[index]?.slice(0, 10)}</span><span className="mt-1 block truncate">第 {index + 1} 条 · {index === 0 ? '最新' : index === rows.length - 1 ? '最早' : '按顺序分布'}</span></div>
                    {mode === 'screenshot' && (incompatible
                      ? <Tooltip content={rowKnown(row) ? '记录类型与当前卡池不匹配，切换卡池或修改记录后才能导入' : '本地素材目录尚无此资源，请刷新素材或改选已知资源'}><span className="mt-5 flex h-8 items-center justify-center gap-1 text-[11px] text-red-300"><AlertTriangle size={13} />{rowKnown(row) ? '池子不匹配' : '素材待更新'}</span></Tooltip>
                      : <Tooltip content={sequenceAnomaly ? pool === '2' ? '角色活动池中出现常驻五星武器，请检查卡池和资源' : '角色活动池中出现相邻常驻五星，请检查角色、卡池和记录顺序' : needsReview ? '头像匹配不够明确，请核对后点击确认' : '头像与本地模板匹配明确'}><button type="button" onClick={() => updateRow(row.key, { manuallyConfirmed: true })} className={`mt-5 flex h-8 items-center justify-center gap-1 text-[11px] ${needsReview ? 'text-amber-300' : 'text-emerald-300'}`}>{needsReview ? <AlertTriangle size={13} /> : <Check size={13} />}{sequenceAnomaly ? '序列异常' : needsReview ? '请核对' : '已确认'}</button></Tooltip>)}
                    <div className="mt-5 flex items-center justify-end">
                      <Tooltip content="复制"><button type="button" onClick={() => duplicateRow(row, index)} className="flex h-8 w-7 items-center justify-center text-wave hover:text-tide" aria-label={`复制 ${row.name}`}><Copy size={13} /></button></Tooltip>
                      <Tooltip content="上移"><button type="button" disabled={index === 0} onClick={() => moveRow(index, -1)} className="flex h-8 w-7 items-center justify-center text-wave hover:text-tide disabled:opacity-25" aria-label={`上移 ${row.name}`}><ArrowUp size={13} /></button></Tooltip>
                      <Tooltip content="下移"><button type="button" disabled={index === rows.length - 1} onClick={() => moveRow(index, 1)} className="flex h-8 w-7 items-center justify-center text-wave hover:text-tide disabled:opacity-25" aria-label={`下移 ${row.name}`}><ArrowDown size={13} /></button></Tooltip>
                      <Tooltip content="删除"><button type="button" onClick={() => setRows((value) => value.filter((item) => item.key !== row.key))} className="flex h-8 w-7 items-center justify-center text-wave hover:text-red-300" aria-label={`删除 ${row.name}`}><Trash2 size={14} /></button></Tooltip>
                    </div>
                  </Reorder.Item>
                );
              })}</AnimatePresence>
            </Reorder.Group>

            {!rows.length && <div className="mt-3 flex min-h-[300px] flex-col items-center justify-center border border-dashed border-white/[0.1] text-center"><ScanSearch size={27} className="text-wave" /><p className="mt-3 text-sm text-tide">{mode === 'screenshot' ? component?.healthy ? '选择截图开始本地识别' : '安装并通过 OCR 组件检测后即可识别' : '添加第一条五星记录'}</p><button type="button" disabled={mode === 'screenshot' && !component?.healthy} onClick={mode === 'screenshot' ? requestScreenshots : addRow} className="mt-3 flex items-center gap-1.5 text-xs text-[#a8d7cf] disabled:text-wave/50"><Plus size={13} />{mode === 'screenshot' ? '选择截图' : '添加记录'}</button></div>}

            {rows.length > 0 && <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4"><div className="text-xs text-wave">目标 UID：<span className="text-tide">{targetPlayerId.trim() || '未填写'}</span> · {rows.length} 条五星{reviewCount > 0 && <span className="ml-2 text-amber-300">仍有 {reviewCount} 条需核对</span>}{anomalyIndices.size > 0 && <span className="ml-2 text-amber-300">{anomalyIndices.size} 条序列异常</span>}{mismatchCount > 0 && <span className="ml-2 text-red-300">{mismatchCount} 条与卡池不匹配</span>}{invalidCount > 0 && <span className="ml-2 text-red-300">仍有 {invalidCount} 条抽数无效</span>}</div><button type="button" onClick={() => { setImportError(''); setConfirming(true); }} disabled={!targetPlayerId.trim() || reviewCount > 0 || mismatchCount > 0 || invalidCount > 0 || !dateRangeValid || importing} className="tide-btn h-9 px-5 text-sm disabled:opacity-40">生成导入确认</button></footer>}
          </main>
        </div>
      </div>

      <Modal open={removeConfirming} onClose={() => setRemoveConfirming(false)} className="max-w-[440px]" labelledBy="ocr-remove-title">
        <div className="flex items-start justify-between border-b border-white/[0.06] p-5"><div><h2 id="ocr-remove-title" className="modal-title text-base font-medium text-tide">删除本地 OCR 组件？</h2><p className="mt-2 text-xs leading-5 text-wave">将删除本地 OCR runtime、模型和头像模板，不会影响抽卡记录、资源包或其他设置。之后再次进行截图识别时需要重新下载。</p></div><ResonanceCloseButton onClick={() => setRemoveConfirming(false)} /></div>
        <div className="flex justify-end gap-2 p-4"><button type="button" onClick={() => setRemoveConfirming(false)} className="h-9 px-4 text-sm text-wave hover:text-tide">取消</button><button type="button" onClick={() => void removeComponent()} className="flex h-9 items-center gap-2 border border-red-300/30 px-4 text-sm text-red-200 hover:bg-red-300/[0.08]"><Trash2 size={14} />删除组件</button></div>
      </Modal>

      <Modal open={pendingReset !== null} onClose={() => setPendingReset(null)} className="max-w-[440px]" labelledBy="batch-reset-title">
        <div className="flex items-start justify-between border-b border-white/[0.06] p-5"><div><h2 id="batch-reset-title" className="modal-title text-base font-medium text-tide">放弃当前编辑？</h2><p className="mt-2 text-xs leading-5 text-wave">这个操作会清空已识别、新增和修改的 {rows.length} 条记录，无法撤销。</p></div><ResonanceCloseButton onClick={() => setPendingReset(null)} /></div>
        <div className="flex justify-end gap-2 p-4"><button type="button" onClick={() => setPendingReset(null)} className="h-9 px-4 text-sm text-wave hover:text-tide">继续编辑</button><button type="button" onClick={confirmReset} className="tide-btn h-9 px-4 text-sm">放弃并继续</button></div>
      </Modal>

      <Modal open={confirming} onClose={() => { if (!importing) { setImportError(''); setConfirming(false); } }} closeDisabled={importing} className="max-w-[520px]" labelledBy="batch-confirm-title">
        <div className="flex items-start justify-between border-b border-white/[0.06] p-5"><div><h2 id="batch-confirm-title" className="modal-title text-base font-medium text-tide">确认写入模拟记录</h2><p className="mt-2 text-sm leading-6 text-wave">将向 UID {targetPlayerId.trim() || '未填写'} 的“{POOL_TYPES.find((item) => item.type === pool)?.name}”插入 {rows.length} 条五星，并自动补足每段抽数。</p></div><ResonanceCloseButton onClick={() => setConfirming(false)} disabled={importing} /></div>
        <dl className="grid grid-cols-2 gap-3 p-5 text-xs"><div><dt className="text-wave">日期范围</dt><dd className="mt-1 text-tide">{start} 至 {end}</dd></div><div><dt className="text-wave">校验状态</dt><dd className="mt-1 text-emerald-300">全部通过</dd></div><div><dt className="text-wave">写入顺序</dt><dd className="mt-1 text-tide">从列表底部到顶部</dd></div><div><dt className="text-wave">数据类型</dt><dd className="mt-1 text-tide">模拟记录</dd></div></dl>
        {dateOverlap && <label className="mx-5 mb-4 flex items-start gap-2 border-l-2 border-amber-300/55 bg-amber-300/[0.06] px-3 py-2 text-xs leading-5 text-amber-100"><input type="checkbox" checked={allowDateOverlap} onChange={(event) => setAllowDateOverlap(event.target.checked)} className="mt-1 accent-amber-300" /><span>目标 UID 的“{POOL_TYPES.find((item) => item.type === pool)?.name}”已有 {dateOverlap.count} 条记录落在 {dateOverlap.earliest} 至 {dateOverlap.latest}，与本次日期范围重叠。我确认仍要导入，并会检查导入后的抽数顺序。</span></label>}
        {importError && <div className="mx-5 mb-4 flex gap-2 border-l-2 border-red-400 bg-red-400/[0.06] px-3 py-2 text-xs leading-5 text-red-200"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{importError}</span></div>}
        <div className="flex justify-end gap-2 border-t border-white/[0.06] p-4"><button type="button" disabled={importing} onClick={() => { setImportError(''); setConfirming(false); }} className="h-9 px-4 text-sm text-wave">返回校验</button><button type="button" disabled={importing || Boolean(dateOverlap && !allowDateOverlap)} onClick={() => void importRows()} className="tide-btn flex h-9 min-w-[116px] items-center justify-center gap-2 px-4 text-sm disabled:opacity-40">{importing && <LoaderCircle size={14} className="animate-spin" />}{importing ? '正在写入' : '确认导入'}</button></div>
      </Modal>
    </section>
  );
}
