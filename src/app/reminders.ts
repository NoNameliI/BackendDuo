import { localDay, streakInfo, type StreakInfo } from '@/progress/gamification';
import { useProgress } from '@/progress/store';
import { notify } from '@/platform';
import { plural } from '@/ui/format';
import { useUi } from './store';

export interface ReminderSettings {
  enabled: boolean;
  /** Local hour after which an inactive day triggers the reminder. */
  hour: number;
  lastSentDay?: string;
}

export const DEFAULT_REMINDERS: ReminderSettings = { enabled: true, hour: 19 };

/** Remind once per day, in the evening, only while a streak exists and today is still empty. */
export function shouldRemind(settings: ReminderSettings, now: Date, streak: StreakInfo): boolean {
  return (
    settings.enabled &&
    now.getHours() >= settings.hour &&
    streak.current > 0 &&
    !streak.activeToday &&
    settings.lastSentDay !== localDay(now)
  );
}

const CHECK_INTERVAL_MS = 60_000;

/** In-app scheduler; in the desktop shell it keeps running while the window sits in the tray. */
export function startReminders(): () => void {
  const tick = () => {
    const now = new Date();
    const { reminders, setReminders } = useUi.getState();
    const streak = streakInfo(useProgress.getState().doc.activity, localDay(now));
    if (!shouldRemind(reminders, now, streak)) return;
    setReminders({ ...reminders, lastSentDay: localDay(now) });
    void notify(
      `Серия ${streak.current} ${plural(streak.current, 'день', 'дня', 'дней')} под угрозой`,
      'Решите сегодня хотя бы одно задание, чтобы её сохранить.',
    );
  };
  tick();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}
