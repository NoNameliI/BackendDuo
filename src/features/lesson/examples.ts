import { course } from '@/content/course';
import type { Lesson } from '@/content/loadCourse';
import { createEngine, type ExecOutcome, type SandboxEngine } from '@/engine';

// Theory examples run in a sandbox of their own, so trying them never disturbs the task database.
// Examples of one lesson share a database and run in order, like a script typed by hand.
let engine: SandboxEngine | null = null;
let loadedLesson: string | null = null;
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

async function load(lesson: Lesson): Promise<SandboxEngine> {
  engine ??= createEngine(course.engine);
  await engine.reset(lesson.exampleSetup);
  loadedLesson = lesson.id;
  return engine;
}

export function runExample(lesson: Lesson, sql: string): Promise<ExecOutcome> {
  return serial(async () => {
    const sandbox = loadedLesson === lesson.id && engine ? engine : await load(lesson);
    return sandbox.execute(sql);
  });
}

export function resetExamples(lesson: Lesson): Promise<void> {
  return serial(async () => {
    await load(lesson);
  });
}
