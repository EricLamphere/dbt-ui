import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

function readStored(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function writeStored(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch { /* storage unavailable — tab just isn't remembered */ }
}

/**
 * In-page tab state kept in a URL search param, so switching tabs pushes a
 * history entry the header back/forward arrows can step through.
 *
 * `rememberKey` (optional) restores the last-used tab from sessionStorage when
 * the URL has none; the param is then written back with `replace` so going
 * back to this entry later shows the same tab. Use it at most once per page —
 * concurrent replace writes from multiple hooks would clobber each other.
 */
export function useUrlTab<T extends string>(
  param: string,
  allowed: readonly T[],
  fallback: T,
  rememberKey?: string,
): [T, (next: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const isAllowed = (v: string | null): v is T => v !== null && (allowed as readonly string[]).includes(v);

  const raw = searchParams.get(param);
  const stored = rememberKey ? readStored(rememberKey) : null;
  const tab: T = isAllowed(raw) ? raw : isAllowed(stored) ? stored : fallback;
  const missing = raw === null;

  useEffect(() => {
    if (rememberKey) writeStored(rememberKey, tab);
  }, [rememberKey, tab]);

  useEffect(() => {
    if (!rememberKey || !missing) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(param, tab);
      return next;
    }, { replace: true });
  }, [rememberKey, missing, param, tab, setSearchParams]);

  const setTab = useCallback((next: T) => {
    if (next === tab) return;
    setSearchParams((prev) => {
      const updated = new URLSearchParams(prev);
      updated.set(param, next);
      return updated;
    });
  }, [param, tab, setSearchParams]);

  return [tab, setTab];
}
