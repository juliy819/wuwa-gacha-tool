import type { ClipboardEvent, InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { SHARE_MODE } from '../lib/shareMode';

interface ShareMaskedInputProps extends InputHTMLAttributes<HTMLInputElement> {
  displayValue: string;
  containerClassName?: string;
}

interface ShareMaskedTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  displayValue: string;
  containerClassName?: string;
}

function writeMaskedClipboard(event: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>, value: string) {
  if (!SHARE_MODE) return;
  event.preventDefault();
  event.clipboardData.setData('text/plain', value);
}

export function ShareMaskedInput({ displayValue, containerClassName = '', className = '', onCopy, ...props }: ShareMaskedInputProps) {
  return (
    <span className={`relative block ${containerClassName}`}>
      <input
        {...props}
        className={`${className} ${SHARE_MODE ? 'text-transparent caret-transparent selection:bg-transparent selection:text-transparent' : ''}`}
        onCopy={(event) => {
          writeMaskedClipboard(event, displayValue);
          onCopy?.(event);
        }}
      />
      {SHARE_MODE && props.value ? (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm text-tide">
          <span className="truncate">{displayValue}</span>
        </span>
      ) : null}
    </span>
  );
}

export function ShareMaskedTextarea({ displayValue, containerClassName = '', className = '', onCopy, ...props }: ShareMaskedTextareaProps) {
  return (
    <span className={`relative block ${containerClassName}`}>
      <textarea
        {...props}
        className={`${className} ${SHARE_MODE ? 'text-transparent caret-transparent selection:bg-transparent selection:text-transparent' : ''}`}
        onCopy={(event) => {
          writeMaskedClipboard(event, displayValue);
          onCopy?.(event);
        }}
      />
      {SHARE_MODE && props.value ? (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-y-auto break-all px-3 py-2 font-mono text-sm text-tide">
          {displayValue}
        </span>
      ) : null}
    </span>
  );
}
