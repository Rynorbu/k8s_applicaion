import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);
const KEY = 'spendwise.theme';

const readStored = () => {
  try {
    return localStorage.getItem(KEY) ?? 'system';
  } catch {
    return 'system';
  }
};

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readStored);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const listener = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);

  const isDark = theme === 'dark' || (theme === 'system' && systemDark);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // storage unavailable (private mode) - theme still works for this session
    }
  }, [theme, isDark]);

  const value = useMemo(() => ({ theme, setTheme, isDark }), [theme, isDark]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
