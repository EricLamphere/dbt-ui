/**
 * Pure bookkeeping for the header's back/forward arrows.
 *
 * Browser history stays the source of truth (the arrows call navigate(±n));
 * this mirrors the last MAX_NAV_HISTORY entries, keyed by React Router's
 * location.key, so the UI knows whether each arrow has somewhere to go.
 */

export const MAX_NAV_HISTORY = 25;

export type NavAction = 'PUSH' | 'REPLACE' | 'POP';

export interface NavEntry {
  readonly key: string;
  /** pathname + search; used to skip over duplicate entries of the same URL */
  readonly href: string;
}

export interface NavHistory {
  readonly entries: readonly NavEntry[];
  readonly index: number;
}

export function createNavHistory(entry: NavEntry): NavHistory {
  return { entries: [entry], index: 0 };
}

export function recordNavigation(history: NavHistory, action: NavAction, entry: NavEntry): NavHistory {
  if (history.entries[history.index]?.key === entry.key) return history;

  if (action === 'REPLACE') {
    const entries = history.entries.map((e, i) => (i === history.index ? entry : e));
    return { entries, index: history.index };
  }

  if (action === 'POP') {
    const found = history.entries.findIndex((e) => e.key === entry.key);
    // Popped outside the window we track (e.g. past the cap via the browser's own
    // back button) — we can't know what's around it, so start over from here.
    return found === -1 ? createNavHistory(entry) : { entries: history.entries, index: found };
  }

  const entries = [...history.entries.slice(0, history.index + 1), entry].slice(-MAX_NAV_HISTORY);
  return { entries, index: entries.length - 1 };
}

/**
 * Offset to pass to navigate() to step one distinct page in `direction`, skipping
 * consecutive entries with the same URL as the current one. null = nowhere to go.
 */
export function stepDelta(history: NavHistory, direction: -1 | 1): number | null {
  const currentHref = history.entries[history.index]?.href;
  for (let i = history.index + direction; i >= 0 && i < history.entries.length; i += direction) {
    if (history.entries[i].href !== currentHref) return i - history.index;
  }
  return null;
}
