import { useEffect, useState } from 'react';

export const THEME_CHANGE_EVENT = 'dbt-ui:theme-change';

/** Apply a theme immediately (and remember it locally) — persisting it server-side is the caller's job. */
export function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('dbt-ui-theme', theme);
  } catch {
    // storage unavailable — the theme still applies for this session
  }
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
}

export function useTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const t = document.documentElement.dataset.theme;
    return t === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    const handler = () => {
      const t = document.documentElement.dataset.theme;
      setTheme(t === 'light' ? 'light' : 'dark');
    };
    window.addEventListener(THEME_CHANGE_EVENT, handler);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handler);
  }, []);

  return theme;
}
