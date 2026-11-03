import { describe, expect, it } from 'vitest';
import { CourseError, errorHint, loadCourse } from './loadCourse';

const fence = '```';
const ROOT = '/courses/demo';

const task = (id: string, extra = '') => `## task ${id}
${fence}json
{ "type": "result", "title": "T", "hints": ["h"]${extra} }
${fence}
Prompt
${fence}sql solution
SELECT 1
${fence}
`;

const manifest = (lessons: object[], extra: object = {}) =>
  JSON.stringify({
    id: 'demo',
    title: 'Demo',
    engine: 'postgres',
    errors: 'errors.json',
    datasets: { shop: 'datasets/shop.sql' },
    worlds: [
      { id: 'w1', title: 'W1', summary: 'S', lessons },
      { id: 'w2', title: 'W2', summary: 'S', lessons: [] },
    ],
    ...extra,
  });

const files = (overrides: Record<string, string> = {}) => ({
  [`${ROOT}/manifest.json`]: manifest([
    { id: 'l1', file: 'w1/l1.md' },
    { id: 'l2', file: 'w1/l2.md' },
  ]),
  [`${ROOT}/errors.json`]: JSON.stringify({ '42703': 'нет колонки', '23': 'ограничение' }),
  [`${ROOT}/datasets/shop.sql`]: 'CREATE TABLE shop (id int);',
  [`${ROOT}/w1/l1.md`]: `# Урок 1\nТеория\n${task('t1', ', "dataset": "shop", "xp": 20')}`,
  [`${ROOT}/w1/l2.md`]: `# Урок 2\n${task('t2')}`,
  ...overrides,
});

describe('loadCourse', () => {
  it('builds worlds, lessons and tasks with resolved setup and default dependencies', () => {
    const course = loadCourse(files(), ROOT);
    expect(course.worlds.map((w) => [w.id, w.requires])).toEqual([
      ['w1', []],
      ['w2', ['w1']],
    ]);
    const [l1, l2] = course.worlds[0].lessons;
    expect(l1).toMatchObject({ title: 'Урок 1', theory: 'Теория', requires: [] });
    expect(l2.requires).toEqual(['l1']);
    expect(l1.tasks[0]).toMatchObject({ id: 't1', xp: 20, lessonId: 'l1', worldId: 'w1', setupSql: 'CREATE TABLE shop (id int);' });
    expect(l2.tasks[0]).toMatchObject({ xp: 10, setupSql: '', check: { ordered: false, columnNames: true } });
    expect(errorHint(course, '42703')).toBe('нет колонки');
    expect(errorHint(course, '23505')).toBe('ограничение');
  });

  it('collects every problem into one CourseError', () => {
    const broken = files({
      [`${ROOT}/manifest.json`]: manifest([
        { id: 'l1', file: 'w1/l1.md' },
        { id: 'l2', file: 'w1/l2.md', requires: ['ghost'] },
        { id: 'l3', file: 'w1/missing.md' },
      ]),
      [`${ROOT}/w1/l1.md`]: `# Урок 1\n${task('t1', ', "dataset": "nope"')}${task('t1')}`,
      [`${ROOT}/w1/l2.md`]: `# Урок 2\n${task('t2', ', "hints": []')}`,
    });
    let error: CourseError | undefined;
    try {
      loadCourse(broken, ROOT);
    } catch (e) {
      error = e as CourseError;
    }
    expect(error).toBeInstanceOf(CourseError);
    const text = error!.problems.join('\n');
    expect(text).toContain('неизвестный набор данных «nope»');
    expect(text).toContain('повторяется задание «t1»');
    expect(text).toContain('w1/l2.md › t2 › hints');
    expect(text).toContain('w1/missing.md: файл урока не найден');
    expect(text).toContain('урок l2: неизвестная зависимость «ghost»');
  });

  it('rejects an invalid manifest', () => {
    expect(() => loadCourse(files({ [`${ROOT}/manifest.json`]: '{"id": "Demo"}' }), ROOT)).toThrow(CourseError);
  });
});
