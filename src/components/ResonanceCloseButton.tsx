import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/utils';

type ResonanceCloseButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  size?: 'sm' | 'md';
};

export default function ResonanceCloseButton({
  className,
  size = 'md',
  title = '关闭',
  type = 'button',
  ...props
}: ResonanceCloseButtonProps) {
  return (
    <button
      type={type}
      className={cn('resonance-close', size === 'sm' && 'resonance-close-sm', className)}
      title={title}
      aria-label={props['aria-label'] ?? title}
      {...props}
    >
      <span className="resonance-close-ring" aria-hidden="true" />
      <span className="resonance-close-mark" aria-hidden="true" />
    </button>
  );
}
