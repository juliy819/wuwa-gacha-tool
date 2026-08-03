import { cn } from '../lib/utils';

interface ResonanceGlyphProps {
  className?: string;
  size?: number;
}

export default function ResonanceGlyph({ className, size = 48 }: ResonanceGlyphProps) {
  return (
    <span
      className={cn('resonance-glyph', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="resonance-glyph-orbit" />
      <span className="resonance-glyph-orbit resonance-glyph-orbit-inner" />
      <span className="resonance-glyph-core" />
      <span className="resonance-glyph-tick resonance-glyph-tick-top" />
      <span className="resonance-glyph-tick resonance-glyph-tick-bottom" />
    </span>
  );
}
