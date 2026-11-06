import { describe, expect, it } from 'vitest';
import { normalizeAnswer } from './answer';
import { draw, MAX_TRIES } from './instance';
import { registry } from './registry';
import { hashSeed } from './rng';
import { LEVELS, type Brute, type Generator } from './types';

const brutes = import.meta.glob<{ brute: Brute<unknown> }>('./gen/g*.brute.ts', { eager: true });
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

const bruteOf = (id: string): Brute<unknown> | undefined => brutes[`./gen/${id}.brute.ts`]?.brute;

/** Placeholder word lists of the minimum size each generator asks the pack for. */
const placeholderVocab = (gen: Generator<unknown>) =>
  Object.fromEntries(Object.entries(gen.vocab ?? {}).map(([k, size]) => [k, Array.from({ length: size }, (_, i) => `${k}${i + 1}`)]));

describe('registry', () => {
  it('has a brute for every generator', () => {
    for (const id of Object.keys(registry)) expect(bruteOf(id), `${id}.brute.ts`).toBeTypeOf('function');
  });
});

for (const [id, gen] of Object.entries(registry)) {
  describe(id, () => {
    for (const level of LEVELS) {
      it(`${level}: brute agrees with solve on ${SEEDS.length} seeds`, () => {
        const brute = bruteOf(id)!;
        const tries: number[] = [];
        const times: number[] = [];
        for (const seed of SEEDS) {
          const shape = gen.shapes[seed % gen.shapes.length];
          const vocab = placeholderVocab(gen);
          const t0 = performance.now();
          const a = draw(gen, { seed, level, shape, vocab });
          times.push(performance.now() - t0);
          tries.push(a.tries);
          expect(brute(a.params), `${level}/${shape}/seed ${seed}`).toEqual([a.solved.answer]);
          const n = normalizeAnswer(a.solved.answer, gen.answer);
          expect(n.ok && n.value, 'canonical answer').toBe(a.solved.answer);
          const b = draw(gen, { seed, level, shape, vocab });
          expect(JSON.stringify(b)).toBe(JSON.stringify(a));
        }
        expect(tries.reduce((s, x) => s + x, 0) / tries.length, 'mean tries').toBeLessThanOrEqual(5);
        expect(Math.max(...tries), 'max tries').toBeLessThan(MAX_TRIES);
        times.sort((x, y) => x - y);
        expect(times[Math.floor(times.length * 0.95)], 'p95 ms').toBeLessThanOrEqual(50);
      });

    }
  });
}

it('first seeds of every level keep their stream', () => {
  const out: Record<string, string[]> = {};
  for (const [id, gen] of Object.entries(registry)) {
    for (const level of LEVELS) {
      out[`${id}/${level}`] = [1, 2, 3].map((seed) => {
        const shape = gen.shapes[seed % gen.shapes.length];
        const r = draw(gen, { seed, level, shape, vocab: placeholderVocab(gen) });
        return `${shape} #${seed} -> ${r.solved.answer} (${r.tries} tries, ${hashSeed(JSON.stringify(gen.fields(r.params)))})`;
      });
    }
  }
  expect(out).toMatchInlineSnapshot(`
    {
      "g14/base": [
        "digit #1 -> 429636 (1 tries, 3788040537)",
        "powers #2 -> 38 (1 tries, 4106196936)",
        "digit #3 -> 47899 (1 tries, 368974349)",
      ],
      "g14/core": [
        "digit #1 -> 3798854 (4 tries, 3158468740)",
        "powers #2 -> 861 (1 tries, 3339673822)",
        "digit #3 -> 1788186825 (1 tries, 2284331720)",
      ],
      "g14/hard": [
        "digit #1 -> 271344379 (5 tries, 301638155)",
        "powers #2 -> 2198 (1 tries, 336745703)",
        "digit #3 -> 26747005558 (1 tries, 2980915794)",
      ],
    }
  `);
});
