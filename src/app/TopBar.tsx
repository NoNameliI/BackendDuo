import { course } from '@/content/course';
import { useWorkspace } from '@/features/lesson/workspace';
import { levelInfo, localDay, resumeTask, streakInfo, totalXp } from '@/progress/gamification';
import { selectCourse, useProgress } from '@/progress/store';
import { Button } from '@/ui/Button';
import { plural } from '@/ui/format';
import { FlameIcon, MonitorIcon, MoonIcon, SunIcon } from '@/ui/icons';
import { useUi, type View } from './store';
import { nextThemePreference, type ThemePreference } from './theme';

const themeLabels: Record<ThemePreference, string> = {
  dark: 'Тёмная тема',
  light: 'Светлая тема',
  system: 'Тема как в системе',
};

const themeIcons: Record<ThemePreference, typeof MoonIcon> = {
  dark: MoonIcon,
  light: SunIcon,
  system: MonitorIcon,
};

const nav: { id: View; title: string }[] = [
  { id: 'map', title: 'Карта' },
  { id: 'lesson', title: 'Урок' },
  { id: 'profile', title: 'Профиль' },
];

export function TopBar() {
  const { theme, setTheme, view, setView } = useUi();
  const ThemeIcon = themeIcons[theme];

  const go = (target: View) => {
    if (target === 'lesson' && !useWorkspace.getState().task) {
      void useWorkspace.getState().openTask(resumeTask(course, selectCourse(useProgress.getState())));
    }
    setView(target);
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-6 border-b border-line px-3">
      <Brand />
      {view !== 'onboarding' && (
      <nav aria-label="Разделы" className="flex h-full items-stretch gap-5">
        {nav.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={view === item.id ? 'page' : undefined}
            onClick={() => go(item.id)}
            className={`relative text-[13px] font-medium transition-colors ${view === item.id ? 'text-fg' : 'text-faint hover:text-dim'}`}
          >
            {item.title}
            <span className={`absolute inset-x-0 bottom-0 h-0.5 rounded-full ${view === item.id ? 'bg-amber' : 'bg-transparent'}`} />
          </button>
        ))}
      </nav>
      )}
      <div className="ml-auto flex items-center gap-2">
        {view !== 'onboarding' && <Stats onOpenProfile={() => go('profile')} />}
        <Button
          aria-label={`${themeLabels[theme]}. Переключить`}
          title={themeLabels[theme]}
          icon={<ThemeIcon />}
          onClick={() => setTheme(nextThemePreference(theme))}
        />
      </div>
    </header>
  );
}

function Stats({ onOpenProfile }: { onOpenProfile: () => void }) {
  const cp = useProgress(selectCourse);
  const activity = useProgress((s) => s.doc.activity);
  const xp = totalXp(course, cp);
  const level = levelInfo(xp, course.levels);
  const streak = streakInfo(activity, localDay());

  return (
    <button
      type="button"
      onClick={onOpenProfile}
      className="flex items-center gap-3 rounded px-2 py-1 font-mono text-[12px] hover:bg-raised"
      aria-label={`Серия ${streak.current} ${plural(streak.current, 'день', 'дня', 'дней')}, уровень ${level.index + 1}, ${xp} XP`}
    >
      <span
        title={streak.activeToday ? 'Серия продлена сегодня' : 'Решите задание сегодня, чтобы продлить серию'}
        className={`flex items-center gap-1 ${streak.activeToday ? 'text-amber' : 'text-faint'}`}
      >
        <FlameIcon />
        {streak.current}
      </span>
      <span className="flex flex-col items-end gap-0.5">
        <span key={xp} className="animate-pop leading-none">
          <span className="text-faint">ур.{level.index + 1} · </span>
          <span className="text-ok">{xp}</span>
          <span className="text-faint"> XP</span>
        </span>
        <span className="block h-[3px] w-full overflow-hidden rounded-full bg-line">
          <span className="block h-full bg-ok transition-[width] duration-500" style={{ width: `${Math.round(level.progress * 100)}%` }} />
        </span>
      </span>
    </button>
  );
}

function Brand() {
  return (
    <div className="flex select-none items-center gap-2">
      <svg viewBox="0 0 18 18" width={18} height={18} aria-hidden="true">
        <rect x="1" y="1" width="16" height="16" rx="3" fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
        <path d="M1.75 6.5h14.5M7 6.5v9.75" stroke="var(--line-strong)" strokeWidth="1.5" />
        <rect x="9" y="8.5" width="5.5" height="2.6" rx="0.8" fill="var(--ok)" />
      </svg>
      <span className="font-mono text-[13px] font-semibold tracking-tight">
        pg<span className="text-faint">/</span>studio
      </span>
    </div>
  );
}
