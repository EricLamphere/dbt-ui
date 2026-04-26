import { useEffect, useState } from 'react';

export const THEME_CHANGE_EVENT = 'dbt-ui:theme-change';

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
