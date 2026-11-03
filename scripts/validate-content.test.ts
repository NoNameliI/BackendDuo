// Content QA: every SQL task's reference solution must pass its own check on a fresh sandbox,
// and the starter code must not. Run with `npm run validate:content`.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChecker } from '@/checker';
import { loadCourse, type Course, type Task } from '@/content/loadCourse';
import { PostgresEngine } from '@/engine/postgres/PostgresEngine';

const COURSES = ['postgres'];

function readTree(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[`/${relative(process.cwd(), path).replaceAll('\\', '/')}`] = readFileSync(path, 'utf8');
  }
  return files;
}

const engine = new PostgresEngine();
const checker = createChecker(engine);

beforeAll(() => engine.init());
afterAll(() => engine.dispose());

async function validateTask(task: Task) {
  if (task.type === 'choice' || task.type === 'review') {
    expect((await checker.check(task, { kind: 'choice', selected: task.answer })).passed).toBe(true);
    const wrong = task.options.map((_, i) => i).filter((i) => !task.answer.includes(i));
    expect((await checker.check(task, { kind: 'choice', selected: wrong })).passed).toBe(false);
    return;
  }
  const solved = await checker.check(task, { kind: 'sql', code: task.solution });
  expect(solved.error, 'reference solution raised an SQL error').toBeUndefined();
  expect(solved.problems, 'reference solution must pass its own check').toEqual([]);
  const untouched = await checker.check(task, { kind: 'sql', code: task.starter });
  expect(untouched.passed, 'starter code must not pass the check').toBe(false);
}

for (const id of COURSES) {
  const root = `/courses/${id}`;
  let course: Course | undefined;
  let loadError: unknown;
  try {
    course = loadCourse(readTree(`courses/${id}`), root);
  } catch (e) {
    loadError = e;
  }

  describe(`course ${id}`, () => {
    it('loads without structural problems', () => {
      if (loadError) throw loadError;
    });

    for (const world of course?.worlds ?? []) {
      for (const lesson of world.lessons) {
        describe(`${world.id} › ${lesson.id}`, () => {
          for (const task of lesson.tasks) {
            it(`${task.id} (${task.type})`, () => validateTask(task));
          }
        });
      }
    }

    describe('placement and onboarding', () => {
      const extra = [...(course?.placement?.blocks.flatMap((b) => b.questions) ?? []), ...(course?.onboarding ? [course.onboarding.firstQuery] : [])];
      for (const task of extra) {
        it(`${task.id} (${task.type})`, () => validateTask(task));
      }
    });
  });
}
