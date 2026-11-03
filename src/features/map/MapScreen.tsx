import { useMemo } from 'react';
import { useUi } from '@/app/store';
import { course } from '@/content/course';
import type { Lesson, World } from '@/content/loadCourse';
import { useWorkspace } from '@/features/lesson/workspace';
import { firstOpenTask, isWorldComplete, lessonStatuses, nextLesson, progressOf, type LessonStatus } from '@/progress/gamification';
import type { CourseProgress } from '@/progress/model';
import { selectCourse, useProgress } from '@/progress/store';
import { Button } from '@/ui/Button';
import { CheckIcon, LockIcon } from '@/ui/icons';
import { ProgressBar } from '@/ui/ProgressBar';

export function MapScreen() {
  const cp = useProgress(selectCourse);
  const statuses = useMemo(() => lessonStatuses(course, cp), [cp]);
  const next = nextLesson(course, cp);
  const setView = useUi((s) => s.setView);

  const open = (lesson: Lesson) => {
    void useWorkspace.getState().openTask(firstOpenTask(lesson, cp));
    setView('lesson');
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1440px] px-6 py-6">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Карта навыков</p>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight">{course.title}</h1>
          </div>
          {next ? (
            <div className="flex items-center gap-4 rounded-md border border-line bg-panel py-2.5 pl-4 pr-2.5">
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-amber">Дальше по курсу</p>
                <p className="truncate text-[14px] font-medium">{next.title}</p>
              </div>
              <Button variant="check" onClick={() => open(next)}>
                Продолжить →
              </Button>
            </div>
          ) : (
            <p className="rounded-md border border-ok/40 bg-ok/10 px-4 py-2.5 text-[14px] text-ok">Все открытые уроки пройдены</p>
          )}
        </header>

        <ol className="grid grid-cols-[repeat(5,minmax(230px,1fr))] gap-3 overflow-x-auto pb-2">
          {course.worlds.map((world, i) => (
            <WorldColumn key={world.id} world={world} index={i} cp={cp} statuses={statuses} nextId={next?.id} onOpen={open} />
          ))}
        </ol>
      </div>
    </div>
  );
}

interface WorldColumnProps {
  world: World;
  index: number;
  cp: CourseProgress;
  statuses: Map<string, LessonStatus>;
  nextId?: string;
  onOpen: (lesson: Lesson) => void;
}

function WorldColumn({ world, index, cp, statuses, nextId, onOpen }: WorldColumnProps) {
  const done = world.lessons.filter((l) => statuses.get(l.id) === 'completed').length;
  const locked = world.lessons.length > 0 && world.lessons.every((l) => statuses.get(l.id) === 'locked');
  const complete = isWorldComplete(world, cp);

  return (
    <li className={`flex flex-col rounded-md border bg-panel ${complete ? 'border-ok/40' : 'border-line'} ${locked ? 'opacity-70' : ''}`}>
      <header className="border-b border-line p-3.5">
        <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
          Мир {index + 1}
          {locked && <LockIcon />}
          {complete && <CheckIcon className="text-ok" />}
          <span className="sr-only">{locked ? 'закрыт' : complete ? 'пройден' : 'открыт'}</span>
        </p>
        <h2 className="mt-1 text-[15px] font-semibold leading-snug">{world.title}</h2>
        <p className="mt-1 text-[12.5px] leading-snug text-dim">{world.summary}</p>
        <div className="mt-3 flex items-center gap-2">
          <ProgressBar value={world.lessons.length ? done / world.lessons.length : 0} tone={complete ? 'ok' : 'amber'} label={`Пройдено уроков: ${done} из ${world.lessons.length}`} />
          <span className="shrink-0 font-mono text-[11px] text-faint">
            {done}/{world.lessons.length}
          </span>
        </div>
      </header>
      <ol className="flex flex-col p-2.5">
        {world.lessons.map((lesson, i) => (
          <LessonNode
            key={lesson.id}
            lesson={lesson}
            status={statuses.get(lesson.id) ?? 'locked'}
            isNext={lesson.id === nextId}
            first={i === 0}
            last={i === world.lessons.length - 1}
            cp={cp}
            onOpen={onOpen}
          />
        ))}
        {world.lessons.length === 0 && <p className="p-2 text-[12px] text-faint">Уроки этого мира ещё не опубликованы.</p>}
      </ol>
    </li>
  );
}

interface LessonNodeProps {
  lesson: Lesson;
  status: LessonStatus;
  isNext: boolean;
  first: boolean;
  last: boolean;
  cp: CourseProgress;
  onOpen: (lesson: Lesson) => void;
}

function LessonNode({ lesson, status, isNext, first, last, cp, onOpen }: LessonNodeProps) {
  const solved = lesson.tasks.filter((t) => progressOf(cp, t.id).solved).length;
  const node =
    status === 'completed'
      ? 'border-ok bg-ok text-on-accent'
      : status === 'available'
        ? `border-amber bg-bg ${isNext ? 'ring-4 ring-amber/20' : ''}`
        : 'border-line-strong bg-panel text-faint';

  return (
    <li className="relative pl-8">
      <span
        aria-hidden="true"
        className={`absolute left-[11px] w-px bg-line-strong ${first ? 'top-5' : 'top-0'} ${last ? 'h-5' : 'bottom-0'}`}
      />
      <span aria-hidden="true" className={`absolute left-[2px] top-[11px] grid h-[19px] w-[19px] place-items-center rounded-full border-2 ${node}`}>
        {status === 'completed' && <CheckIcon width={11} height={11} strokeWidth={2.4} />}
        {status === 'locked' && <LockIcon width={9} height={9} />}
      </span>
      <button
        type="button"
        disabled={status === 'locked'}
        onClick={() => onOpen(lesson)}
        title={status === 'locked' ? 'Сначала пройдите предыдущие уроки' : undefined}
        className="group my-0.5 w-full rounded px-2.5 py-2 text-left transition enabled:hover:bg-raised disabled:cursor-not-allowed"
      >
        <span className={`block text-[13.5px] font-medium leading-snug ${status === 'locked' ? 'text-faint' : 'text-fg'}`}>
          {lesson.title}
        </span>
        <span className="mt-1.5 flex items-center gap-1">
          {lesson.tasks.map((t) => (
            <span key={t.id} className={`h-1.5 w-3.5 rounded-full ${progressOf(cp, t.id).solved ? 'bg-ok' : 'bg-line-strong'}`} />
          ))}
          <span className="ml-auto font-mono text-[11px] text-faint">
            {cp.passedLessons.includes(lesson.id) ? 'зачтено' : `${solved}/${lesson.tasks.length}`}
          </span>
        </span>
        <span className="sr-only">
          {status === 'completed' ? 'пройден' : status === 'available' ? 'доступен' : 'закрыт'}
        </span>
      </button>
    </li>
  );
}
