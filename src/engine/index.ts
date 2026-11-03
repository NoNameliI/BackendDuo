import type { SandboxEngine } from './types';
import { WorkerEngine, type WorkerLike } from './WorkerEngine';

export type EngineKind = 'postgres';

const workers: Record<EngineKind, () => WorkerLike> = {
  postgres: () =>
    new Worker(new URL('./postgres/engine.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
};

/** Browser-side engine for a course; the engine itself runs in a Web Worker. */
export function createEngine(kind: EngineKind): SandboxEngine {
  return new WorkerEngine(workers[kind]);
}

export type * from './types';
