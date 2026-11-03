import type { EngineKind } from '@/engine';
import { LessonParseError, parseLesson } from './parseLesson';
import { errorHintsSchema, manifestSchema, taskSchema, type Badge, type Level, type ParsedTask } from './schema';

export type Task = ParsedTask & {
  lessonId: string;
  worldId: string;
  /** Dataset script followed by the task's own setup. */
  setupSql: string;
};

export type SqlTask = Extract<Task, { solution: string }>;
export type ChoiceTask = Extract<Task, { type: 'choice' | 'review' }>;

export interface Lesson {
  id: string;
  worldId: string;
  title: string;
  theory: string;
  requires: string[];
  tasks: Task[];
}

export interface World {
  id: string;
  title: string;
  summary: string;
  requires: string[];
  lessons: Lesson[];
}

export interface Course {
  id: string;
  title: string;
  engine: EngineKind;
  worlds: World[];
  levels: Level[];
  badges: Badge[];
  errorHints: Record<string, string>;
}

export class CourseError extends Error {
  constructor(readonly problems: string[]) {
    super(`Курс содержит ошибки:\n${problems.map((p) => `  • ${p}`).join('\n')}`);
  }
}

function readJson(files: Record<string, string>, path: string, problems: string[]): unknown {
  const raw = files[path];
  if (raw === undefined) {
    problems.push(`${path}: файл не найден`);
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    problems.push(`${path}: ${(e as Error).message}`);
    return undefined;
  }
}

function formatIssues(where: string, issues: { path: PropertyKey[]; message: string }[]): string[] {
  return issues.map((i) => `${where}${i.path.length ? ` › ${i.path.join('.')}` : ''}: ${i.message}`);
}

/**
 * Builds a validated course from its files. `files` maps paths (as `root/...`) to raw text,
 * so the same loader serves the app (import.meta.glob) and Node tooling (fs).
 * All problems are collected and thrown together as a CourseError.
 */
export function loadCourse(files: Record<string, string>, root: string): Course {
  const problems: string[] = [];
  const manifestPath = `${root}/manifest.json`;
  const parsed = manifestSchema.safeParse(readJson(files, manifestPath, problems));
  if (!parsed.success) {
    if (files[manifestPath] !== undefined) problems.push(...formatIssues(manifestPath, parsed.error.issues));
    throw new CourseError(problems);
  }
  const manifest = parsed.data;

  const datasets: Record<string, string> = {};
  for (const [name, file] of Object.entries(manifest.datasets)) {
    const sql = files[`${root}/${file}`];
    if (sql === undefined) problems.push(`${root}/${file}: файл набора данных «${name}» не найден`);
    else datasets[name] = sql;
  }

  const errorsPath = `${root}/${manifest.errors}`;
  const hints = errorHintsSchema.safeParse(readJson(files, errorsPath, problems) ?? {});
  if (!hints.success) problems.push(...formatIssues(errorsPath, hints.error.issues));

  const seen = new Set<string>();
  const unique = (kind: string, id: string) => {
    if (seen.has(`${kind}:${id}`)) problems.push(`повторяется ${kind} «${id}»`);
    seen.add(`${kind}:${id}`);
  };

  const worlds: World[] = manifest.worlds.map((w, wi) => {
    unique('мир', w.id);
    const lessons: Lesson[] = w.lessons.map((ref, li) => {
      unique('урок', ref.id);
      const path = `${root}/${ref.file}`;
      const source = files[path];
      const lesson: Lesson = {
        id: ref.id,
        worldId: w.id,
        title: ref.id,
        theory: '',
        requires: ref.requires ?? (li > 0 ? [w.lessons[li - 1].id] : []),
        tasks: [],
      };
      if (source === undefined) {
        problems.push(`${path}: файл урока не найден`);
        return lesson;
      }
      let raw;
      try {
        raw = parseLesson(source);
      } catch (e) {
        problems.push(`${path}: ${e instanceof LessonParseError ? e.message : String(e)}`);
        return lesson;
      }
      lesson.title = raw.title;
      lesson.theory = raw.theory;
      if (raw.tasks.length === 0) problems.push(`${path}: в уроке нет заданий`);

      for (const rawTask of raw.tasks) {
        const result = taskSchema.safeParse(rawTask);
        const where = `${path} › ${String(rawTask.id)}`;
        if (!result.success) {
          problems.push(...formatIssues(where, result.error.issues));
          continue;
        }
        const task = result.data;
        unique('задание', task.id);
        let setupSql = '';
        if ('solution' in task) {
          if (task.dataset && datasets[task.dataset] === undefined) {
            problems.push(`${where}: неизвестный набор данных «${task.dataset}»`);
          }
          setupSql = [task.dataset ? datasets[task.dataset] : '', task.setup].filter((s) => s?.trim()).join('\n\n');
        }
        lesson.tasks.push({ ...task, lessonId: ref.id, worldId: w.id, setupSql });
      }
      return lesson;
    });
    return {
      id: w.id,
      title: w.title,
      summary: w.summary,
      requires: w.requires ?? (wi > 0 ? [manifest.worlds[wi - 1].id] : []),
      lessons,
    };
  });

  const worldIds = new Set(worlds.map((w) => w.id));
  const lessonIds = new Set(worlds.flatMap((w) => w.lessons.map((l) => l.id)));
  for (const w of worlds) {
    for (const r of w.requires) if (!worldIds.has(r)) problems.push(`мир ${w.id}: неизвестная зависимость «${r}»`);
    for (const l of w.lessons) {
      for (const r of l.requires) if (!lessonIds.has(r)) problems.push(`урок ${l.id}: неизвестная зависимость «${r}»`);
    }
  }

  for (const b of manifest.badges) {
    unique('бейдж', b.id);
    if (b.rule.kind === 'worldCompleted' && !worldIds.has(b.rule.world)) {
      problems.push(`бейдж ${b.id}: неизвестный мир «${b.rule.world}»`);
    }
  }

  if (problems.length > 0) throw new CourseError(problems);
  return {
    id: manifest.id,
    title: manifest.title,
    engine: manifest.engine,
    worlds,
    levels: manifest.levels,
    badges: manifest.badges,
    errorHints: hints.success ? hints.data : {},
  };
}

export function allTasks(course: Course): Task[] {
  return course.worlds.flatMap((w) => w.lessons.flatMap((l) => l.tasks));
}

export function errorHint(course: Course, code: string): string | undefined {
  return course.errorHints[code] ?? course.errorHints[code.slice(0, 2)];
}
