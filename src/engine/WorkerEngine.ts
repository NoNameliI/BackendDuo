import type { EngineMethod, ExecOutcome, ExplainOutcome, SandboxEngine, SchemaInfo, SqlError } from './types';

export interface WorkerRequest {
  id: number;
  method: EngineMethod;
  args: unknown[];
}

export type WorkerResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

/** The subset of the Worker API the proxy relies on (lets tests substitute a fake). */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface WorkerEngineLimits {
  queryMs: number;
  setupMs: number;
}

class TimeoutError extends Error {}

/** Mirrors PostgreSQL's own statement_timeout error so the UI treats it like any other SQL error. */
export const TIMEOUT_ERROR: SqlError = { code: '57014', message: 'canceling statement due to statement timeout' };

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Runs a sandbox engine in a Web Worker so a runaway query never freezes the UI.
 * A call that exceeds its time limit terminates the worker; a fresh one is started and the
 * last setup script is re-applied.
 */
export class WorkerEngine implements SandboxEngine {
  private worker: WorkerLike | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private setupSql = '';
  private ready: Promise<void> | null = null;

  constructor(
    private readonly spawn: () => WorkerLike,
    private readonly limits: WorkerEngineLimits = { queryMs: 10_000, setupMs: 60_000 },
  ) {}

  init(): Promise<void> {
    this.ready ??= this.start();
    return this.ready;
  }

  async reset(setupSql: string): Promise<void> {
    await this.init();
    this.setupSql = setupSql;
    await this.call('reset', [setupSql], this.limits.setupMs);
  }

  async execute(sql: string): Promise<ExecOutcome> {
    await this.init();
    try {
      return (await this.call('execute', [sql], this.limits.queryMs)) as ExecOutcome;
    } catch (e) {
      if (!(e instanceof TimeoutError)) throw e;
      await this.restart();
      return { results: [], notices: [], error: TIMEOUT_ERROR, durationMs: this.limits.queryMs };
    }
  }

  async explain(sql: string, options?: { analyze?: boolean }): Promise<ExplainOutcome> {
    await this.init();
    try {
      return (await this.call('explain', [sql, options], this.limits.queryMs)) as ExplainOutcome;
    } catch (e) {
      if (!(e instanceof TimeoutError)) throw e;
      await this.restart();
      return { error: TIMEOUT_ERROR };
    }
  }

  async introspect(): Promise<SchemaInfo> {
    await this.init();
    return (await this.call('introspect', [], this.limits.queryMs)) as SchemaInfo;
  }

  async dispose(): Promise<void> {
    this.stop(new Error('engine disposed'));
    this.ready = null;
  }

  private async start(): Promise<void> {
    const worker = this.spawn();
    worker.onmessage = (event) => this.settle(event.data);
    worker.onerror = (event) => {
      event.preventDefault?.();
      this.stop(new Error(event.message || 'sandbox worker crashed'));
      this.ready = null;
    };
    this.worker = worker;
    await this.call('init', [], this.limits.setupMs);
  }

  private async restart(): Promise<void> {
    this.stop(new Error('sandbox restarted'));
    this.ready = this.start();
    await this.ready;
    await this.call('reset', [this.setupSql], this.limits.setupMs);
  }

  private stop(reason: Error): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(reason);
    }
    this.pending.clear();
  }

  private call(method: EngineMethod, args: unknown[], timeoutMs: number): Promise<unknown> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('sandbox worker is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TimeoutError(`${method} exceeded ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, method, args });
    });
  }

  private settle(response: WorkerResponse): void {
    const p = this.pending.get(response.id);
    if (!p) return;
    this.pending.delete(response.id);
    clearTimeout(p.timer);
    if (response.ok) p.resolve(response.value);
    else p.reject(new Error(response.error));
  }
}
