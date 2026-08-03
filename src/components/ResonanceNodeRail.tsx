import { cn } from '../lib/utils';

type ResonanceNodeRailProps = {
  className?: string;
  accent?: boolean;
};

export default function ResonanceNodeRail({ className, accent = false }: ResonanceNodeRailProps) {
  return (
    <span className={cn('resonance-node-rail', accent && 'resonance-node-rail-accent', className)} aria-hidden="true">
      <span className="resonance-node-rail-line" />
      <span className="resonance-node resonance-node-start" />
      <span className="resonance-node resonance-node-middle" />
      <span className="resonance-node-star" />
      <span className="resonance-node resonance-node-end" />
    </span>
  );
}
