import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getVersion } from '@tauri-apps/api/app';

export default function StatusBar() {
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  return (
    <div
      className="flex items-center justify-between px-6 py-1.5 text-xs text-wave border-t border-[rgba(255,255,255,0.06)]"
      style={{ background: '#1a1a1a' }}
    >
      <div className="flex items-center gap-4">
        <span>Wuwa Gacha Tool{appVersion && ` v${appVersion}`}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-1.5 h-1.5 rounded-full bg-[#7ab88a]"
          />
          就绪
        </span>
      </div>
    </div>
  );
}
