import { SolutionError } from '@/checker/index';
import type { SchemaOp, SchemaOps, SchemaReply } from './schemaOps';

/** The subset of the Worker API the client relies on (lets tests substitute an in-process fake). */
export interface SchemaWorkerLike {
  postMessage(message: { id: number; op: SchemaOp; args: unknown[] }): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<SchemaReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export type SchemaClient = { [K in SchemaOp]: (...args: Parameters<SchemaOps[K]>) => Promise<ReturnType<SchemaOps[K]>> };

export const SCHEMA_TIMEOUT_MS = 5000;

/**
 * GraphQL and protobuf run in their own worker, started on first use (graphql-js and protobufjs stay out of
 * the main bundle). A call that hangs terminates the worker; the next call starts a fresh one.
 */
export function createSchemaClient(spawn: () => SchemaWorkerLike, timeoutMs = SCHEMA_TIMEOUT_MS): SchemaClient {
  let worker: SchemaWorkerLike | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  const stop = (reason: Error) => {
    worker?.terminate();
    worker = null;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(reason);
    }
    pending.clear();
  };

  const start = () => {
    const w = spawn();
    w.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      clearTimeout(p.timer);
      if (data.ok) p.resolve(data.value);
      else p.reject(data.solution ? new SolutionError(data.error) : new Error(data.error));
    };
    w.onerror = (event) => {
      event.preventDefault?.();
      stop(new Error(event.message || 'Песочница GraphQL/protobuf остановилась'));
    };
    return w;
  };

  const call = (op: SchemaOp, args: unknown[]) =>
    new Promise((resolve, reject) => {
      worker ??= start();
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        stop(new Error(`Запрос выполнялся дольше ${timeoutMs / 1000} с и был остановлен`));
        reject(new Error(`Запрос выполнялся дольше ${timeoutMs / 1000} с и был остановлен`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, op, args });
    });

  const ops: SchemaOp[] = ['graphql', 'proto', 'encode', 'rpc', 'protoExample', 'checkGraphql', 'checkProto'];
  return Object.fromEntries(ops.map((op) => [op, (...args: unknown[]) => call(op, args)])) as unknown as SchemaClient;
}

let shared: SchemaClient | null = null;

/** The app's schema worker. */
export function schemaClient(): SchemaClient {
  shared ??= createSchemaClient(() => new Worker(new URL('./schema.worker.ts', import.meta.url), { type: 'module' }) as unknown as SchemaWorkerLike);
  return shared;
}
