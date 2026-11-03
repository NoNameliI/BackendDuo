import { create } from 'zustand';
import { readStore, writeStore } from '@/platform';
import type { ThemePreference } from './theme';

interface Settings {
  theme: ThemePreference;
}

interface UiState extends Settings {
  setTheme: (theme: ThemePreference) => void;
  loadSettings: () => Promise<void>;
}

export const useUi = create<UiState>((set, get) => ({
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
