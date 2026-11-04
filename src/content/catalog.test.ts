import { describe, expect, it } from 'vitest';
import { loadCatalog } from './catalog';
import { CourseError } from './loadCourse';

const fence = '```';

function courseFiles(id: string, manifestId = id): Record<string, string> {
  const root = `/courses/${id}`;
  return {
    [`${root}/manifest.json`]: JSON.stringify({
      id: manifestId,
      title: `Course ${id}`,
      description: 'D',
      engine: 'postgres',
      errors: 'errors.json',
      worlds: [{ id: 'w1', title: 'W', summary: 'S', lessons: [{ id: `${id}-l1`, file: 'l1.md' }] }],
      levels: [
        { xp: 0, title: 'A' },
        { xp: 10, title: 'B' },
      ],
    }),
    [`${root}/errors.json`]: '{}',
    [`${root}/l1.md`]: `# L\n## task ${id}-t1\n${fence}json\n{ "type": "result", "title": "T", "hints": ["h"] }\n${fence}\nP\n${fence}sql solution\nSELECT 1\n${fence}\n`,
  };
}

const platform = (courses: string[]) => ({
  '/courses/platform.json': JSON.stringify({
    courses,
    levels: [
      { xp: 0, title: 'Trainee' },
      { xp: 100, title: 'Junior' },
    ],
  }),
});

describe('loadCatalog', () => {
  it('loads the listed courses in order with tasks tagged by course', () => {
    const catalog = loadCatalog({ ...courseFiles('alpha'), ...courseFiles('beta'), ...platform(['beta', 'alpha']) });
    expect(catalog.courses.map((c) => c.id)).toEqual(['beta', 'alpha']);
    expect(catalog.courses[1].worlds[0].lessons[0]).toMatchObject({ courseId: 'alpha' });
    expect(catalog.courses[1].worlds[0].lessons[0].tasks[0]).toMatchObject({ id: 'alpha-t1', courseId: 'alpha' });
    expect(catalog.platform.levels.map((l) => l.title)).toEqual(['Trainee', 'Junior']);
  });

  it('reports missing courses and id mismatches together', () => {
    let error: CourseError | undefined;
    try {
      loadCatalog({ ...courseFiles('alpha', 'other'), ...platform(['alpha', 'ghost']) });
    } catch (e) {
      error = e as CourseError;
    }
    expect(error).toBeInstanceOf(CourseError);
    expect(error!.problems.join('\n')).toMatch(/alpha\/manifest\.json: id «other» не совпадает/);
    expect(error!.problems.join('\n')).toMatch(/ghost\/manifest\.json: файл не найден/);
  });

  it('requires platform.json', () => {
    expect(() => loadCatalog(courseFiles('alpha'))).toThrow(CourseError);
  });
});
