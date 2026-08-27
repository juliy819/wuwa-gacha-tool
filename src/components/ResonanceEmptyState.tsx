import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';
import ResonanceIcon, { type ResonanceModeIconKind } from './ResonanceModeIcon';

type EmptyStateVariant = 'scan' | 'records' | 'database' | 'filter';

type ResonanceEmptyStateProps = {
  variant: EmptyStateVariant;
  title: string;
  description: string;
  compact?: boolean;
  children?: ReactNode;
  className?: string;
};

const iconKinds: Record<EmptyStateVariant, ResonanceModeIconKind> = {
  scan: 'scan',
  records: 'traces',
  database: 'database',
  filter: 'search',
};

export default function ResonanceEmptyState({
  variant,
  title,
  description,
  compact = false,
  children,
  className,
}: ResonanceEmptyStateProps) {
  return (
    <div className={cn('instrument-empty-state', `instrument-empty-${variant}`, compact && 'instrument-empty-compact', className)}>
      <div className="instrument-empty-visual" aria-hidden="true">
        <svg viewBox="0 0 320 126" preserveAspectRatio="xMidYMid meet">
          <g fill="none">
            <motion.path
              d="M18 76H92C116 76 122 48 150 48H170C198 48 204 76 228 76H302"
              stroke="#b8b8b8"
              strokeOpacity="0.18"
              strokeWidth="0.9"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.72, ease: [0.16, 1, 0.3, 1] }}
            />
            <path d="M48 87v10M86 89v6M234 89v6M272 87v10" stroke="#d4d4d4" strokeOpacity="0.12" strokeWidth="0.7" />
            <circle cx="160" cy="62" r="37" stroke="#d4d4d4" strokeOpacity="0.12" strokeWidth="0.8" strokeDasharray="2 5" />
            <motion.path
              d="M160 18A44 44 0 0 1 198 40M160 106A44 44 0 0 1 122 84"
              stroke="#d8bd84"
              strokeOpacity="0.62"
              strokeWidth="1"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6, delay: 0.14, ease: [0.16, 1, 0.3, 1] }}
            />
          </g>
        </svg>
        <span className="instrument-empty-core">
          <ResonanceIcon kind={iconKinds[variant]} size={compact ? 22 : 27} detail="feature" />
        </span>
      </div>
      <div className="instrument-empty-copy">
        <div className="instrument-empty-title">{title}</div>
        <p className="instrument-empty-description">{description}</p>
      </div>
      {children ? <div className="instrument-empty-action">{children}</div> : null}
    </div>
  );
}
