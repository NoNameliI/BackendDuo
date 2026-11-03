import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useUi } from '@/app/store';
import { nextThemePreference } from '@/app/theme';
import { course } from '@/content/course';
import { useWorkspace } from '@/features/lesson/workspace';
import { firstOpenTask, lessonStatuses, progressOf, resumeTask } from '@/progress/gamification';
import { selectCourse, useProgress } from '@/progress/store';
import { Kbd } from '@/ui/Button';
import { filterCommands, type Command } from './commands';

function buildCommands(close: () => void): Command[] {
  const ui = useUi.getState();
  const ws = useWorkspace.getState();
  const cp = selectCourse(useProgress.getState());
  const statuses = lessonStatuses(course, cp);
  const go = (fn: () => void) => () => {
    close();
    fn();
  };
  const openLesson = (taskId?: string) => (lessonId: string) => {
    const lesson = course.worlds.flatMap((w) => w.lessons).find((l) => l.id === lessonId)!;
    const task = lesson.tasks.find((t) => t.id === taskId) ?? firstOpenTask(lesson, cp);
    void ws.openTask(task);
    ui.setView('lesson');
  };

  const commands: Command[] = [
    { id: 'map', group: 'Разделы', title: 'Карта навыков', run: go(() => ui.setView('map')) },
    {
      id: 'continue',
      group: 'Разделы',
      title: 'Продолжить обучение',
      run: go(() => {
        void ws.openTask(resumeTask(course, cp));
        ui.setView('lesson');
      }),
    },
    { id: 'profile', group: 'Разделы', title: 'Профиль и настройки', run: go(() => ui.setView('profile')) },
    { id: 'theme', group: 'Действия', title: 'Сменить тему оформления', run: go(() => ui.setTheme(nextThemePreference(ui.theme))) },
  ];
  if (ui.view === 'lesson' && ws.task) {
    commands.push(
      { id: 'next', group: 'Действия', title: 'Следующее задание', hint: 'Alt →', run: go(() => ws.goRelative(1)) },
      { id: 'prev', group: 'Действия', title: 'Предыдущее задание', hint: 'Alt ←', run: go(() => ws.goRelative(-1)) },
    );
    if ('solution' in ws.task) {
      commands.push({ id: 'reset', group: 'Действия', title: 'Сбросить базу задания', run: go(() => void ws.resetDatabase()) });
    }
  }
  for (const world of course.worlds) {
    for (const lesson of world.lessons) {
      const locked = statuses.get(lesson.id) === 'locked';
      commands.push({
        id: `lesson:${lesson.id}`,
        group: 'Уроки',
        title: lesson.title,
        hint: locked ? `${world.title} · закрыт` : world.title,
        disabled: locked,
        run: go(() => openLesson()(lesson.id)),
      });
    }
  }
  for (const world of course.worlds) {
    for (const lesson of world.lessons) {
      const locked = statuses.get(lesson.id) === 'locked';
      for (const task of lesson.tasks) {
        commands.push({
          id: `task:${task.id}`,
          group: 'Задания',
          title: task.title,
          hint: `${lesson.title}${progressOf(cp, task.id).solved ? ' · решено' : ''}`,
          disabled: locked,
          run: go(() => openLesson(task.id)(lesson.id)),
        });
      }
    }
  }
  return commands;
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useUi();
  if (!paletteOpen) return null;
  return <Palette onClose={() => setPaletteOpen(false)} />;
}

function Palette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(document.activeElement as HTMLElement | null);
  const commands = useMemo(() => buildCommands(onClose), [onClose]);
  const visible = filterCommands(commands, query);

  useEffect(() => {
    inputRef.current?.focus();
    const previous = restoreFocus.current;
    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + visible.length) % Math.max(visible.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const command = visible[active];
      if (command && !command.disabled) command.run();
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Палитра команд"
        className="w-[min(640px,92vw)] animate-rise overflow-hidden rounded-lg border border-line-strong bg-panel shadow-2xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={visible[active] ? `palette-${visible[active].id}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder="Урок, задание или действие…"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-[15px] outline-none placeholder:text-faint"
        />
        <ul id="palette-list" role="listbox" className="max-h-[52vh] overflow-y-auto py-1.5">
          {visible.length === 0 && <li className="px-4 py-3 text-[13px] text-faint">Ничего не найдено</li>}
          {visible.map((c, i) => (
            <li
              key={c.id}
              id={`palette-${c.id}`}
              role="option"
              aria-selected={i === active}
              aria-disabled={c.disabled}
              onMouseEnter={() => setActive(i)}
              onClick={() => !c.disabled && c.run()}
              className={`mx-1.5 flex cursor-pointer items-center gap-3 rounded px-2.5 py-2 text-[14px] ${
                i === active ? 'bg-raised' : ''
              } ${c.disabled ? 'cursor-not-allowed opacity-45' : ''}`}
            >
              <span className="w-16 shrink-0 font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">{c.group}</span>
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              {c.hint && <span className="shrink-0 truncate text-[12px] text-faint">{c.hint}</span>}
            </li>
          ))}
        </ul>
        <footer className="flex gap-4 border-t border-line px-4 py-2 text-[11.5px] text-faint">
          <span><Kbd>↑↓</Kbd> выбор</span>
          <span><Kbd>↵</Kbd> открыть</span>
          <span><Kbd>Esc</Kbd> закрыть</span>
        </footer>
      </div>
    </div>
  );
}
