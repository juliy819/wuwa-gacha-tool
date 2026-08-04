import { debug, error, info, warn } from '@tauri-apps/plugin-log';

type LogContext = Record<string, unknown>;

const MAX_MESSAGE_LENGTH = 2_000;
const SENSITIVE_PARAM = /((?:authkey|record_id|token|access_token|authorization)=)[^&\s#]+/gi;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;

const redact = (value: string) => value
  .replace(URL_PATTERN, (rawUrl) => {
    try {
      const parsed = new URL(rawUrl);
      return `${parsed.origin}${parsed.pathname}${parsed.search || parsed.hash ? '?[redacted]' : ''}`;
    } catch {
      return '[redacted-url]';
    }
  })
  .replace(SENSITIVE_PARAM, '$1[redacted]')
  .slice(0, MAX_MESSAGE_LENGTH);

const errorMessage = (value: unknown) => {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const format = (event: string, context?: LogContext) => {
  const fields = context
    ? Object.entries(context).map(([key, value]) => `${key}=${redact(errorMessage(value))}`)
    : [];
  return redact([`event=${event}`, ...fields].join(' '));
};

export const appLogger = {
  debug: (event: string, context?: LogContext) => { void debug(format(event, context)).catch(() => {}); },
  info: (event: string, context?: LogContext) => { void info(format(event, context)).catch(() => {}); },
  warn: (event: string, context?: LogContext) => { void warn(format(event, context)).catch(() => {}); },
  error: (event: string, context?: LogContext) => { void error(format(event, context)).catch(() => {}); },
};

export const installGlobalLogging = () => {
  window.addEventListener('error', (event) => {
    appLogger.error('frontend_error', {
      message: event.message,
      source: event.filename ? event.filename.split('/').pop() : 'unknown',
      line: event.lineno,
      column: event.colno,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    appLogger.error('unhandled_rejection', { error: errorMessage(event.reason) });
  });
  appLogger.info('frontend_started');
};
