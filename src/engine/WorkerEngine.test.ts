import { describe, expect, it, vi } from 'vitest';
import { TIMEOUT_ERROR, WorkerEngine, type WorkerLike, type WorkerRequest, type WorkerResponse } from './WorkerEngine';

/** In-process stand-in for the sandbox worker: echoes calls, never answers "HANG" or introspect. */
class FakeWorker implements WorkerLike {
  static spawned: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  calls: WorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.spawned.push(this);
  }

  postMessage(request: WorkerRequest): void {
    this.calls.push(request);
    if (request.args[0] === 'HANG' || request.method === 'introspect') return;
    const value =
      request.method === 'execute' ? { results: [], notices: [], durationMs: 1, sql: request.args[0] } : undefined;
    queueMicrotask(() => this.onmessage?.({ data: { id: request.id, ok: true, value } } as MessageEvent<WorkerResponse>));
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('WorkerEngine', () => {
  it('restarts the worker on timeout and re-applies the setup', async () => {
    FakeWorker.spawned = [];
    const engine = new WorkerEngine(() => new FakeWorker(), { queryMs: 30, setupMs: 1000 });
    await engine.reset('CREATE TABLE t (id int)');

    const outcome = await engine.execute('HANG');
    expect(outcome.error).toEqual(TIMEOUT_ERROR);
    expect(FakeWorker.spawned).toHaveLength(2);
    expect(FakeWorker.spawned[0].terminated).toBe(true);

    const fresh = FakeWorker.spawned[1];
    expect(fresh.calls.map((c) => c.method)).toEqual(['init', 'reset']);
    expect(fresh.calls[1].args).toEqual(['CREATE TABLE t (id int)']);

    const next = await engine.execute('SELECT 1');
    expect(next.error).toBeUndefined();
  });

  it('rejects pending calls when the worker crashes and starts a new one on next use', async () => {
    FakeWorker.spawned = [];
    const engine = new WorkerEngine(() => new FakeWorker(), { queryMs: 1000, setupMs: 1000 });
    await engine.reset('CREATE TABLE t (id int)');
    const pending = engine.introspect();
    await vi.waitFor(() => expect(FakeWorker.spawned[0].calls.at(-1)?.method).toBe('introspect'));
    FakeWorker.spawned[0].onerror?.({ message: 'out of memory', preventDefault() {} } as ErrorEvent);
    await expect(pending).rejects.toThrow('out of memory');

    await engine.execute('SELECT 1');
    expect(FakeWorker.spawned).toHaveLength(2);
    expect(FakeWorker.spawned[1].calls.map((c) => [c.method, c.args[0]])).toEqual([
      ['init', undefined],
      ['reset', 'CREATE TABLE t (id int)'],
      ['execute', 'SELECT 1'],
    ]);
  });

  it('recovers when starting a worker fails', async () => {
    let attempt = 0;
    const engine = new WorkerEngine(() => {
      const worker = new FakeWorker();
      if (attempt++ === 0) worker.postMessage = () => {};
      return worker;
    }, { queryMs: 1000, setupMs: 30 });
    await expect(engine.init()).rejects.toThrow('exceeded');
    expect(FakeWorker.spawned.at(-1)?.terminated).toBe(true);
    await expect(engine.init()).resolves.toBeUndefined();
  });
});
