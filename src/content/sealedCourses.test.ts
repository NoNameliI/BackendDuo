import { afterEach, describe, expect, it } from 'vitest';
import { courseCommands } from '@/features/palette/commands';
import { sealFiles } from '@/platform/sealed';
import { courses, registerSealed, unregisterSealed } from './courses';
import { createSealedRegistry } from './sealedCourses';

const CODE = 'test-access-0001';
const fence = '```';

const files: Record<string, string> = {
  '/sealed/t1/manifest.json': JSON.stringify({
    id: 't1',
    title: 'Pack one',
    description: 'D',
    engine: 'postgres',
    errors: 'errors.json',
    worlds: [{ id: 'w1', title: 'W', summary: 'S', lessons: [{ id: 't1-l1', file: 'l1.md' }] }],
    levels: [
      { xp: 0, title: 'A' },
      { xp: 10, title: 'B' },
    ],
  }),
  '/sealed/t1/errors.json': '{}',
  '/sealed/t1/l1.md': `# L\n## task t1-q\n${fence}json\n{ "type": "choice", "title": "Q", "options": ["a", "b"], "answer": [0], "explanation": "E", "hints": ["h"] }\n${fence}\nPick one.\n`,
};

async function setup() {
  const pack = await sealFiles(files, CODE, { iterations: 1000 });
  let stored: { packs: Record<string, { salt: string; key: string }> } | undefined;
  const registry = createSealedRegistry({
    packs: () => ({ 'one.bin': 'mem://one' }),
    fetchText: async () => pack,
    read: async () => stored,
    write: async (doc) => {
      stored = JSON.parse(JSON.stringify(doc));
    },
    register: registerSealed,
    unregister: unregisterSealed,
  });
  return { registry, stored: () => stored };
}

const has = () => courses.some((c) => c.id === 't1');
const paletteHas = () => courseCommands(courses, 'other', (fn) => fn, () => {}).some((c) => c.id === 'course:t1');

afterEach(() => unregisterSealed());

describe('sealed registry', () => {
  it('registers nothing before unlock and on a wrong code', async () => {
    const { registry } = await setup();
    expect(has()).toBe(false);
    expect(await registry.unlock('test-access-0002')).toBe(false);
    expect(has()).toBe(false);
    expect(registry.hasAccess()).toBe(false);
  });

  it('opens with the right code and stores only the key', async () => {
    const { registry, stored } = await setup();
    expect(await registry.unlock(CODE)).toBe(true);
    expect(has()).toBe(true);
    expect(courses.find((c) => c.id === 't1')?.sealed).toBe(true);
    expect(paletteHas()).toBe(true);
    expect(registry.hasAccess()).toBe(true);
    expect(JSON.stringify(stored())).not.toContain(CODE);
    expect(Object.keys(stored()!.packs)).toEqual(['one.bin']);
  });

  it('restores access and locks again', async () => {
    const { registry, stored } = await setup();
    await registry.unlock(CODE);
    unregisterSealed();
    expect(has()).toBe(false);
    await registry.restoreAccess();
    expect(has()).toBe(true);
    await registry.lockAccess();
    expect(has()).toBe(false);
    expect(stored()!.packs).toEqual({});
    expect(registry.hasAccess()).toBe(false);
  });
});
