import { useId, useState } from 'react';
import { useUi } from '@/app/store';
import type { ThemePreference } from '@/app/theme';
import { useCourse } from '@/app/useCourse';
import { platform, useCourses } from '@/content/courses';
import { lockAccess, unlock } from '@/content/sealedCourses';
import { badgeKey } from '@/progress/model';
import { allTasks } from '@/content/loadCourse';
import { TASK_KIND } from '@/features/lesson/TaskPanel';
import { useWorkspace } from '@/features/lesson/workspace';
import { isLessonComplete, levelInfo, localDay, progressOf, streakInfo } from '@/progress/gamification';
import { globalXp, PLATFORM, selectCourse, useProgress } from '@/progress/store';
import type { Badge, PlatformBadge } from '@/content/schema';
import { Button } from '@/ui/Button';
import { plural } from '@/ui/format';
import { FlameIcon } from '@/ui/icons';
import { ProgressBar } from '@/ui/ProgressBar';

const HEATMAP_WEEKS = 16;
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

export function ProfileScreen() {
  const doc = useProgress((s) => s.doc);
  const course = useCourse();
  const cp = useProgress(selectCourse(course.id));
  const today = localDay();
  const xp = globalXp(doc);
  const level = levelInfo(xp, platform.levels);
  const streak = streakInfo(doc.activity, today);
  const tasks = allTasks(course);
  const solved = tasks.filter((t) => progressOf(cp, t.id).solved);
  const lessons = course.worlds.flatMap((w) => w.lessons);
  const lessonsDone = lessons.filter((l) => isLessonComplete(l, cp)).length;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto grid max-w-[1100px] gap-3 px-6 py-6 md:grid-cols-[1.4fr_1fr]">
        <section aria-label="Уровень" className="rounded-md border border-line bg-panel p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Уровень {level.index + 1}</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight">{level.title}</h1>
          <p className="mt-3 font-mono text-[13px] text-dim">
            <span className="text-[20px] font-semibold text-ok">{xp}</span> XP
          </p>
          <ProgressBar className="mt-3" tone="ok" value={level.progress} label="Прогресс до следующего уровня" />
          <p className="mt-2 text-[12.5px] text-faint">
            {level.next ? `Ещё ${level.next.xp - xp} XP до «${level.next.title}»` : 'Максимальный уровень'}
          </p>
          <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
            <Stat label="заданий" value={`${solved.length}/${tasks.length}`} />
            <Stat label="уроков" value={`${lessonsDone}/${lessons.length}`} />
            <Stat label="бейджей" value={`${course.badges.filter((b) => doc.badges[badgeKey(course.id, b.id)]).length}/${course.badges.length}`} />
          </dl>
        </section>

        <section aria-label="Серия" className="rounded-md border border-line bg-panel p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Серия занятий</p>
          <p className={`mt-2 flex items-center gap-2 text-[28px] font-semibold ${streak.activeToday ? 'text-amber' : 'text-dim'}`}>
            <FlameIcon width={26} height={26} />
            {streak.current} {plural(streak.current, 'день', 'дня', 'дней')}
          </p>
          <p className="mt-1 text-[13px] text-dim">
            {streak.activeToday
              ? 'Сегодня вы уже занимались.'
              : streak.current > 0
                ? 'Решите задание сегодня, чтобы не прервать серию.'
                : 'Решите задание, чтобы начать серию.'}
          </p>
          <p className="mt-1 text-[12.5px] text-faint">Лучшая серия: {streak.best}</p>
          <Heatmap activity={doc.activity} today={today} />
        </section>

        <section aria-label="Задания по типам" className="rounded-md border border-line bg-panel p-5 md:col-span-2">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Решено по типам · {course.title}</h2>
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
            {(Object.keys(TASK_KIND) as (keyof typeof TASK_KIND)[]).map((type) => {
              const all = tasks.filter((t) => t.type === type).length;
              const done = solved.filter((t) => t.type === type).length;
              return (
                <li key={type} className="text-[13px]">
                  <span className="flex justify-between">
                    <span>{TASK_KIND[type]}</span>
                    <span className="font-mono text-faint">
                      {done}/{all}
                    </span>
                  </span>
                  <ProgressBar className="mt-1" tone="nav" value={all ? done / all : 0} label={TASK_KIND[type]} />
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="Бейджи" className="rounded-md border border-line bg-panel p-5 md:col-span-2">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Бейджи · {course.title}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {course.badges.map((badge) => (
              <BadgeTile key={badge.id} badge={badge} earnedAt={doc.badges[badgeKey(course.id, badge.id)]} />
            ))}
          </ul>
        </section>

        {platform.badges.length > 0 && (
          <section aria-label="Общие бейджи" className="rounded-md border border-line bg-panel p-5 md:col-span-2">
            <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Бейджи платформы · все курсы</h2>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {platform.badges.map((badge) => (
                <BadgeTile key={badge.id} badge={badge} earnedAt={doc.badges[badgeKey(PLATFORM, badge.id)]} />
              ))}
            </ul>
          </section>
        )}

        <Settings />
      </div>
    </div>
  );
}

function BadgeTile({ badge, earnedAt }: { badge: Badge | PlatformBadge; earnedAt: string | undefined }) {
  return (
    <li className={`flex items-center gap-3 rounded border p-2.5 ${earnedAt ? 'border-amber/40' : 'border-line'}`}>
      <span
        className={`grid h-11 w-11 shrink-0 place-items-center font-mono text-[11px] font-semibold [clip-path:polygon(25%_4%,75%_4%,100%_50%,75%_96%,25%_96%,0_50%)] ${
          earnedAt ? 'bg-amber text-on-accent' : 'bg-raised text-faint'
        }`}
      >
        {badge.glyph}
      </span>
      <span className="min-w-0">
        <span className={`block text-[13.5px] font-medium ${earnedAt ? 'text-fg' : 'text-dim'}`}>{badge.title}</span>
        <span className="block text-[12px] leading-snug text-faint">{earnedAt ? `Получен ${dateFormat.format(new Date(earnedAt))}` : badge.description}</span>
      </span>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] text-faint">{label}</dt>
      <dd className="font-mono text-[16px] font-semibold">{value}</dd>
    </div>
  );
}

function Heatmap({ activity, today }: { activity: Record<string, number>; today: string }) {
  const end = new Date(`${today}T12:00:00`);
  const offset = (end.getDay() + 6) % 7; // Monday-first weeks
  const start = new Date(end);
  start.setDate(end.getDate() - offset - (HEATMAP_WEEKS - 1) * 7);
  const days = Array.from({ length: HEATMAP_WEEKS * 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const shade = (n: number) => (n === 0 ? 'bg-line/70' : n === 1 ? 'bg-ok/35' : n <= 3 ? 'bg-ok/65' : 'bg-ok');

  return (
    <div className="mt-4 grid grid-flow-col grid-rows-7 gap-[3px]" role="img" aria-label="Активность за последние 16 недель">
      {days.map((d) => {
        const key = localDay(d);
        const n = activity[key] ?? 0;
        const future = d > end;
        return (
          <span
            key={key}
            title={future ? undefined : `${dateFormat.format(d)}: ${n} ${plural(n, 'задание', 'задания', 'заданий')}`}
            className={`aspect-square w-full rounded-[2px] ${future ? 'bg-transparent' : shade(n)}`}
          />
        );
      })}
    </div>
  );
}

const themeOptions: { id: ThemePreference; title: string }[] = [
  { id: 'dark', title: 'Тёмная' },
  { id: 'light', title: 'Светлая' },
  { id: 'system', title: 'Как в системе' },
];

function AccessCode() {
  const open = useCourses().some((c) => c.sealed);
  const id = useId();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const submit = async () => {
    if (busy || code === '') return;
    setBusy(true);
    setStatus('');
    const ok = await unlock(code);
    setBusy(false);
    setStatus(ok ? 'Доступ открыт' : 'Код не подошёл');
    if (ok) setCode('');
  };

  return (
    <form
      className="flex flex-wrap items-center gap-2 text-[13px]"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {open ? (
        <Button
          variant="outline"
          onClick={() => {
            void lockAccess().then(() => setStatus(''));
          }}
        >
          Закрыть доступ
        </Button>
      ) : (
        <>
          <label htmlFor={id} className="text-dim">
            Код доступа
          </label>
          <input
            id={id}
            type="password"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-44 rounded border border-line bg-well px-2 py-1 text-[13px]"
          />
          <Button type="submit" variant="outline" disabled={busy || code === ''}>
            {busy ? 'Проверяю…' : 'Открыть'}
          </Button>
        </>
      )}
      <span role="status" className="text-dim">
        {status}
      </span>
    </form>
  );
}

function Settings() {
  const { theme, setTheme, setView, reminders, setReminders } = useUi();
  const course = useCourse();
  const resetAll = useProgress((s) => s.resetAll);
  const [confirming, setConfirming] = useState(false);

  return (
    <section aria-label="Настройки" className="rounded-md border border-line bg-panel p-5 md:col-span-2">
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Настройки</h2>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <fieldset className="flex items-center gap-3">
          <legend className="sr-only">Тема оформления</legend>
          <span className="text-[13px] text-dim">Тема</span>
          <div className="flex rounded border border-line p-0.5">
            {themeOptions.map((o) => (
              <label key={o.id} className={`cursor-pointer rounded-sm px-2.5 py-1 text-[13px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-nav ${theme === o.id ? 'bg-raised text-fg' : 'text-faint hover:text-dim'}`}>
                <input type="radio" name="theme" value={o.id} checked={theme === o.id} onChange={() => setTheme(o.id)} className="sr-only" />
                {o.title}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex items-center gap-3 text-[13px]">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={reminders.enabled}
              onChange={(e) => setReminders({ ...reminders, enabled: e.target.checked })}
              className="h-4 w-4 accent-[var(--ok)]"
            />
            <span className="text-dim">Напоминать о серии после</span>
          </label>
          <select
            aria-label="Час напоминания"
            value={reminders.hour}
            disabled={!reminders.enabled}
            onChange={(e) => setReminders({ ...reminders, hour: Number(e.target.value) })}
            className="rounded border border-line bg-well px-1.5 py-1 text-[13px] disabled:opacity-50"
          >
            {[17, 18, 19, 20, 21, 22].map((h) => (
              <option key={h} value={h}>
                {h}:00
              </option>
            ))}
          </select>
        </div>
        <AccessCode />
        {course.onboarding && (
          <Button variant="outline" onClick={() => setView('onboarding')}>
            Пройти вступление заново
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {confirming ? (
            <>
              <span className="text-[13px] text-err">Удалить весь прогресс без возможности восстановления?</span>
              <Button
                className="border-err text-err"
                variant="outline"
                onClick={() => {
                  useWorkspace.getState().closeTask();
                  resetAll();
                  setConfirming(false);
                }}
              >
                Удалить
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Отмена
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              Сбросить прогресс
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
