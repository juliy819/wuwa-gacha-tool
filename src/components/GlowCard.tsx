import type { ReactNode } from 'react';
import { motion, MotionProps } from 'framer-motion';
import { cn } from '../lib/utils';

interface GlowCardProps extends MotionProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export default function GlowCard({
  children,
  className = '',
  style,
  ...motionProps
}: GlowCardProps) {
  return (
    <motion.div
      className={cn('instrument-surface relative overflow-hidden', className)}
      style={style}
      {...motionProps}
    >
      <span className="instrument-surface-response" aria-hidden="true" />
      <div className="relative z-[1]">{children}</div>
    </motion.div>
  );
}
