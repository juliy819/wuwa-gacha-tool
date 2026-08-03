import { motion } from 'framer-motion';
import { cn } from '../lib/utils';

type PageSignalFieldProps = {
  variant: 'records' | 'settings';
  className?: string;
};

const drawTransition = { duration: 0.72, ease: [0.16, 1, 0.3, 1] as const };

export default function PageSignalField({ variant, className }: PageSignalFieldProps) {
  const pathMotion = { pathLength: [0, 1], opacity: [0, 1] };

  if (variant === 'records') {
    return (
      <div className={cn('page-signal-field page-signal-records', className)} aria-hidden="true">
        <svg viewBox="0 0 620 76" preserveAspectRatio="none">
          <defs>
            <linearGradient id="record-signal-silver" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#b8b8b8" stopOpacity="0" />
              <stop offset="0.55" stopColor="#b8b8b8" stopOpacity="0.22" />
              <stop offset="1" stopColor="#b8b8b8" stopOpacity="0.04" />
            </linearGradient>
            <linearGradient id="record-signal-gold" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#c8ad78" stopOpacity="0" />
              <stop offset="0.7" stopColor="#d8bd84" stopOpacity="0.7" />
              <stop offset="1" stopColor="#c8ad78" stopOpacity="0.12" />
            </linearGradient>
          </defs>
          <g fill="none" strokeWidth="0.9">
            <motion.path d="M0 14H170C215 14 226 38 270 38H620" stroke="url(#record-signal-silver)" initial={{ pathLength: 0, opacity: 0 }} animate={pathMotion} transition={drawTransition} />
            <motion.path d="M0 38H620" stroke="url(#record-signal-gold)" initial={{ pathLength: 0, opacity: 0 }} animate={pathMotion} transition={{ ...drawTransition, delay: 0.08 }} />
            <motion.path d="M0 62H170C215 62 226 38 270 38" stroke="url(#record-signal-silver)" initial={{ pathLength: 0, opacity: 0 }} animate={pathMotion} transition={{ ...drawTransition, delay: 0.14 }} />
            <path d="M56 10v8M108 34v8M160 58v8M350 34v8M438 34v8M526 34v8" stroke="#d4d4d4" strokeOpacity="0.12" />
          </g>
          <motion.g initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.38, delay: 0.42, ease: [0.16, 1, 0.3, 1] }}>
            <rect x="266" y="34" width="8" height="8" transform="rotate(45 270 38)" fill="#202020" stroke="#d8bd84" strokeOpacity="0.76" />
            <circle cx="270" cy="38" r="13" fill="none" stroke="#d8bd84" strokeOpacity="0.18" strokeDasharray="2 4" />
          </motion.g>
          <motion.circle
            r="2.6"
            fill="#e1c98f"
            filter="drop-shadow(0 0 4px rgba(216,189,132,0.72))"
            animate={{ cx: [8, 170, 270, 610], cy: [14, 14, 38, 38], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 5.8, times: [0, 0.34, 0.52, 1], repeat: Infinity, repeatDelay: 1.4, ease: [0.37, 0, 0.63, 1] }}
          />
          <motion.circle
            cx="270"
            cy="38"
            fill="none"
            stroke="#d8bd84"
            strokeWidth="0.8"
            animate={{ r: [8, 24], opacity: [0.42, 0] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeOut' }}
          />
        </svg>
      </div>
    );
  }

  return (
    <div className={cn('page-signal-field page-signal-settings', className)} aria-hidden="true">
      <svg viewBox="0 0 360 96" preserveAspectRatio="xMidYMid meet">
        <g transform="translate(282 48)" fill="none">
          <motion.circle r="31" stroke="#b8b8b8" strokeOpacity="0.13" strokeWidth="0.8" strokeDasharray="3 6" initial={{ pathLength: 0, rotate: -28 }} animate={{ pathLength: 1, rotate: 0 }} transition={drawTransition} />
          <motion.path d="M0-39A39 39 0 0 1 34-19M0 39A39 39 0 0 1-34 19" stroke="#d8bd84" strokeOpacity="0.72" strokeWidth="1.1" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ ...drawTransition, delay: 0.12 }} />
          <circle r="18" stroke="#d4d4d4" strokeOpacity="0.12" strokeWidth="0.8" />
          <path d="M-8 0H8M0-8V8" stroke="#d4d4d4" strokeOpacity="0.34" strokeWidth="0.8" />
          <rect x="-3" y="-3" width="6" height="6" transform="rotate(45)" fill="#222" stroke="#d8bd84" strokeOpacity="0.78" />
        </g>
        <motion.path d="M0 48H235L250 33" fill="none" stroke="#b8b8b8" strokeOpacity="0.15" strokeWidth="0.8" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ ...drawTransition, delay: 0.18 }} />
        <path d="M28 44v8M72 44v8M116 44v8M160 44v8M204 44v8" stroke="#d4d4d4" strokeOpacity="0.1" strokeWidth="0.7" />
        <motion.circle
          r="2.4"
          fill="#e1c98f"
          animate={{ cx: [8, 112, 225, 250, 282], cy: [48, 48, 48, 33, 48], opacity: [0, 0.8, 1, 1, 0] }}
          transition={{ duration: 4.8, times: [0, 0.28, 0.58, 0.76, 1], repeat: Infinity, repeatDelay: 1.8, ease: [0.37, 0, 0.63, 1] }}
        />
        <motion.circle
          cx="282"
          cy="48"
          fill="none"
          stroke="#d8bd84"
          strokeWidth="0.75"
          animate={{ r: [18, 46], opacity: [0.34, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeOut' }}
        />
      </svg>
    </div>
  );
}
