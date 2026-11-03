import type { EngineKind } from '@/engine';
import { LessonParseError, parseLesson } from './parseLesson';
import {
  errorHintsSchema,
  manifestSchema,
  onboardingSchema,
  placementSchema,
  taskSchema,
  type Badge,
  type Level,
  type OnboardingData,
  type ParsedTask,
} from './schema';

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

export interface PlacementBlock {
  id: string;
  title: string;
  questions: Task[];
  /** Lessons credited when the block is passed. */
  unlocks: string[];
}

export interface Placement {
  title: string;
  intro: string;
  passThreshold: number;
  blocks: PlacementBlock[];
}

export type Onboarding = Omit<OnboardingData, 'firstQuery'> & { firstQuery: Extract<Task, { type: 'result' }> };

export interface Course {
  id: string;
  title: string;
  engine: EngineKind;
  worlds: World[];
  levels: Level[];
  badges: Badge[];
  placement: Placement | null;
  onboarding: Onboarding | null;
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

  const buildTask = (rawTask: Record<string, unknown>, where: string, lessonId: string, worldId: string): Task | null => {
    const result = taskSchema.safeParse(rawTask);
    if (!result.success) {
      problems.push(...formatIssues(where, result.error.issues));
      return null;
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
    return { ...task, lessonId, worldId, setupSql };
  };

  const parseFile = (path: string) => {
    const source = files[path];
    if (source === undefined) {
      problems.push(`${path}: файл не найден`);
      return null;
    }
    try {
      return parseLesson(source);
    } catch (e) {
      problems.push(`${path}: ${e instanceof LessonParseError ? e.message : String(e)}`);
      return null;
    }
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
      const raw = parseFile(path);
      if (!raw) return lesson;
      lesson.title = raw.title;
      lesson.theory = raw.theory;
      if (raw.tasks.length === 0) problems.push(`${path}: в уроке нет заданий`);

      for (const rawTask of raw.tasks) {
        const task = buildTask(rawTask, `${path} › ${String(rawTask.id)}`, ref.id, w.id);
        if (task) lesson.tasks.push(task);
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

  const placement = manifest.placement ? loadPlacement(manifest.placement) : null;
  const onboarding = manifest.onboarding ? loadOnboarding(manifest.onboarding) : null;

  function loadPlacement(file: string): Placement | null {
    const path = `${root}/${file}`;
    const parsed = placementSchema.safeParse(readJson(files, path, problems));
    if (!parsed.success) {
      if (files[path] !== undefined) problems.push(...formatIssues(path, parsed.error.issues));
      return null;
    }
    const questionsPath = `${root}/${parsed.data.questions}`;
    const raw = parseFile(questionsPath);
    if (!raw) return null;
    const tasks = new Map<string, Task>();
    for (const rawTask of raw.tasks) {
      const task = buildTask(rawTask, `${questionsPath} › ${String(rawTask.id)}`, 'placement', 'placement');
      if (task) tasks.set(task.id, task);
    }
    const used = new Set<string>();
    const blocks = parsed.data.blocks.map((b) => {
      unique('блок теста', b.id);
      b.unlocks.forEach((id) => !lessonIds.has(id) && problems.push(`${path} › ${b.id}: неизвестный урок «${id}»`));
      const questions = b.questions.flatMap((id) => {
        used.add(id);
        const task = tasks.get(id);
        if (!task) problems.push(`${path} › ${b.id}: неизвестный вопрос «${id}»`);
        return task ? [task] : [];
      });
      return { id: b.id, title: b.title, questions, unlocks: b.unlocks };
    });
    tasks.forEach((_, id) => !used.has(id) && problems.push(`${questionsPath}: вопрос «${id}» не входит ни в один блок`));
    return { title: raw.title, intro: raw.theory, passThreshold: parsed.data.passThreshold, blocks };
  }

  function loadOnboarding(file: string): Onboarding | null {
    const path = `${root}/${file}`;
    const parsed = onboardingSchema.safeParse(readJson(files, path, problems));
    if (!parsed.success) {
      if (files[path] !== undefined) problems.push(...formatIssues(path, parsed.error.issues));
      return null;
    }
    const data = parsed.data;
    const ids = (table: string) => data.tables[table]?.rows.map((r) => r[0]) ?? [];
    for (const step of data.steps) {
      const where = `${path} › ${step.id}`;
      if (step.kind === 'link') {
        if (!data.tables.customers || !data.tables.orders) problems.push(`${where}: нужны таблицы customers и orders`);
        step.orders.forEach((o) => {
          if (!ids('orders').includes(o.id)) problems.push(`${where}: нет заказа ${o.id}`);
          if (!ids('customers').includes(o.customer)) problems.push(`${where}: нет покупателя ${o.customer}`);
        });
        continue;
      }
      const table = data.tables[step.table];
      if (!table) problems.push(`${where}: нет таблицы «${step.table}»`);
      else if (step.kind === 'pickRow' && step.answer >= table.rows.length) problems.push(`${where}: строки ${step.answer} нет`);
      else if (step.kind === 'pickColumn' && !table.columns.includes(step.answer)) problems.push(`${where}: столбца «${step.answer}» нет`);
    }
    const firstQuery = buildTask(data.firstQuery, `${path} › firstQuery`, 'onboarding', 'onboarding');
    if (!firstQuery) return null;
    if (firstQuery.type !== 'result') {
      problems.push(`${path} › firstQuery: ожидается задание типа result`);
      return null;
    }
    return { ...data, firstQuery };
  }

  if (problems.length > 0) throw new CourseError(problems);
  return {
    id: manifest.id,
    title: manifest.title,
    engine: manifest.engine,
    worlds,
    levels: manifest.levels,
    badges: manifest.badges,
    placement,
    onboarding,
    errorHints: hints.success ? hints.data : {},
  };
}

export function allTasks(course: Course): Task[] {
  return course.worlds.flatMap((w) => w.lessons.flatMap((l) => l.tasks));
}

export function errorHint(course: Course, code: string): string | undefined {
  return course.errorHints[code] ?? course.errorHints[code.slice(0, 2)];
}
