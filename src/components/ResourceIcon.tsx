import { useEffect, useState, type ReactNode } from 'react';
import { gachaApi } from '../services/tauri-api';

const RETRY_DELAY_MS = 60_000;
const iconCache = new Map<number, string>();
const pendingIcons = new Map<number, Promise<string>>();
const failedAt = new Map<number, number>();

const loadResourceIcon = (resourceId: number) => {
  const cached = iconCache.get(resourceId);
  if (cached) return Promise.resolve(cached);

  const pending = pendingIcons.get(resourceId);
  if (pending) return pending;

  const lastFailure = failedAt.get(resourceId);
  if (lastFailure && Date.now() - lastFailure < RETRY_DELAY_MS) {
    return Promise.reject(new Error('resource icon retry cooldown'));
  }

  const request = gachaApi.getResourceIcon(resourceId)
    .then((url) => {
      iconCache.set(resourceId, url);
      failedAt.delete(resourceId);
      return url;
    })
    .catch((error) => {
      failedAt.set(resourceId, Date.now());
      throw error;
    })
    .finally(() => pendingIcons.delete(resourceId));

  pendingIcons.set(resourceId, request);
  return request;
};

interface ResourceIconProps {
  resourceId: number;
  alt: string;
  className?: string;
  fallback: ReactNode;
}

export default function ResourceIcon({ resourceId, alt, className, fallback }: ResourceIconProps) {
  const [url, setUrl] = useState(() => iconCache.get(resourceId) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl(iconCache.get(resourceId) ?? null);
    setFailed(false);

    loadResourceIcon(resourceId)
      .then((nextUrl) => {
        if (active) setUrl(nextUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [resourceId]);

  if (!url || failed) return fallback;

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
