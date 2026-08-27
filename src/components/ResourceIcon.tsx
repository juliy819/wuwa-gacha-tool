import { useEffect, useState, type ReactNode } from 'react';
import { appLogger } from '../services/logger';
import { gachaApi } from '../services/tauri-api';

const RETRY_DELAY_MS = 60_000;
const iconCache = new Map<number, string>();
const portraitCache = new Map<number, string>();
const pendingIcons = new Map<number, Promise<string>>();
const pendingPortraits = new Map<number, Promise<string>>();
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
      appLogger.warn('resource_icon_request_failed', {
        resource_id: resourceId,
        retry_after_ms: RETRY_DELAY_MS,
        error,
      });
      throw error;
    })
    .finally(() => pendingIcons.delete(resourceId));

  pendingIcons.set(resourceId, request);
  return request;
};

const loadResourcePortrait = (resourceId: number) => {
  const cached = portraitCache.get(resourceId);
  if (cached) return Promise.resolve(cached);
  const pending = pendingPortraits.get(resourceId);
  if (pending) return pending;
  const request = gachaApi.getResourcePortrait(resourceId)
    .then((url) => {
      portraitCache.set(resourceId, url);
      return url;
    })
    .catch(() => loadResourceIcon(resourceId))
    .finally(() => pendingPortraits.delete(resourceId));
  pendingPortraits.set(resourceId, request);
  return request;
};

interface ResourceIconProps {
  resourceId: number;
  alt: string;
  className?: string;
  fallback: ReactNode;
  defer?: boolean;
  preferPortrait?: boolean;
}

export default function ResourceIcon({ resourceId, alt, className, fallback, defer = false, preferPortrait = false }: ResourceIconProps) {
  const cache = preferPortrait ? portraitCache : iconCache;
  const [url, setUrl] = useState(() => cache.get(resourceId) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl(cache.get(resourceId) ?? null);
    setFailed(false);

    const cached = cache.get(resourceId);
    if (cached) return () => { active = false; };

    const load = () => {
      const request = preferPortrait
        ? loadResourcePortrait(resourceId)
        : loadResourceIcon(resourceId);
      request
        .then((nextUrl) => {
          cache.set(resourceId, nextUrl);
          if (active) setUrl(nextUrl);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    };

    const timer = defer ? window.setTimeout(load, 550) : null;
    if (!defer) load();

    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [defer, preferPortrait, resourceId]);

  if (!url || failed) return fallback;

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => {
        appLogger.warn('resource_icon_decode_failed', { resource_id: resourceId });
        setFailed(true);
      }}
    />
  );
}
