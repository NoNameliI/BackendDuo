import type { Generator, GeneratorId } from './types';

// Every gen/gNN.ts exports a generator named after its file; adding a file registers it.
const modules = import.meta.glob<Record<string, unknown>>('./gen/g[0-9][0-9].ts', { eager: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const registry: Record<GeneratorId, Generator<any>> = Object.fromEntries(
  Object.entries(modules).map(([path, mod]) => {
    const id = path.slice('./gen/'.length, -'.ts'.length) as GeneratorId;
    const gen = mod[id] as Generator<unknown> | undefined;
    if (!gen || gen.id !== id) throw new Error(`${path} must export a generator named ${id}`);
    return [id, gen];
  }),
);
