export const SHARE_MODE = import.meta.env.VITE_SHARE_MODE === 'true';

const uidAliases = new Map<string, string>();

function uidAlias(uid: string): string {
  const normalized = uid.trim();
  if (!normalized) return normalized;

  const existing = uidAliases.get(normalized);
  if (existing) return existing;

  const alias = `DEMO-${String(uidAliases.size + 1).padStart(2, '0')}`;
  uidAliases.set(normalized, alias);
  return alias;
}

export function displayUid(uid: string | null | undefined): string {
  if (!uid) return '';
  return SHARE_MODE ? uidAlias(uid) : uid;
}

function maskUrlParameters(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.searchParams.forEach((_, key) => url.searchParams.set(key, '***'));

    const queryIndex = url.hash.indexOf('?');
    if (queryIndex >= 0) {
      const hashPath = url.hash.slice(0, queryIndex);
      const hashParams = new URLSearchParams(url.hash.slice(queryIndex + 1));
      hashParams.forEach((_, key) => hashParams.set(key, '***'));
      url.hash = `${hashPath}?${hashParams.toString()}`;
    }

    return url.toString().split('%2A%2A%2A').join('***');
  } catch {
    return rawUrl.replace(/([?&#][^=&#\s]+)=([^&#\s]*)/g, '$1=***');
  }
}

export function displayGachaUrl(url: string | null | undefined): string {
  if (!url) return '';
  return SHARE_MODE ? maskUrlParameters(url) : url;
}

export function displayPath(path: string | null | undefined): string {
  if (!path) return '';
  if (!SHARE_MODE) return path;

  const segments = path.split(/[\\/]+/).filter(Boolean);
  const leaf = segments.at(-1) ?? '本地路径';
  return `...\\${redactPossibleUids(leaf)}`;
}

function redactUidLabels(value: string): string {
  return value.replace(/(UID[\s_-]*)(\d{5,})/gi, (_, prefix: string, uid: string) => `${prefix}${uidAlias(uid)}`);
}

function redactPossibleUids(value: string): string {
  return redactUidLabels(value).replace(/\b\d{8,12}\b/g, (uid) => uidAlias(uid));
}

export function displaySensitiveText(value: string | null | undefined): string {
  if (!value || !SHARE_MODE) return value ?? '';

  const urls: string[] = [];
  const withoutUrls = value.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
    urls.push(maskUrlParameters(url));
    return `__SHARE_URL_${urls.length - 1}__`;
  });
  const withoutPaths = withoutUrls.replace(/[a-zA-Z]:\\[^\r\n,;]+/g, (path) => displayPath(path));
  const withoutUids = redactPossibleUids(withoutPaths);

  return withoutUids.replace(/__SHARE_URL_(\d+)__/g, (_, index: string) => urls[Number(index)] ?? '***');
}

export function shareSafeFileToken(uid: string): string {
  return SHARE_MODE ? uidAlias(uid).toLowerCase() : uid;
}
