import { describe, expect, it } from 'vitest';
import type { RuleRegistry } from './rules';

const registries = import.meta.glob<Record<string, unknown>>('./*/rules.ts', { eager: true });
const sources = import.meta.glob<string>('./**/*.test.ts', { query: '?raw', import: 'default', eager: true });

const isRegistry = (v: unknown): v is RuleRegistry =>
  typeof v === 'object' &&
  v !== null &&
  Object.values(v).length > 0 &&
  Object.values(v).every((r) => typeof r === 'object' && r !== null && 'url' in r && 'ru' in r && 'status' in r);

/** Every `[rule-id]` that appears inside a test or describe title. */
function pinned(): Set<string> {
  const ids = new Set<string>();
  const title = /\b(?:it|test|describe)(?:\.\w+)?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  for (const [file, src] of Object.entries(sources)) {
    if (file.endsWith('rules.coverage.test.ts')) continue;
    for (const m of src.matchAll(title)) for (const id of m[2].matchAll(/\[([a-z0-9][a-z0-9.-]*)\]/g)) ids.add(id[1]);
  }
  return ids;
}

describe('rule registries', () => {
  const found = Object.entries(registries).flatMap(([file, mod]) => Object.values(mod).filter(isRegistry).map((reg) => [file, reg] as const));
  it('at least one flavor registry is present', () => {
    expect(found.length).toBeGreaterThan(0);
  });
  for (const [file, reg] of found) {
    const ids = pinned();
    describe(file, () => {
      for (const id of Object.keys(reg)) {
        it(`rule ${id} appears in a test title`, () => {
          expect(ids.has(id)).toBe(true);
        });
      }
      it('every rule has a documentation url, a Russian text and a status', () => {
        for (const [id, r] of Object.entries(reg)) {
          expect(r.url, id).toMatch(/^https:\/\//);
          expect(r.ru, id).toMatch(/[а-яё]/i);
          expect(['exact', 'simplified'], id).toContain(r.status);
        }
      });
    });
  }
});
