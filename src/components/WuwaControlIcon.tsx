import { cn } from '../lib/utils';

type WuwaControlIconProps = {
  kind: 'refresh' | 'minimize' | 'maximize';
  active?: boolean;
  className?: string;
};

export default function WuwaControlIcon({ kind, active = false, className }: WuwaControlIconProps) {
  if (kind === 'refresh') {
    return (
      <svg viewBox="0 0 20 20" className={cn('wuwa-control-glyph wuwa-control-glyph-refresh', active && 'wuwa-control-glyph-spin', className)} aria-hidden="true">
        <path className="wuwa-control-refresh-track wuwa-control-refresh-track-leading" d="M3.5 8V5.5L6 3h6l2.2 2.2" />
        <path className="wuwa-control-refresh-tip wuwa-control-refresh-tip-leading" d="m11.7 3.2 2.5 2-2.2 1.6" />
        <path className="wuwa-control-refresh-track wuwa-control-refresh-track-trailing" d="M16.5 12v2.5L14 17H8l-2.2-2.2" />
        <path className="wuwa-control-refresh-tip wuwa-control-refresh-tip-trailing" d="m8.3 16.8-2.5-2 2.2-1.6" />
        <path className="wuwa-control-refresh-wave" d="M3.8 10h2.7l1.2-2.2 1.8 4.4 1.5-3 1.1.8h4.1" />
      </svg>
    );
  }

  if (kind === 'maximize') {
    return (
      <svg viewBox="0 0 20 20" className={cn('wuwa-control-glyph wuwa-control-glyph-maximize', className)} aria-hidden="true">
        <path className="wuwa-control-maximize-corners" d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4" />
        <path className="wuwa-control-maximize-guides" d="M7 10h6M10 7v6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 20 20" className={cn('wuwa-control-glyph wuwa-control-glyph-minimize', className)} aria-hidden="true">
      <path className="wuwa-control-minimize-frame" d="M4 5.5h12M5.5 5.5v3M14.5 5.5v3" />
      <path className="wuwa-control-minimize-arrow" d="M10 7v6M7.5 10.5 10 13l2.5-2.5" />
      <path className="wuwa-control-minimize-dock" d="M5 15.5h10" />
    </svg>
  );
}
