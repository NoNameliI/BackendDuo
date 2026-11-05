import type { ApiRequest } from '@/engine/api/http';
import { CONNECT, type PythonReply, type PythonRequest } from './protocol';
import type { AppRun } from './runtime';

/** The subset of the Worker API the client relies on (lets tests substitute a fake). */
export interface PythonWorkerLike {
  postMessage(message: typeof CONNECT, transfer: Transferable[]): void;
  terminate(): void;
  onerror: ((event: ErrorEvent) => void) | null;
}

/** Where the course's FastAPI app listens, like `uvicorn main:app` would. */
export const PYTHON_BASE_URL = 'http://127.0.0.1:8000';

export type PythonStatus =
  | { state: 'idle' }
  | { state: 'loading'; since: number }
  | { state: 'ready'; loadMs: number }
  | { state: 'failed'; error: string };

export interface PythonLimits {
  /** Loading Python and FastAPI. */
  startMs: number;
  /** One run of the learner's app (all its requests). */
  runMs: number;
}

export class PythonTimeoutError extends Error {}

export interface PythonClient {
  status(): PythonStatus;
  subscribe(listener: (status: PythonStatus) => void): () => void;
  /** Starts loading Python in the background, if it is not loaded yet. */
  prewarm(): void;
  run(source: string, requests: ApiRequest[], options?: { keep?: boolean }): Promise<AppRun>;
  /** Drops the app kept between sends (the next send loads main.py afresh). */
  forget(): Promise<void>;
}

/**
 * Python runs in its own worker, loaded on first need (a lesson with FastAPI opens) and kept afterwards.
 * Code that runs too long (an endless loop) cannot be interrupted inside WebAssembly: the worker is terminated
 * and a fresh one starts loading at once.
 */
export function createPythonClient(spawn: () => PythonWorkerLike, limits: PythonLimits = { startMs: 90_000, runMs: 8_000 }): PythonClient {
  let worker: PythonWorkerLike | null = null;
  let port: MessagePort | null = null;
  let ready: Promise<void> | null = null;
  let status: PythonStatus = { state: 'idle' };
  let nextId = 1;
  const listeners = new Set<(s: PythonStatus) => void>();
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  const setStatus = (next: PythonStatus) => {
    status = next;
    listeners.forEach((l) => l(next));
  };

  const stop = (reason: Error) => {
    port?.close();
    port = null;
    worker?.terminate();
    worker = null;
    ready = null;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(reason);
    }
    pending.clear();
  };

  type Message = PythonRequest extends infer R ? (R extends PythonRequest ? Omit<R, 'id'> : never) : never;
  const call = (message: Message, timeoutMs: number, onTimeout: () => Error) =>
    new Promise<unknown>((resolve, reject) => {
      const p = port;
      if (!p) return reject(new Error('Python не запущен'));
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        const error = onTimeout();
        stop(error);
        reject(error);
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      p.postMessage({ ...message, id } as PythonRequest);
    });

  const start = (): Promise<void> => {
    ready ??= (() => {
      const w = spawn();
      const channel = new MessageChannel();
      worker = w;
      port = channel.port1;
      port.onmessage = ({ data }: MessageEvent<PythonReply>) => {
        if (typeof data?.id !== 'number' || typeof data.ok !== 'boolean') return;
        const p = pending.get(data.id);
        if (!p) return;
        pending.delete(data.id);
        clearTimeout(p.timer);
        if (data.ok) p.resolve(data.value);
        else p.reject(new Error(data.error));
        if (!data.ok && data.fatal) {
          // Pyodide cannot recover from such an error: replace the worker, as after a timeout.
          stop(new Error(data.error));
          setStatus({ state: 'idle' });
          start().catch(() => {});
        }
      };
      w.postMessage(CONNECT, [channel.port2]);
      w.onerror = (event) => {
        event.preventDefault?.();
        const error = new Error(event.message || 'Python остановился с ошибкой');
        stop(error);
        setStatus({ state: 'failed', error: error.message });
      };
      setStatus({ state: 'loading', since: Date.now() });
      return call({ op: 'init' }, limits.startMs, () => new PythonTimeoutError('Python не загрузился вовремя')).then(
        (value) => setStatus({ state: 'ready', loadMs: (value as { loadMs: number }).loadMs }),
        (e: Error) => {
          stop(e);
          setStatus({ state: 'failed', error: e.message });
          throw e;
        },
      );
    })();
    return ready;
  };

  return {
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prewarm() {
      if (!ready) start().catch(() => {});
    },
    async run(source, requests, options = {}) {
      await start();
      const seconds = limits.runMs / 1000;
      return (await call({ op: 'run', source, requests, keep: Boolean(options.keep) }, limits.runMs, () => {
        // The stuck worker is gone; a fresh one starts loading right away so the next run waits less.
        queueMicrotask(() => {
          setStatus({ state: 'idle' });
          start().catch(() => {});
        });
        return new PythonTimeoutError(`Код выполнялся дольше ${seconds} с и был остановлен. Проверьте, нет ли бесконечного цикла.`);
      })) as AppRun;
    },
    async forget() {
      if (worker && status.state === 'ready') await call({ op: 'forget' }, limits.runMs, () => new PythonTimeoutError('forget'));
    },
  };
}

let shared: PythonClient | null = null;

/** The app's Python worker. */
export function pythonClient(): PythonClient {
  shared ??= createPythonClient(() => new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' }) as unknown as PythonWorkerLike);
  return shared;
}
