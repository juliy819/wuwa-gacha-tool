import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { UI_RESONANCE_EVENT, type UiFeedbackTone } from '../lib/uiFeedback';

type PulseState = { id: number; tone: UiFeedbackTone };

export default function ResonancePulseLayer() {
  const [pulse, setPulse] = useState<PulseState | null>(null);

  useEffect(() => {
    const handlePulse = (event: Event) => {
      const tone = (event as CustomEvent<UiFeedbackTone>).detail;
      setPulse({ id: Date.now(), tone });
    };
    window.addEventListener(UI_RESONANCE_EVENT, handlePulse);
    return () => window.removeEventListener(UI_RESONANCE_EVENT, handlePulse);
  }, []);

  return (
    <AnimatePresence>
      {pulse ? (
        <motion.div
          key={pulse.id}
          className="app-resonance-pulse"
          data-tone={pulse.tone}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.86, times: [0, 0.24, 1], ease: [0.16, 1, 0.3, 1] }}
          onAnimationComplete={() => setPulse((current) => current?.id === pulse.id ? null : current)}
          aria-hidden="true"
        >
          <motion.span
            className="app-resonance-pulse-line"
            initial={{ x: '-18%' }}
            animate={{ x: '118%' }}
            transition={{ duration: 0.82, ease: [0.22, 0.61, 0.36, 1] }}
          />
          <span className="app-resonance-pulse-ring" />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
