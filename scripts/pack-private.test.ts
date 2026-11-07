import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { deriveKey, openPack, packSalt } from '@/platform/sealed';
import { checkCode, collectCourse, packCourse, PackError } from './pack-private';

const CODE = 'test-access-0002';
const dir = mkdtempSync(join(tmpdir(), 'pack-private-'));
const course = join(dir, 'tiny', 'course');
mkdirSync(join(course, 'w1'), { recursive: true });
mkdirSync(join(course, 'datasets'), { recursive: true });
writeFileSync(
  join(course, 'manifest.json'),
  JSON.stringify({
    id: 'tiny',
    title: 'Tiny',
    description: 'd',
    engine: 'postgres',
    errors: 'errors.json',
    datasets: { shop: 'datasets/shop.sql' },
    worlds: [{ id: 'w1', title: 'W', summary: 's', lessons: [{ id: 'l1', file: 'w1/01.md' }] }],
    levels: [{ xp: 0, title: 'L0' }, { xp: 100, title: 'L1' }],
    badges: [],
  }),
);
writeFileSync(join(course, 'errors.json'), '{}');
writeFileSync(join(course, 'datasets', 'shop.sql'), 'create table t(id int);');
const TASK = '```json\n{"type":"choice","title":"T","options":["a","b"],"answer":[0],"explanation":"e","hints":["h"]}\n```\nQ?\n';
const LESSON = `# Lesson\n\nTheory.\n\n## task t1\n\n${TASK}`;
writeFileSync(join(course, 'w1', '01.md'), LESSON);
writeFileSync(join(course, 'ignored.png'), 'x');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('pack-private', () => {
  it('maps files to sealed paths and skips non-text files', () => {
    const { id, files } = collectCourse(course);
    expect(id).toBe('tiny');
    expect(Object.keys(files).sort()).toEqual([
      '/sealed/tiny/datasets/shop.sql',
      '/sealed/tiny/errors.json',
      '/sealed/tiny/manifest.json',
      '/sealed/tiny/w1/01.md',
    ]);
  });

  it('seals a course that opens with the same code', async () => {
    const { id, text, count } = await packCourse(course, CODE, { iterations: 1000 });
    expect(id).toBe('tiny');
    expect(count).toBe(4);
    const { salt, iterations } = packSalt(text);
    const files = await openPack(text, await deriveKey(CODE, salt, iterations));
    expect(files['/sealed/tiny/w1/01.md']).toBe(LESSON);
    expect(Object.keys(files)).toHaveLength(4);
  });

  it('refuses short codes and broken courses', async () => {
    expect(() => checkCode('short')).toThrow(PackError);
    await expect(packCourse(course, 'short', { iterations: 1000 })).rejects.toThrow(/12/);
    rmSync(join(course, 'errors.json'));
    await expect(packCourse(course, CODE, { iterations: 1000 })).rejects.toThrow();
  });
});
