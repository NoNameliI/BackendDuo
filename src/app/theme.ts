export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}

export function nextThemePreference(pref: ThemePreference): ThemePreference {
  return pref === 'dark' ? 'light' : pref === 'light' ? 'system' : 'dark';
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function systemPrefersDark(): boolean {
  return darkQuery().matches;
}

export function watchSystemTheme(onChange: (prefersDark: boolean) => void): () => void {
  const query = darkQuery();
  const listener = (e: MediaQueryListEvent) => onChange(e.matches);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
}
