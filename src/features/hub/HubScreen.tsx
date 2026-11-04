import { openCourse } from '@/app/openCourse';
import { useUi } from '@/app/store';
import { courses, platform } from '@/content/courses';
import type { Course } from '@/content/loadCourse';
import { isLessonComplete, levelInfo, localDay, streakInfo, totalXp } from '@/progress/gamification';
import { globalXp, selectCourse, useProgress } from '@/progress/store';
import { Button } from '@/ui/Button';
import { plural } from '@/ui/format';
import { FlameIcon } from '@/ui/icons';
import { ProgressBar } from '@/ui/ProgressBar';

export function HubScreen() {
  const doc = useProgress((s) => s.doc);
  const activeId = useUi((s) => s.courseId);
  const xp = globalXp(doc);
  const level = levelInfo(xp, platform.levels);
  const streak = streakInfo(doc.activity, localDay());

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1100px] px-6 py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Учебная платформа</p>
            <h1 className="mt-1 text-[28px] font-semibold tracking-tight">Курсы</h1>
          </div>
          <p className="flex items-center gap-4 font-mono text-[13px] text-dim">
            <span>
              уровень {level.index + 1} · <span className="text-fg">{level.title}</span> · <span className="text-ok">{xp}</span> XP
            </span>
            <span className={`flex items-center gap-1 ${streak.activeToday ? 'text-amber' : 'text-faint'}`}>
              <FlameIcon /> {streak.current} {plural(streak.current, 'день', 'дня', 'дней')}
            </span>
          </p>
        </header>
        <ul className="grid gap-3 md:grid-cols-2">
          {courses.map((course) => (
            <CourseCard key={course.id} course={course} active={course.id === activeId} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function CourseCard({ course, active }: { course: Course; active: boolean }) {
  const cp = useProgress(selectCourse(course.id));
  const lessons = course.worlds.flatMap((w) => w.lessons);
  const done = lessons.filter((l) => isLessonComplete(l, cp)).length;
  const started = Boolean(cp.onboarding) || Object.keys(cp.tasks).length > 0;
  const rank = levelInfo(totalXp(course, cp), course.levels).title;

  return (
    <li className={`flex flex-col rounded-md border bg-panel p-5 ${active ? 'border-amber/50' : 'border-line'}`}>
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
        {course.worlds.length} {plural(course.worlds.length, 'мир', 'мира', 'миров')} · {lessons.length}{' '}
        {plural(lessons.length, 'урок', 'урока', 'уроков')}
      </p>
      <h2 className="mt-1 text-[20px] font-semibold tracking-tight">{course.title}</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-dim">{course.description}</p>
      <div className="mt-4 flex items-center gap-2">
        <ProgressBar value={lessons.length ? done / lessons.length : 0} tone="ok" label={`Пройдено уроков: ${done} из ${lessons.length}`} />
        <span className="shrink-0 font-mono text-[11px] text-faint">
          {done}/{lessons.length}
        </span>
      </div>
      <p className="mt-2 text-[12.5px] text-faint">{started ? `Ранг в курсе: ${rank}` : 'Курс ещё не начат'}</p>
      <Button variant="check" className="mt-4 self-start" onClick={() => openCourse(course.id)}>
        {started ? 'Продолжить →' : 'Начать →'}
      </Button>
    </li>
  );
}
