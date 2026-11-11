// Content QA for drill courses: every task, level and seed 1..30 must render its statement, hints, explanation and
// starter strictly; every generator shape needs a task; vocab lists must be big enough; theory examples must render.
// The fixture course always runs; any course under private/*/course with engine "drill" runs when present.
// Run with `npm run validate:content`.
import { describe, expect, it } from 'vitest';
import { loadCourse, type Course, type Task } from '@/content/loadCourse';
import { theoryExampleBlocks } from '@/content/theory';
import type { DrillTask } from '@/content/schema';
import { fileName } from '@/engine/drill/data';
import { makeInstance } from '@/engine/drill/instance';
import { registry } from '@/engine/drill/registry';
import { renderTemplate } from '@/engine/drill/render';
import { LEVELS, type Instance, type Level } from '@/engine/drill/types';
import { drillRoots, readTree } from './drillCourses.ts';

const SEEDS = 30;

const isDrill = (t: Task): t is Task & DrillTask => t.type === 'drill';

function renderAll(task: DrillTask, inst: Instance): string[] {
  const files = inst.files.flatMap((f) => (f.kind === 'table' ? f.tables.map((t) => fileName(inst.n, inst.seed, 'csv', t.key)) : [fileName(inst.n, inst.seed, 'txt')]));
  const out = [
    renderTemplate(task.prompt, inst.fields),
    ...task.hints.map((h) => renderTemplate(h, inst.fields)),
    renderTemplate(task.explain, { ...inst.fields, ...inst.steps, answer: inst.answer }),
  ];
  if (task.pythonStarter) out.push(renderTemplate(task.pythonStarter, { ...inst.fields, file: files }));
  return out;
}

for (const root of drillRoots()) {
  describe(`drill course ${root}`, () => {
    const course: Course = loadCourse(readTree(root), `/${root}`);
    const config = course.drill!;
    const lessons = course.worlds.flatMap((w) => w.lessons);
    const numbers = config.numbers.map(({ n, lesson }) => ({ n, lesson: lessons.find((l) => l.id === lesson)! }));

    it('has a drill config with known generators', () => {
      expect(course.engine).toBe('drill');
      for (const { n, lesson } of numbers) {
        const tasks = lesson.tasks.filter(isDrill);
        expect(tasks.length, `number ${n}`).toBeGreaterThan(0);
        for (const t of tasks) expect(registry[t.generator as keyof typeof registry], `${t.id}: generator`).toBeDefined();
      }
    });

    it('covers every shape of every used generator', () => {
      for (const { n, lesson } of numbers) {
        const tasks = lesson.tasks.filter(isDrill);
        const gen = registry[tasks[0].generator as keyof typeof registry];
        expect(tasks.map((t) => t.shape).sort(), `number ${n}`).toEqual([...gen.shapes].sort());
      }
    });

    it('has big enough vocab lists', () => {
      for (const { lesson } of numbers) {
        for (const t of lesson.tasks.filter(isDrill)) {
          for (const [key, min] of Object.entries(registry[t.generator as keyof typeof registry].vocab ?? {})) {
            expect(t.vocab[key]?.length ?? 0, `${t.id}: vocab "${key}"`).toBeGreaterThanOrEqual(min);
          }
        }
      }
    });

    it(`renders every task, level and seed 1..${SEEDS} strictly`, () => {
      for (const { n, lesson } of numbers) {
        for (const task of lesson.tasks.filter(isDrill)) {
          for (const level of task.levels) {
            for (let seed = 1; seed <= SEEDS; seed++) {
              const inst = makeInstance(task, n, level, seed);
              const texts = renderAll(task, inst);
              texts.forEach((text, i) => expect(text, `${inst.key} part ${i}`).not.toContain('{{'));
              expect(texts[0].trim(), `${inst.key} statement`).not.toBe('');
            }
          }
        }
      }
    });

    it('renders the theory examples', () => {
      for (const { n, lesson } of numbers) {
        for (const block of theoryExampleBlocks(lesson.theory).filter((b) => b.lang === 'drill')) {
          const ref = JSON.parse(block.code) as { task: string; level: Level; seed: number };
          const task = lesson.tasks.filter(isDrill).find((t) => t.id === ref.task);
          expect(task, `example of ${lesson.id}: task ${ref.task}`).toBeDefined();
          expect(LEVELS).toContain(ref.level);
          expect(task!.levels).toContain(ref.level);
          const inst = makeInstance(task!, n, ref.level, ref.seed);
          for (const text of renderAll(task!, inst)) expect(text).not.toContain('{{');
        }
      }
    });
  });
}
