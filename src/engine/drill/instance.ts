import type { DrillTask } from '@/content/schema';
import { hashSeed, createRng, seedHex } from './rng';
import { registry } from './registry';
import { Reject, type Generator, type Instance, type Level, type Solved, type Vocab } from './types';

export const MAX_TRIES = 500;

/** Try i draws from createRng(seed).fork(`t${i}`); a Reject moves to the next try. */
export function draw<P>(
  gen: Generator<P>,
  o: { seed: number; level: Level; shape: string; vocab: Vocab },
): { params: P; solved: Solved; tries: number } {
  if (!gen.shapes.includes(o.shape)) throw new Error(`${gen.id}: unknown shape "${o.shape}"`);
  for (const [key, min] of Object.entries(gen.vocab ?? {})) {
    const size = o.vocab[key]?.length ?? 0;
    if (size < min) throw new Error(`${gen.id}: vocab "${key}" needs at least ${min} entries, got ${size}`);
  }
  const root = createRng(o.seed);
  for (let i = 0; i < MAX_TRIES; i++) {
    try {
      const params = gen.generate(root.fork(`t${i}`), o.level, o.shape, o.vocab);
      return { params, solved: gen.solve(params), tries: i + 1 };
    } catch (e) {
      if (!(e instanceof Reject)) throw e;
    }
  }
  throw new Error(`${gen.id}/${o.shape}/${o.level}: no valid draw in ${MAX_TRIES} tries (seed ${seedHex(o.seed)})`);
}

export function makeInstance(task: DrillTask, n: number, level: Level, seed: number): Instance {
  const gen = registry[task.generator as keyof typeof registry] as Generator<unknown> | undefined;
  if (!gen) throw new Error(`unknown generator ${task.generator}`);
  const { params, solved, tries } = draw(gen, { seed, level, shape: task.shape, vocab: task.vocab });
  return {
    key: `${n}:${task.id}:${level}:${seedHex(seed)}`,
    n,
    taskId: task.id,
    generator: gen.id,
    shape: task.shape,
    level,
    seed,
    fields: gen.fields(params),
    steps: solved.steps,
    answer: solved.answer,
    spec: gen.answer,
    files: gen.files?.(params) ?? [],
    tries,
  };
}

/** One seed per number for a set, derived from the master seed. */
export function setSeeds(master: number, numbers: number[]): Record<number, number> {
  return Object.fromEntries(numbers.map((n) => [n, hashSeed(master, n)]));
}
