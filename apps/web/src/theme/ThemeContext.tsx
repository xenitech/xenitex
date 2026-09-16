import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeMode = 'light' | 'dark';
export type Density = 'compact' | 'comfortable';

interface ThemeContextValue {
  readonly theme: ThemeMode;
  readonly density: Density;
  setTheme: (theme: ThemeMode) => void;
  setDensity: (density: Density) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const THEME_KEY = 'xenitex.theme';
const DENSITY_KEY = 'xenitex.density';

function readStoredTheme(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_KEY);
  // Dark is the analyst's default (tokens.css) when no preference is stored yet.
  return stored === 'light' || stored === 'dark' ? stored : 'dark';
}

function readStoredDensity(): Density {
  const stored = window.localStorage.getItem(DENSITY_KEY);
  return stored === 'comfortable' ? 'comfortable' : 'compact';
}

/**
 * P1-21: theme/density are UI preferences persisted to localStorage (P1-24
 * permits this — never tokens, never findings) and applied as `data-theme`/
 * `data-density` attributes on <html>, matching the convention tokens.css
 * documents and Storybook's preview decorator already exercises.
 */
export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(readStoredTheme);
  const [density, setDensityState] = useState<Density>(readStoredDensity);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (density === 'comfortable') {
      document.documentElement.setAttribute('data-density', 'comfortable');
    } else {
      document.documentElement.removeAttribute('data-density');
    }
  }, [density]);

  const setTheme = useCallback((next: ThemeMode) => {
    window.localStorage.setItem(THEME_KEY, next);
    setThemeState(next);
  }, []);

  const setDensity = useCallback((next: Density) => {
    window.localStorage.setItem(DENSITY_KEY, next);
    setDensityState(next);
  }, []);

  const value = useMemo(
    () => ({ theme, density, setTheme, setDensity }),
    [theme, density, setTheme, setDensity],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
