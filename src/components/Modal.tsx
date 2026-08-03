import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../lib/utils';

interface ModalProps {
  open: boolean;
  children: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  className?: string;
  labelledBy?: string;
  placement?: 'center' | 'top';
}

const modalEase = [0.16, 1, 0.3, 1] as const;

export default function Modal({
  open,
  children,
  onClose,
  closeDisabled = false,
  className,
  labelledBy,
  placement = 'center',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  const lastChildrenRef = useRef(children);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  if (open) lastChildrenRef.current = children;

  useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled, onClose]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const autofocusTarget = panel.querySelector<HTMLElement>('[autofocus]');
      (autofocusTarget ?? panel).focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closeDisabledRef.current) {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <AnimatePresence
      initial={false}
      onExitComplete={() => {
        if (previouslyFocusedRef.current?.isConnected) previouslyFocusedRef.current.focus();
        previouslyFocusedRef.current = null;
      }}
    >
      {open && (
        <motion.div
          className={cn(
            'fixed inset-0 z-50 flex overflow-y-auto bg-black/65 px-4 backdrop-blur-[3px]',
            placement === 'top'
              ? 'items-start justify-center pb-8 pt-[clamp(56px,12vh,96px)]'
              : 'items-center justify-center py-8',
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{
            opacity: [1, 1, 0],
            transition: { duration: 0.3, times: [0, 0.18, 1], ease: [0.4, 0, 1, 1] },
          }}
          transition={{ duration: 0.2, ease: modalEase }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !closeDisabled) onClose();
          }}
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            className={cn(
              'glass-card resonance-modal relative w-full shrink-0 overflow-hidden outline-none shadow-[0_24px_80px_rgba(0,0,0,0.48),0_0_0_1px_rgba(255,255,255,0.025)]',
              className,
            )}
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{
              opacity: [1, 1, 0],
              y: [0, 1, 10],
              scale: [1, 0.998, 0.985],
              transition: { duration: 0.3, times: [0, 0.18, 1], ease: [0.4, 0, 1, 1] },
            }}
            transition={{ duration: 0.24, ease: modalEase }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
            {lastChildrenRef.current}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
