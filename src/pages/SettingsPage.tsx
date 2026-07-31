import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { open } from '@tauri-apps/plugin-dialog';
import { useGachaStore } from '../store/useGachaStore';
import { gachaApi } from '../services/tauri-api';
import PageTransition from '../components/PageTransition';
import { Save, FolderOpen, Info, Trash2, AlertTriangle, X } from 'lucide-react';
import type { RecordSummary } from '../types';

type DeleteTarget = { playerId: string | null };

export default function SettingsPage() {
  const { settings, fetchSettings, saveGameDir, clearRecords, pools } = useGachaStore();
  const [gameDirInput, setGameDirInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [summaries, setSummaries] = useState<RecordSummary[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [confirmationText, setConfirmationText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    if (settings) {
      setGameDirInput(settings.game_dir);
    }
  }, [settings]);

  useEffect(() => {
    if (pools.length === 0) {
      setSummaries([]);
      return;
    }
    gachaApi.getRecordSummaries().then(setSummaries).catch(() => setSummaries([]));
  }, [pools]);

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择鸣潮游戏目录',
      });
      if (selected) {
        setGameDirInput(selected);
      }
    } catch (e) {
      console.error('选择目录失败', e);
    }
  };

  const handleSave = async () => {
    if (!gameDirInput.trim()) return;
    setSaving(true);
    try {
      await saveGameDir(gameDirInput.trim());
    } catch {
      // toast 已在 store 中处理
    } finally {
      setSaving(false);
    }
  };

  const openDeleteDialog = (playerId: string | null) => {
    setConfirmationText('');
    setDeleteTarget({ playerId });
  };

  const closeDeleteDialog = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setConfirmationText('');
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await clearRecords(deleteTarget.playerId ?? undefined);
    setDeleting(false);
    if (result) {
      setDeleteTarget(null);
      setConfirmationText('');
    }
  };

  const selectedSummary = deleteTarget?.playerId
    ? summaries.find((summary) => summary.player_id === deleteTarget.playerId)
    : null;
  const totalRecords = summaries.reduce((sum, summary) => sum + summary.record_count, 0);
  const expectedConfirmation = deleteTarget?.playerId ?? '清空全部数据';
  const targetRecordCount = deleteTarget?.playerId
    ? selectedSummary?.record_count ?? 0
    : totalRecords;
  const targetTimeRange = selectedSummary
    ? `${selectedSummary.earliest_time} 至 ${selectedSummary.latest_time}`
    : summaries.length > 0
      ? `${summaries.reduce((min, item) => item.earliest_time < min ? item.earliest_time : min, summaries[0].earliest_time)} 至 ${summaries.reduce((max, item) => item.latest_time > max ? item.latest_time : max, summaries[0].latest_time)}`
      : '';

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto overflow-x-hidden">
        <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-tide">设置</h1>
          <p className="text-sm text-wave mt-1">配置应用选项</p>
        </div>

        {/* 游戏目录设置 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-5"
        >
          <h3 className="text-base font-medium text-tide mb-2 flex items-center gap-2">
            <FolderOpen size={18} />
            游戏目录
          </h3>
          <p className="text-sm text-wave mb-4">
            设置鸣潮游戏的安装目录，用于扫描 Client.log 文件获取抽卡链接。
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-sm text-wave mb-2">游戏目录路径</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={gameDirInput}
                  onChange={(e) => setGameDirInput(e.target.value)}
                  placeholder="例如: E:\Wuthering Waves\Wuthering Waves"
                  className="flex-1 glass-input px-4 py-2.5 text-sm"
                />
                <button
                  onClick={handleSelectFolder}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg glass-input hover:text-tide transition-colors text-sm whitespace-nowrap"
                >
                  <FolderOpen size={14} />
                  选择
                </button>
              </div>
              <p className="text-xs text-wave mt-1">
                目录下需要包含 <code className="text-tide">Client\Saved\Logs\Client.log</code> 文件
              </p>
            </div>

            <button
              onClick={handleSave}
              disabled={saving || !gameDirInput.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg tide-btn disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </motion.div>

        {/* 数据管理 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card p-5"
        >
          <h3 className="text-base font-medium text-tide mb-2 flex items-center gap-2">
            <Info size={18} />
            数据管理
          </h3>
          <p className="text-sm text-wave mb-4">
            当前已保存 <span className="text-tide font-medium">{pools.length}</span> 位玩家的抽卡记录
          </p>

          {pools.length > 0 && (
            <div className="space-y-2 mb-4">
              {pools.map((poolId) => (
                <div
                  key={poolId}
                  className="flex items-center justify-between p-3 rounded-lg bg-[rgba(212,212,212,0.03)]"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-tide">UID {poolId}</div>
                    {summaries.find((summary) => summary.player_id === poolId) && (
                      <div className="text-xs text-wave mt-1">
                        {summaries.find((summary) => summary.player_id === poolId)?.record_count} 条
                        <span className="mx-1.5 text-[rgba(212,212,212,0.2)]">|</span>
                        {summaries.find((summary) => summary.player_id === poolId)?.earliest_time.slice(0, 10)} 至 {summaries.find((summary) => summary.player_id === poolId)?.latest_time.slice(0, 10)}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => openDeleteDialog(poolId)}
                    className="flex items-center gap-1.5 text-xs text-[#e8a8a8] hover:text-[#e8c8c8] transition-colors"
                  >
                    <Trash2 size={12} /> 删除记录
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => openDeleteDialog(null)}
            disabled={pools.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[rgba(255,100,100,0.3)] text-[#e8a8a8] hover:bg-[rgba(255,100,100,0.1)] transition-colors text-sm disabled:opacity-30"
          >
            <Trash2 size={14} />
            清空所有数据
          </button>
        </motion.div>

        {/* 关于 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-card p-5"
        >
          <h3 className="text-base font-medium text-tide mb-2">关于</h3>
          <div className="text-sm text-wave space-y-2">
            <p>鸣潮抽卡分析工具 v0.1.0</p>
            <p>本工具用于扫描和分析鸣潮游戏的抽卡记录数据。</p>
            <p>所有数据均存储在本地，不会上传到任何服务器。</p>
          </div>
        </motion.div>
        </div>
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
          <div className="w-full max-w-md rounded-lg border border-[rgba(255,100,100,0.28)] bg-[#242424] shadow-2xl">
            <div className="flex items-start justify-between border-b border-[rgba(255,255,255,0.06)] p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-md bg-[rgba(255,100,100,0.1)] p-2 text-[#e8a8a8]">
                  <AlertTriangle size={18} />
                </div>
                <div>
                  <h2 id="delete-dialog-title" className="text-base font-medium text-tide">
                    {deleteTarget.playerId ? `删除 UID ${deleteTarget.playerId} 的记录` : '清空所有抽卡记录'}
                  </h2>
                  <p className="mt-1 text-xs text-wave">删除前会自动创建完整数据库备份</p>
                </div>
              </div>
              <button onClick={closeDeleteDialog} disabled={deleting} className="p-1 text-wave hover:text-tide disabled:opacity-40" title="关闭">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3 border-y border-[rgba(255,255,255,0.06)] py-3 text-sm">
                <div>
                  <div className="text-xs text-wave">记录数量</div>
                  <div className="mt-1 font-medium text-tide">{targetRecordCount} 条</div>
                </div>
                <div>
                  <div className="text-xs text-wave">涉及玩家</div>
                  <div className="mt-1 font-medium text-tide">{deleteTarget.playerId ? 1 : pools.length} 位</div>
                </div>
                {targetTimeRange && (
                  <div className="col-span-2">
                    <div className="text-xs text-wave">记录范围</div>
                    <div className="mt-1 text-tide">{targetTimeRange}</div>
                  </div>
                )}
              </div>

              <label className="block">
                <span className="mb-2 block text-xs text-wave">
                  输入 <span className="font-medium text-[#e8a8a8]">{expectedConfirmation}</span> 确认删除
                </span>
                <input
                  autoFocus
                  value={confirmationText}
                  onChange={(event) => setConfirmationText(event.target.value)}
                  className="glass-input w-full px-3 py-2 text-sm"
                />
              </label>

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={closeDeleteDialog} disabled={deleting} className="px-4 py-2 text-sm text-wave hover:text-tide disabled:opacity-40">
                  取消
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={deleting || confirmationText !== expectedConfirmation}
                  className="flex items-center gap-2 rounded-md bg-[#a64f4f] px-4 py-2 text-sm text-white hover:bg-[#b85a5a] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Trash2 size={14} />
                  {deleting ? '备份并删除中...' : '备份并删除'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageTransition>
  );
}
