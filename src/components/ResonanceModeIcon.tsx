import { cn } from '../lib/utils';

export type ResonanceModeIconKind =
  | 'origin'
  | 'echo'
  | 'calibration'
  | 'directory'
  | 'cloud'
  | 'coupling'
  | 'ingress'
  | 'traces'
  | 'matrix'
  | 'columns'
  | 'scan'
  | 'capture'
  | 'batch-edit'
  | 'reorder'
  | 'move-up'
  | 'move-down'
  | 'settings'
  | 'add'
  | 'save'
  | 'refresh'
  | 'log'
  | 'repository'
  | 'database'
  | 'copy'
  | 'download'
  | 'delete'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'user'
  | 'calendar'
  | 'clock'
  | 'edit'
  | 'search'
  | 'spark'
  | 'chart'
  | 'target'
  | 'trophy'
  | 'weapon'
  | 'external'
  | 'sync'
  | 'activity'
  | 'chevron'
  | 'check'
  | 'previous'
  | 'next'
  | 'close';

type ResonanceModeIconProps = {
  kind: ResonanceModeIconKind;
  size?: number;
  detail?: 'micro' | 'action' | 'feature';
  className?: string;
};

export default function ResonanceModeIcon({ kind, size = 18, detail, className }: ResonanceModeIconProps) {
  const resolvedDetail = detail ?? (size <= 12 ? 'micro' : size >= 20 ? 'feature' : 'action');
  const glyph = (() => {
    switch (kind) {
      case 'origin':
        return (
          <>
            <path className="resonance-origin-wave" d="M2 11h3l2.1-3.6 2.7 6.2L13 5.2l2.2 5.8H18" />
            <path className="resonance-origin-guides" d="M3 15h5M12 15h5M10 3v2M10 15v2" opacity="0.34" />
          </>
        );
      case 'echo':
        return (
          <>
            <path className="resonance-echo-upper" d="M3 5h4l2 2h8" />
            <path className="resonance-echo-core" d="M3 10h4.5L9 7.8l2.1 4.4 1.5-2.2H17" />
            <path className="resonance-echo-lower" d="M3 15h4l2-2h8" />
            <path className="resonance-echo-ghost" d="M5 7.5h2.2M12.8 7.5H15M5 12.5h2.2M12.8 12.5H15" opacity="0.34" />
          </>
        );
      case 'calibration':
        return (
          <>
            <path className="resonance-calibration-ring" d="M7.1 3.2A7 7 0 0 0 3.2 7.1M12.9 3.2A7 7 0 0 1 16.8 7.1M16.8 12.9a7 7 0 0 1-3.9 3.9M7.1 16.8a7 7 0 0 1-3.9-3.9" />
            <path className="resonance-calibration-core" d="M10 5.5v2M10 12.5v2M5.5 10h2M12.5 10h2M8.4 8.4l3.2 3.2M11.6 8.4l-3.2 3.2" opacity="0.52" />
          </>
        );
      case 'directory':
        return (
          <>
            <path d="M2.5 7h5.2l1.8-2h8M2.5 7v8.5h12.8L17.5 7H9.2" />
            <path d="M5 10h8.5M4.4 12.8h8.4" opacity="0.42" />
            <path d="m14.2 10 1.1 1.1-1.7 1.7" />
          </>
        );
      case 'cloud':
        return (
          <>
            <path d="M3.2 11.5A6.9 6.9 0 0 1 7 5M16.8 11.5A6.9 6.9 0 0 0 13 5M5.4 12.5a4.8 4.8 0 0 1 2.8-4.3M14.6 12.5a4.8 4.8 0 0 0-2.8-4.3" />
            <path d="M3 14.5h5l2 2 2-2h5M10 3v8M7.5 8.5 10 11l2.5-2.5" />
            <path d="M5 17h3M12 17h3" opacity="0.4" />
          </>
        );
      case 'coupling':
        return (
          <>
            <path d="M8 5.3 6.2 3.5 2.8 6.9 7 11.1h3M12 14.7l1.8 1.8 3.4-3.4L13 8.9h-3" />
            <path d="m6.2 13.8 7.6-7.6M4.8 5.5l2.8 2.8M12.4 11.7l2.8 2.8" opacity="0.42" />
            <rect x="8.6" y="8.6" width="2.8" height="2.8" transform="rotate(45 10 10)" />
          </>
        );
      case 'ingress':
        return (
          <>
            <path d="M10 2.5v8.8M6.8 8.5 10 11.7l3.2-3.2" />
            <path d="M3 6V3h4M13 3h4v3M3 14v3h5M12 17h5v-3" />
            <path d="M5 14h3l2 2 2-2h3" opacity="0.42" />
          </>
        );
      case 'traces':
        return (
          <>
            <path d="M3 4.5h7l2 2h5M3 10h14M3 15.5h7l2-2h5" />
            <path d="M5.5 7.4h8.8M5.5 12.6h8.8" opacity="0.4" />
            <rect x="2.1" y="8.6" width="2.8" height="2.8" transform="rotate(45 3.5 10)" />
          </>
        );
      case 'matrix':
        return (
          <>
            <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
            <path d="M6 6h2.2L10 7.8 11.8 6H14M6 14h2.2l1.8-1.8 1.8 1.8H14" opacity="0.42" />
            <path d="M6 10h8M10 6v8" />
            <rect x="8.5" y="8.5" width="3" height="3" transform="rotate(45 10 10)" />
          </>
        );
      case 'columns':
        return (
          <>
            <path d="M3 4h4v12H3M8 4h4v12H8M13 4h4v12h-4" />
            <path d="M4.5 7h1M9.5 7h1M14.5 7h1M4.5 10h1M9.5 10h1M14.5 10h1M4.5 13h1M9.5 13h1M14.5 13h1" opacity="0.5" />
            <path d="M3 2.5h4M13 17.5h4" opacity="0.34" />
          </>
        );
      case 'scan':
        return (
          <>
            <path d="M7.1 3.1A7.3 7.3 0 0 0 3.1 7.2M12.9 3.1A7.3 7.3 0 0 1 16.9 7.2M16.9 12.8a7.3 7.3 0 0 1-4 4.1M7.1 16.9a7.3 7.3 0 0 1-4-4.1" />
            <path d="M5.4 10h3.1l1.5-4.2 1.5 8.4L13 10h3.1" />
            <path d="M10 2v2.1M10 15.9V18M2 10h2.1M15.9 10H18" opacity="0.42" />
            <path className="resonance-mode-node" d="M10 8.45 11.55 10 10 11.55 8.45 10Z" />
          </>
        );
      case 'capture':
        return (
          <>
            <path d="M7 3H3v4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
            <path d="M3.8 10h3l1.5-3.2 2.2 6.4 1.8-3.2h3.9" />
            <path d="M5.5 6.2h2M12.5 6.2h2M5.5 13.8h2M12.5 13.8h2" opacity="0.38" />
            <path className="resonance-mode-node" d="M10 8.25 11.75 10 10 11.75 8.25 10Z" />
          </>
        );
      case 'batch-edit':
        return (
          <>
            <path d="M3 5h7l2 2h5M3 10h5l2-2 2.2 4.4L14 10h3M3 15h7l2-2h2.2" />
            <path d="m12.8 15.9 1-2.8 2.7-2.7 1.5 1.5-2.7 2.7Z" />
            <path d="M5 7.5h2M13 7.5h2M5 12.5h2" opacity="0.38" />
            <path className="resonance-mode-node" d="M10 8.4 11.6 10 10 11.6 8.4 10Z" />
          </>
        );
      case 'reorder':
        return (
          <>
            <path d="M5 5h7l2 2h2M5 10h3l2-2.5 2.2 5L14 10h2M5 15h7l2-2h2" />
            <path d="M2.5 5h1M2.5 10h1M2.5 15h1" opacity="0.7" />
            <path d="M17.5 4v12M16 5.5 17.5 4 19 5.5M16 14.5l1.5 1.5 1.5-1.5" opacity="0.42" />
          </>
        );
      case 'move-up':
        return (
          <>
            <path d="M10 17V4M6.5 7.5 10 4l3.5 3.5" />
            <path d="M3 12h4l1.4-2.2L10 13l1.6-3.2L13 12h4" opacity="0.42" />
            <path className="resonance-mode-node" d="M10 10.4 11.6 12 10 13.6 8.4 12Z" />
          </>
        );
      case 'move-down':
        return (
          <>
            <path d="M10 3v13M6.5 12.5 10 16l3.5-3.5" />
            <path d="M3 8h4l1.4-2.2L10 9l1.6-3.2L13 8h4" opacity="0.42" />
            <path className="resonance-mode-node" d="M10 6.4 11.6 8 10 9.6 8.4 8Z" />
          </>
        );
      case 'settings':
        return (
          <>
            <path d="M7 3.3A7 7 0 0 0 3.3 7M13 3.3A7 7 0 0 1 16.7 7M16.7 13a7 7 0 0 1-3.7 3.7M7 16.7A7 7 0 0 1 3.3 13" />
            <path d="M5 7h5M13 7h2M5 13h2M10 13h5M7 5v4M13 11v4" />
            <path className="resonance-mode-node" d="M10 8.2 11.8 10 10 11.8 8.2 10Z" />
          </>
        );
      case 'add':
        return (
          <>
            <path d="M10 2.5v5M10 12.5v5M2.5 10h5M12.5 10h5" />
            <path d="M5 5h2.3L10 7.7 12.7 5H15M5 15h2.3l2.7-2.7 2.7 2.7H15" opacity="0.42" />
            <path className="resonance-mode-node" d="M10 7.75 12.25 10 10 12.25 7.75 10Z" />
          </>
        );
      case 'save':
        return (
          <>
            <path d="M3 7V3h4M13 3h4v4M3 13v4h4M13 17h4v-4" />
            <path d="M6 7.5h8M6 10h8M6 12.5h8" opacity="0.42" />
            <path d="M10 4.5v10M7.8 12.2 10 14.5l2.2-2.3" />
            <rect x="8.9" y="7.9" width="2.2" height="2.2" transform="rotate(45 10 9)" />
          </>
        );
      case 'refresh':
        return (
          <>
            <path d="M4.2 10a5.8 5.8 0 0 1 9.9-4.1M15.8 10a5.8 5.8 0 0 1-9.9 4.1" />
            <path d="m13.2 3.8 1.1 2.5 2.5-1.1M6.8 16.2l-1.1-2.5-2.5 1.1" />
            <rect x="8.6" y="8.6" width="2.8" height="2.8" transform="rotate(45 10 10)" />
          </>
        );
      case 'log':
        return (
          <>
            <path d="M3 4.5h9.5L17 9v6.5H7.5L3 12Z" />
            <path d="M6 7h6.5M7.5 10h7M6 13h6.5" />
            <path d="M12.5 4.5V9H17" opacity="0.42" />
          </>
        );
      case 'repository':
        return (
          <>
            <path d="M5 4.5v9.2L7.3 16H15M5 8h5l4-3.5M10 8l4 4.2V16" />
            <rect x="3.6" y="3.1" width="2.8" height="2.8" transform="rotate(45 5 4.5)" />
            <rect x="12.6" y="3.1" width="2.8" height="2.8" transform="rotate(45 14 4.5)" />
            <rect x="12.6" y="14.6" width="2.8" height="2.8" transform="rotate(45 14 16)" />
          </>
        );
      case 'database':
        return (
          <>
            <path d="M7.2 3.4C4.4 4 2.8 5.3 2.8 7s1.6 3 4.4 3.6M12.8 3.4c2.8.6 4.4 1.9 4.4 3.6s-1.6 3-4.4 3.6" />
            <path d="M7.2 9.4c-2.8.6-4.4 1.9-4.4 3.6s1.6 3 4.4 3.6M12.8 9.4c2.8.6 4.4 1.9 4.4 3.6s-1.6 3-4.4 3.6" />
            <path d="M10 2.5v15M5.2 7h9.6M5.2 13h9.6" opacity="0.42" />
            <rect x="8.7" y="5.7" width="2.6" height="2.6" transform="rotate(45 10 7)" />
            <rect x="8.7" y="11.7" width="2.6" height="2.6" transform="rotate(45 10 13)" />
          </>
        );
      case 'copy':
        return (
          <>
            <path d="M3 7V3h8l3 3v3M6 9V6h7l3 3v8H9l-3-3Z" />
            <path d="M11 3v3h3M13 6v3h3M9 11h4M9 14h4" opacity="0.42" />
            <path d="M3 11v4h4" />
          </>
        );
      case 'download':
        return (
          <>
            <path d="M10 2.5v8.8M6.8 8.4 10 11.6l3.2-3.2" />
            <path d="M3 12.5h3.5L10 16l3.5-3.5H17M3 12.5V17h14v-4.5" />
            <path d="M6 5h2M12 5h2M5 8h2M13 8h2" opacity="0.38" />
          </>
        );
      case 'delete':
        return (
          <>
            <path d="M3 4h9.5L16 7.5l-3.2 3.2M3 4v12h7M3 8h8.5M3 12h6" />
            <path d="m13.5 12 1.4-1.4 1.5 1.5-1.4 1.4M11.2 14.3l1.3-1.3 1.4 1.4-1.3 1.3M14.8 16l1.2-1.2" opacity="0.72" />
          </>
        );
      case 'info':
        return (
          <>
            <path d="M7 3.4A7 7 0 0 0 3.4 7M13 3.4A7 7 0 0 1 16.6 7M16.6 13A7 7 0 0 1 13 16.6M7 16.6A7 7 0 0 1 3.4 13" />
            <path d="M10 8.5V14M10 5.5v1" />
          </>
        );
      case 'success':
        return (
          <>
            <path d="M7 3.4A7 7 0 0 0 3.4 7M13 3.4A7 7 0 0 1 16.6 7M16.6 13A7 7 0 0 1 13 16.6M7 16.6A7 7 0 0 1 3.4 13" />
            <path d="m6.2 10 2.5 2.5 5.2-5.2" />
          </>
        );
      case 'warning':
        return (
          <>
            <path d="M10 2.8 18 17H2Z" />
            <path d="M6 12h2l1-2 1.6 4 1.4-2h2M10 6.3v1.4" />
          </>
        );
      case 'error':
        return (
          <>
            <path d="M7 3.4A7 7 0 0 0 3.4 7M13 3.4A7 7 0 0 1 16.6 7M16.6 13A7 7 0 0 1 13 16.6M7 16.6A7 7 0 0 1 3.4 13" />
            <path d="m7 7 6 6M13 7l-6 6" />
          </>
        );
      case 'user':
        return (
          <>
            <path d="M10 3.2a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM3.5 17c.5-3.5 2.7-5.3 6.5-5.3s6 1.8 6.5 5.3" />
            <path d="M6 15h2l1-1.5 1.5 3 1.3-1.5H14" opacity="0.42" />
          </>
        );
      case 'calendar':
        return (
          <>
            <path d="M3 5h14v12H3ZM3 8h14M6 3v4M14 3v4" />
            <path d="M5.5 12h2l1-1.5 1.5 3 1.4-1.5h3" opacity="0.5" />
          </>
        );
      case 'clock':
        return (
          <>
            <path d="M7 3.4A7 7 0 0 0 3.4 7M13 3.4A7 7 0 0 1 16.6 7M16.6 13A7 7 0 0 1 13 16.6M7 16.6A7 7 0 0 1 3.4 13" />
            <path d="M10 5.5V10l3.5 2" />
          </>
        );
      case 'edit':
        return (
          <>
            <path d="m3.2 16.8 1.2-4.2L13.5 3.5l3 3-9.1 9.1Z" />
            <path d="m11.8 5.2 3 3M4.4 12.6l3 3M3 8h3M11 17h6" opacity="0.42" />
            <path d="M5.3 14.7 14.4 5.6" />
          </>
        );
      case 'search':
        return (
          <>
            <path d="M6.5 3.5A6 6 0 0 0 3.2 7M11.5 3.5A6 6 0 0 1 14.8 7M3.2 11a6 6 0 0 0 3.3 3.5M11.5 14.5A6 6 0 0 0 14.8 11" />
            <path d="m13.2 13.2 4 4M6 9h6M9 6v6" opacity="0.48" />
            <rect x="7.7" y="7.7" width="2.6" height="2.6" transform="rotate(45 9 9)" />
          </>
        );
      case 'spark':
        return (
          <>
            <path d="M10 2.5 11.5 8l5.5 2-5.5 2-1.5 5.5L8.5 12 3 10l5.5-2Z" />
            <path d="M3 4v3M1.5 5.5h3M16 3v3M14.5 4.5h3" opacity="0.42" />
          </>
        );
      case 'chart':
        return (
          <>
            <path className="resonance-chart-bar resonance-chart-bar-1" d="M3 17V9h3v8" />
            <path className="resonance-chart-bar resonance-chart-bar-2" d="M8.5 17V5h3v12" />
            <path className="resonance-chart-bar resonance-chart-bar-3" d="M14 17V3h3v14" />
            <path className="resonance-chart-trend" d="M3 7h3l2-3 2.5 2L14 2.5h3" opacity="0.42" />
          </>
        );
      case 'target':
        return (
          <>
            <path d="M7 3.4A7 7 0 0 0 3.4 7M13 3.4A7 7 0 0 1 16.6 7M16.6 13A7 7 0 0 1 13 16.6M7 16.6A7 7 0 0 1 3.4 13" />
            <circle cx="10" cy="10" r="3.2" /><path d="M10 1.5v4M10 14.5v4M1.5 10h4M14.5 10h4" opacity="0.4" />
          </>
        );
      case 'trophy':
        return (
          <>
            <path d="M6 3h8v4c0 3-1.5 5-4 5S6 10 6 7ZM6 5H3v2c0 2 1.2 3 3.2 3M14 5h3v2c0 2-1.2 3-3.2 3M10 12v3M6.5 17h7" />
            <path d="M8 6h4M8.5 9h3" opacity="0.38" />
          </>
        );
      case 'weapon':
        return (
          <>
            <path d="m4 3 5 5-2 2-5-5ZM16 3l-5 5 2 2 5-5M7 10l-3 5M13 10l3 5" />
            <path d="M2.5 17h4M13.5 17h4" opacity="0.42" />
          </>
        );
      case 'external':
        return (
          <>
            <path d="M8 4H4v12h12v-4M11 3h6v6M17 3l-8 8" />
            <path d="M6.5 9V6.5H9M13.5 11v2.5H11M6.5 13.5H9" opacity="0.42" />
          </>
        );
      case 'sync':
        return (
          <>
            <path d="M3.5 8.5a6.7 6.7 0 0 1 10.8-3l1.5 1.6M16.5 11.5a6.7 6.7 0 0 1-10.8 3l-1.5-1.6" />
            <path d="m12.5 7.2 3.3-.1-.1-3.3M7.5 12.8l-3.3.1.1 3.3" />
            <path d="M10 5.8v8.4M7.8 10h4.4" opacity="0.4" />
            <rect x="8.8" y="8.8" width="2.4" height="2.4" transform="rotate(45 10 10)" />
          </>
        );
      case 'activity':
        return (
          <>
            <path d="M2 10h3l2-4 3 8 3-6 2 2h3" />
            <path d="M3 4h4M13 4h4M3 16h4M13 16h4" opacity="0.34" />
          </>
        );
      case 'chevron':
        return (
          <>
            <path d="m4 7 6 6 6-6" />
            <path d="M3 4h4M13 4h4" opacity="0.34" />
          </>
        );
      case 'check':
        return (
          <>
            <path d="m3.5 10 4 4 9-9" />
            <path d="M3 5h4M13 15h4" opacity="0.34" />
          </>
        );
      case 'previous':
        return (
          <>
            <path d="m12.5 4-6 6 6 6" />
            <path d="M15.5 4v12" opacity="0.34" />
          </>
        );
      case 'next':
        return (
          <>
            <path d="m7.5 4 6 6-6 6" />
            <path d="M4.5 4v12" opacity="0.34" />
          </>
        );
      case 'close':
        return (
          <>
            <path d="m5 5 10 10M15 5 5 15" />
            <path d="M2.5 7V2.5H7M13 17.5h4.5V13" opacity="0.34" />
          </>
        );
    }
  })();

  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      data-detail={resolvedDetail}
      className={cn('resonance-mode-icon overflow-visible', `resonance-mode-icon-${kind}`, className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.28"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      {glyph}
    </svg>
  );
}
