import { useSyncExternalStore } from 'react';
import { useUi } from './store';
import { resolveTheme, systemPrefersDark, watchSystemTheme, type ResolvedTheme } from './theme';

export function useResolvedTheme(): ResolvedTheme {
  const pref = useUi((s) => s.theme);
  const systemDark = useSyncExternalStore(watchSystemTheme, systemPrefersDark);
  return resolveTheme(pref, systemDark);
}
