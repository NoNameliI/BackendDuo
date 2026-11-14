import type { ApiRequest } from '@/engine/api/http';
import { CONNECT, type PythonReply, type PythonRequest } from './protocol';
import type { ClientSetup } from './brokerBridge';
import { asProject, type AnalyzeResult, type AppRun, type ClientRun, type Project, type PytestRun, type ScriptRun, type StaticRule } from './runtime';

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
  /** One run of a standalone script. */
  scriptMs: number;
}

export class PythonTimeoutError extends Error {}

export interface PythonClient {
  status(): PythonStatus;
  subscribe(listener: (status: PythonStatus) => void): () => void;
  /** Starts loading Python in the background, if it is not loaded yet. */
  prewarm(): void;
  /**
   * Runs a project (a plain string is main.py) and answers the requests. `groups`: lazy package groups it needs,
   * loaded first without counting against the run limit. `reference` (the course's own solution): runs in a worker
   * that has not run learner code, respawning it if needed.
   */
  run(project: Project | string, requests: ApiRequest[], options?: { keep?: boolean; reference?: boolean; groups?: string[] }): Promise<AppRun>;
  /** Runs pytest over the project (limited like a script). `test` taints the worker unless it is a `reference`. */
  test(project: Project, options?: { reference?: boolean; groups?: string[]; args?: string[] }): Promise<PytestRun>;
  /**
   * Static rules over the project (ast only, nothing of it runs, so the worker is not marked used). `reference`:
   * runs in a worker that has not run learner code, respawning it if needed.
   */
  analyze(project: Project, rules: StaticRule[], options?: { reference?: boolean }): Promise<AnalyzeResult>;
  /** Loads lazy package groups into the current worker (each once per worker; resent after a respawn). */
  ensure(groups: string[]): Promise<void>;
  /** Runs a standalone script with the given text files in a scratch directory; a stuck script is terminated. */
  script(source: string, files: Record<string, string>): Promise<ScriptRun>;
  /**
   * Runs a broker client program (pika, confluent_kafka) against a fresh simulator; a stuck program is terminated.
   * `reference` (the course's own solution): runs in a worker that has not run learner code, respawning it if needed.
   */
  client(source: string, setup: ClientSetup, options?: { reference?: boolean; groups?: string[] }): Promise<ClientRun>;
  /** Drops the app kept between sends (the next send loads main.py afresh). */
  forget(): Promise<void>;
}

/**
 * Python runs in its own worker, loaded on first need (a lesson with FastAPI opens) and kept afterwards.
 * Code that runs too long (an endless loop) cannot be interrupted inside WebAssembly: the worker is terminated
 * and a fresh one starts loading at once.
 */
export type GroupFetcher = (group: string) => Promise<Uint8Array>;

/** Package groups are files of the app; the main thread fetches them because the worker has no network after start. */
const fetchGroupFile: GroupFetcher = async (group) => {
  const res = await fetch(`/pyodide/groups/${group}.tar.gz`);
  if (!res.ok) throw new Error(`${group}.tar.gz: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

export function createPythonClient(
  spawn: () => PythonWorkerLike,
  limits: PythonLimits = { startMs: 90_000, runMs: 8_000, scriptMs: 20_000 },
  fetchGroup: GroupFetcher = fetchGroupFile,
): PythonClient {
  let worker: PythonWorkerLike | null = null;
  let port: MessagePort | null = null;
  let ready: Promise<void> | null = null;
  // Learner code ran in the current worker: it may have patched what survives between runs.
  let tainted = false;
  // Groups unpacked in the current worker, and the bytes fetched so far (kept across respawns).
  let loaded = new Set<string>();
  const bytes = new Map<string, Promise<Uint8Array>>();
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
    tainted = false;
    loaded = new Set();
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

  const replace = () =>
    queueMicrotask(() => {
      setStatus({ state: 'idle' });
      start().catch(() => {});
    });

  const ensure = async (groups: string[]) => {
    await start();
    const w = worker;
    const missing = groups.filter((g) => !loaded.has(g));
    if (!missing.length) return;
    const archives: Record<string, Uint8Array> = {};
    for (const g of missing) {
      let file = bytes.get(g);
      if (!file) {
        file = fetchGroup(g);
        bytes.set(g, file);
        file.catch(() => bytes.delete(g));
      }
      archives[g] = await file;
    }
    // Unpacking is not the learner's code: it has its own limit and never counts against the run limit.
    await call({ op: 'packages', archives }, limits.startMs, () => {
      replace();
      return new PythonTimeoutError('Пакеты урока не загрузились вовремя');
    });
    if (worker === w) missing.forEach((g) => loaded.add(g));
  };

  /** Before a run: a clean worker for references, the worker started, the groups loaded, then the worker is marked used. */
  const prepare = async (options: { reference?: boolean; groups?: string[] }) => {
    for (;;) {
      if (options.reference && tainted) {
        stop(new Error('Python перезапущен'));
        setStatus({ state: 'idle' });
      }
      await start();
      if (options.groups?.length) await ensure(options.groups);
      // Learner code may have been sent to this worker while the awaits above were pending.
      if (options.reference && tainted) continue;
      if (!options.reference) tainted = true;
      return;
    }
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
    async run(project, requests, options = {}) {
      await prepare(options);
      const seconds = limits.runMs / 1000;
      return (await call({ op: 'run', project: asProject(project), requests, keep: Boolean(options.keep) }, limits.runMs, () => {
        // The stuck worker is gone; a fresh one starts loading right away so the next run waits less.
        replace();
        return new PythonTimeoutError(`Код выполнялся дольше ${seconds} с и был остановлен. Проверьте, нет ли бесконечного цикла.`);
      })) as AppRun;
    },
    async test(project, options = {}) {
      await prepare(options);
      const seconds = limits.scriptMs / 1000;
      return (await call({ op: 'test', project, args: options.args ?? [] }, limits.scriptMs, () => {
        replace();
        return new PythonTimeoutError(`Тесты выполнялись дольше ${seconds} с и были остановлены. Проверьте, нет ли бесконечного цикла.`);
      })) as PytestRun;
    },
    async analyze(project, rules, options = {}) {
      for (;;) {
        if (options.reference && tainted) {
          stop(new Error('Python перезапущен'));
          setStatus({ state: 'idle' });
        }
        await start();
        // Learner code may have reached this worker while it was starting.
        if (!options.reference || !tainted) break;
      }
      return (await call({ op: 'analyze', project, rules }, limits.runMs, () => {
        replace();
        return new PythonTimeoutError('Разбор кода занял слишком много времени и был остановлен.');
      })) as AnalyzeResult;
    },
    ensure,
    async script(source, files) {
      await start();
      tainted = true;
      const seconds = limits.scriptMs / 1000;
      return (await call({ op: 'script', source, files }, limits.scriptMs, () => {
        replace();
        return new PythonTimeoutError(`Скрипт выполнялся дольше ${seconds} с и был остановлен. Проверьте, нет ли бесконечного цикла.`);
      })) as ScriptRun;
    },
    async client(source, setup, options = {}) {
      await prepare(options);
      const seconds = limits.runMs / 1000;
      return (await call({ op: 'client', source, setup }, limits.runMs, () => {
        replace();
        return new PythonTimeoutError(`Программа работала дольше ${seconds} с и была остановлена. Проверьте, нет ли бесконечного цикла.`);
      })) as ClientRun;
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
