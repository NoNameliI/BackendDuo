import { create } from 'zustand';
import { readStore, writeStore } from '@/platform';
import type { ThemePreference } from './theme';

interface Settings {
  theme: ThemePreference;
}

export type View = 'onboarding' | 'map' | 'lesson' | 'profile';

interface UiState extends Settings {
  view: View;
  setView: (view: View) => void;
  setTheme: (theme: ThemePreference) => void;
  loadSettings: () => Promise<void>;
}

export const useUi = create<UiState>((set, get) => ({
  view: 'map',
  setView: (view) => set({ view }),
  theme: 'dark',
  setTheme: (theme) => {
    set({ theme });
    void writeStore('settings', { theme: get().theme } satisfies Settings);
  },
  loadSettings: async () => {
    const saved = await readStore<Partial<Settings>>('settings');
    if (saved?.theme) set({ theme: saved.theme });
  },
}));
