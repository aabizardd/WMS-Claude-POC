import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

const THEME_KEY = 'wms_theme';

interface ThemeContextValue {
  theme: ThemeMode; // user preference
  effective: EffectiveTheme; // resolved (system → light/dark)
  setTheme: (t: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function systemPrefersDark() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}
function resolve(mode: ThemeMode): EffectiveTheme {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}
function apply(effective: EffectiveTheme) {
  document.documentElement.classList.toggle('dark', effective === 'dark');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    return stored === 'dark' || stored === 'light' || stored === 'system'
      ? stored
      : 'light';
  });
  const [effective, setEffective] = useState<EffectiveTheme>(() => resolve(theme));

  // Apply on mount + whenever the preference changes.
  useEffect(() => {
    const eff = resolve(theme);
    setEffective(eff);
    apply(eff);
  }, [theme]);

  // Live-update when the OS theme changes (only relevant for "system").
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const eff = mq.matches ? 'dark' : 'light';
      setEffective(eff);
      apply(eff);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  function setTheme(t: ThemeMode) {
    localStorage.setItem(THEME_KEY, t);
    setThemeState(t);
  }

  return (
    <ThemeContext.Provider value={{ theme, effective, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
