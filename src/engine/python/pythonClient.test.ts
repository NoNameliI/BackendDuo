import { describe, expect, it } from 'vitest';
import type { PythonReply, PythonRequest } from './python.worker';
import { createPythonClient, PythonTimeoutError, type PythonStatus, type PythonWorkerLike } from './pythonClient';

/** A worker that loads instantly and answers runs, or hangs on code containing "while True". */
function fakeWorker(log: string[]): PythonWorkerLike {
  const w: PythonWorkerLike = {
    onmessage: null,
    onerror: null,
    terminate: () => log.push('terminate'),
    postMessage(msg: PythonRequest) {
      log.push(msg.op);
      if (msg.op === 'run' && msg.source.includes('while True')) return;
      const value = msg.op === 'init' ? { loadMs: 5 } : { load: { ok: true }, responses: [], output: '' };
      const reply: PythonReply = { id: msg.id, ok: true, value };
      queueMicrotask(() => w.onmessage?.({ data: reply } as MessageEvent<PythonReply>));
    },
  };
  return w;
}

describe('python client', () => {
  it('loads once, reports status and runs', async () => {
    const log: string[] = [];
    const client = createPythonClient(() => fakeWorker(log));
    const states: PythonStatus['state'][] = [];
    client.subscribe((s) => states.push(s.state));
    client.prewarm();
    await client.run('app = 1', []);
    await client.run('app = 2', []);
    expect(log).toEqual(['init', 'run', 'run']);
    expect(states).toEqual(['loading', 'ready']);
  });

  it('terminates a run that hangs and starts a fresh worker', async () => {
    const log: string[] = [];
    const client = createPythonClient(() => fakeWorker(log), { startMs: 1000, runMs: 30 });
    await expect(client.run('while True: pass', [])).rejects.toBeInstanceOf(PythonTimeoutError);
    await new Promise((r) => setTimeout(r, 10));
    expect(log).toEqual(['init', 'run', 'terminate', 'init']);
    expect((await client.run('app = 1', [])).load).toEqual({ ok: true });
  });
});
