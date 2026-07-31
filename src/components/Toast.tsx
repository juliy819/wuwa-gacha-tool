import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import type { ToastMessage } from '../types';

interface ToastProps {
  messages: ToastMessage[];
  onRemove: (id: string) => void;
}

export default function Toast({ messages, onRemove }: ToastProps) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      <AnimatePresence>
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, x: 100, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.9 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className={`relative overflow-hidden flex items-center gap-3 px-4 py-3 rounded-lg shadow-xl min-w-[250px] ${
              msg.type === 'success'
                ? 'bg-[#2a3a2e] border border-[#3a5a3f]'
                : msg.type === 'error'
                ? 'bg-[#3a2a2a] border border-[#5a3a3a]'
                : 'bg-[#2a2e3a] border border-[#3a3f5a]'
            }`}
          >
            {msg.type === 'success' && (
              <CheckCircle size={18} className="text-[#7ab88a]" />
            )}
            {msg.type === 'error' && (
              <XCircle size={18} className="text-[#b87a7a]" />
            )}
            {msg.type === 'info' && (
              <Info size={18} className="text-[#7a8ab8]" />
            )}
            <span className="text-sm text-tide flex-1">{msg.message}</span>
            <button
              onClick={() => onRemove(msg.id)}
              className="text-wave hover:text-tide transition-colors"
            >
              <X size={14} />
            </button>
            <div
              className="toast-progress absolute bottom-0 left-0 h-0.5"
              style={{
                background: msg.type === 'success' ? '#7ab88a' : msg.type === 'error' ? '#b87a7a' : '#7a8ab8',
              }}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
