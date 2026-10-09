import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useNavigationType, type Location } from 'react-router-dom';
import { createNavHistory, recordNavigation, stepDelta, type NavEntry } from './navHistory';

interface NavHistoryControls {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

const NavHistoryContext = createContext<NavHistoryControls | null>(null);

// Browser mouse "back" / "forward" side buttons (MouseEvent.button)
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

// KeyboardEvent.key values that step back / forward when held with ⌘
const BACK_KEYS = new Set(['[', 'ArrowLeft']);
const FORWARD_KEYS = new Set([']', 'ArrowRight']);

function toEntry(location: Location): NavEntry {
  return { key: location.key, href: location.pathname + location.search };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Tracks in-app navigation so the header arrows can step back/forward. Must sit inside the router. */
export function NavHistoryProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const action = useNavigationType();
  const navigate = useNavigate();
  const [history, setHistory] = useState(() => createNavHistory(toEntry(location)));
  // Set while an arrow navigation is in flight: the deltas below come from state that only
  // updates once the POP lands, so a double-click / fast repeat would reuse a stale delta
  const navigatingRef = useRef(false);

  useEffect(() => {
    navigatingRef.current = false;
    setHistory((h) => recordNavigation(h, action, toEntry(location)));
  }, [location, action]);

  const backDelta = stepDelta(history, -1);
  const forwardDelta = stepDelta(history, 1);

  const step = useCallback((delta: number | null) => {
    if (delta === null || navigatingRef.current) return;
    navigatingRef.current = true;
    navigate(delta);
  }, [navigate]);

  const goBack = useCallback(() => step(backDelta), [step, backDelta]);
  const goForward = useCallback(() => step(forwardDelta), [step, forwardDelta]);

  useEffect(() => {
    // ⌘[ / ⌘] and ⌘← / ⌘→ — skipped while typing so editors (Monaco outdent/indent,
    // line start/end) and the terminal keep them
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || e.repeat || e.shiftKey || e.altKey || e.ctrlKey || isEditableTarget(e.target)) return;
      if (BACK_KEYS.has(e.key)) { e.preventDefault(); goBack(); }
      else if (FORWARD_KEYS.has(e.key)) { e.preventDefault(); goForward(); }
    };
    // preventDefault stops the browser's native back/forward so we don't navigate twice
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === MOUSE_BACK) { e.preventDefault(); goBack(); }
      else if (e.button === MOUSE_FORWARD) { e.preventDefault(); goForward(); }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [goBack, goForward]);

  const value = useMemo<NavHistoryControls>(() => ({
    canGoBack: backDelta !== null,
    canGoForward: forwardDelta !== null,
    goBack,
    goForward,
  }), [backDelta, forwardDelta, goBack, goForward]);

  return <NavHistoryContext.Provider value={value}>{children}</NavHistoryContext.Provider>;
}

export function useNavHistory(): NavHistoryControls {
  const ctx = useContext(NavHistoryContext);
  if (!ctx) throw new Error('useNavHistory must be used inside <NavHistoryProvider>');
  return ctx;
}
