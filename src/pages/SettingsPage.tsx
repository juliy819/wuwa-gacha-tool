import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { open } from '@tauri-apps/plugin-dialog';
import { useGachaStore } from '../store/useGachaStore';
import PageTransition from '../components/PageTransition';
import { Save, FolderOpen, Info, Trash2 } from 'lucide-react';

export default function SettingsPage() {
  const { settings, fetchSettings, saveGameDir, clearRecords, fetchPools, pools } = useGachaStore();
  const [gameDirInput, setGameDirInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    if (settings) {
      setGameDirInput(settings.game_dir);
    }
  }, [settings]);

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

  const handleClearAll = () => {
    if (confirm('确定要清空所有玩家的全部抽卡记录吗？此操作不可撤销。')) {
      clearRecords();
      fetchPools();
    }
  };

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
                  <span className="text-sm text-tide">{poolId}</span>
                  <button
                    onClick={() => {
                      if (confirm(`确定要清空玩家 ${poolId} 的记录吗？`)) {
                        clearRecords(poolId);
                        fetchPools();
                      }
                    }}
                    className="text-xs text-[#e8a8a8] hover:text-[#e8c8c8] transition-colors"
                  >
                    清空
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleClearAll}
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
    </PageTransition>
  );
}
