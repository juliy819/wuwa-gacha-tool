import { cn } from '../lib/utils';

type WuwaControlIconProps = {
  kind: 'refresh' | 'minimize' | 'maximize';
  active?: boolean;
  className?: string;
};

export default function WuwaControlIcon({ kind, active = false, className }: WuwaControlIconProps) {
  if (kind === 'refresh') {
    return (
      <svg viewBox="0 0 20 20" className={cn('wuwa-control-glyph', active && 'wuwa-control-glyph-spin', className)} aria-hidden="true">
        <path d="M4.2 10a5.8 5.8 0 0 1 9.9-4.1" />
        <path d="M15.8 10a5.8 5.8 0 0 1-9.9 4.1" />
        <path d="M13.2 3.8l1.1 2.5 2.5-1.1M6.8 16.2l-1.1-2.5-2.5 1.1" />
        <rect className="wuwa-control-node" x="8.6" y="8.6" width="2.8" height="2.8" transform="rotate(45 10 10)" />
      </svg>
    );
  }

  if (kind === 'maximize') {
    return (
      <svg viewBox="0 0 20 20" className={cn('wuwa-control-glyph', className)} aria-hidden="true">
        <path d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4" />
        <path className="wuwa-control-faint" d="M7 10h6M10 7v6" />
        <rect className="wuwa-control-node" x="8.8" y="8.8" width="2.4" height="2.4" transform="rotate(45 10 10)" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 20 20" className={cn('wuwa-control-glyph', className)} aria-hidden="true">
      <path d="M3.5 10h5M11.5 10h5" />
      <path className="wuwa-control-faint" d="M5.5 7.5v5M14.5 7.5v5" />
      <rect className="wuwa-control-node" x="8.6" y="8.6" width="2.8" height="2.8" transform="rotate(45 10 10)" />
    </svg>
  );
}
