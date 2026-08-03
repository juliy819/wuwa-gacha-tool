import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

type ResonanceActionIconProps = {
  children: ReactNode;
  size?: 'sm' | 'md';
  tone?: 'default' | 'gold' | 'danger';
  framed?: boolean;
  className?: string;
};

export default function ResonanceActionIcon({
  children,
  size = 'md',
  tone = 'default',
  framed = true,
  className,
}: ResonanceActionIconProps) {
  return (
    <span className={cn(
      'resonance-action-icon',
      `resonance-action-icon-${size}`,
      `resonance-action-icon-${tone}`,
      !framed && 'resonance-action-icon-unframed',
      className,
    )} aria-hidden="true">
      {children}
    </span>
  );
}
