import { Button } from '@/ui/Button';
import { MonitorIcon, MoonIcon, SunIcon } from '@/ui/icons';
import { useUi } from './store';
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

export function TopBar() {
  const { theme, setTheme } = useUi();
  const ThemeIcon = themeIcons[theme];

  return (
    <header className="flex h-11 shrink-0 items-center gap-4 border-b border-line px-3">
      <Brand />
      <div className="ml-auto flex items-center gap-1">
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
