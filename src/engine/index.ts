import type { SandboxEngine } from './types';
import { WorkerEngine, type WorkerLike } from './WorkerEngine';

/** Course technologies. SQL courses run in a worker engine; the Git sandbox runs in the page (src/engine/git). */
export type EngineKind = 'postgres' | 'git';

const workers: Record<'postgres', () => WorkerLike> = {
  postgres: () =>
    new Worker(new URL('./postgres/engine.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
};

/** Browser-side engine for a course; the engine itself runs in a Web Worker. */
export function createEngine(kind: 'postgres'): SandboxEngine {
  return new WorkerEngine(workers[kind]);
}

export type * from './types';
