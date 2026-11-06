import { create } from 'zustand';
import { courses } from '@/content/courses';
import { readStore, writeStore } from '@/platform';
import { DEFAULT_REMINDERS, type ReminderSettings } from './reminders';
import type { ThemePreference } from './theme';

interface Settings {
  theme: ThemePreference;
  reminders: ReminderSettings;
  courseId: string;
}

export type View = 'hub' | 'onboarding' | 'map' | 'lesson' | 'profile' | 'git-sandbox' | 'drill';

interface UiState extends Settings {
  view: View;
  paletteOpen: boolean;
  setView: (view: View) => void;
  setPaletteOpen: (open: boolean) => void;
  setTheme: (theme: ThemePreference) => void;
  setCourse: (courseId: string) => void;
  setReminders: (reminders: ReminderSettings) => void;
  loadSettings: () => Promise<void>;
}

export const useUi = create<UiState>((set, get) => {
  const save = () => {
    const { theme, reminders, courseId } = get();
    void writeStore('settings', { theme, reminders, courseId } satisfies Settings);
  };

  return {
    view: 'hub',
    paletteOpen: false,
    theme: 'dark',
    reminders: DEFAULT_REMINDERS,
    courseId: courses[0].id,
    setView: (view) => set({ view, paletteOpen: false }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setTheme: (theme) => {
      set({ theme });
      save();
    },
    setCourse: (courseId) => {
      set({ courseId });
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
        courseId: courses.some((c) => c.id === saved?.courseId) ? saved!.courseId! : courses[0].id,
      });
    },
  };
});
