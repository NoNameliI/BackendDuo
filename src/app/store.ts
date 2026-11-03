import { create } from 'zustand';
import { readStore, writeStore } from '@/platform';
import { DEFAULT_REMINDERS, type ReminderSettings } from './reminders';
import type { ThemePreference } from './theme';

interface Settings {
  theme: ThemePreference;
  reminders: ReminderSettings;
}

export type View = 'onboarding' | 'map' | 'lesson' | 'profile';

interface UiState extends Settings {
  view: View;
  paletteOpen: boolean;
  setView: (view: View) => void;
  setPaletteOpen: (open: boolean) => void;
  setTheme: (theme: ThemePreference) => void;
  setReminders: (reminders: ReminderSettings) => void;
  loadSettings: () => Promise<void>;
}

export const useUi = create<UiState>((set, get) => {
  const save = () => {
    const { theme, reminders } = get();
    void writeStore('settings', { theme, reminders } satisfies Settings);
  };

  return {
    view: 'map',
    paletteOpen: false,
    theme: 'dark',
    reminders: DEFAULT_REMINDERS,
    setView: (view) => set({ view, paletteOpen: false }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setTheme: (theme) => {
      set({ theme });
      save();
    },
    setReminders: (reminders) => {
      set({ reminders });
      save();
    },
    loadSettings: async () => {
      const saved = await readStore<Partial<Settings>>('settings');
      set({
        theme: saved?.theme ?? 'dark',
        reminders: { ...DEFAULT_REMINDERS, ...saved?.reminders },
      });
    },
  };
});
