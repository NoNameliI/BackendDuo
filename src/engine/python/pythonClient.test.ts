import { describe, expect, it } from 'vitest';
import type { PythonReply, PythonRequest } from './protocol';
import { createPythonClient, PythonTimeoutError, type PythonStatus, type PythonWorkerLike } from './pythonClient';

/**
 * A worker that loads instantly and answers runs over the port it is given; it hangs on code containing
 * "while True" and breaks fatally on "recursion".
 */
function fakeWorker(log: string[]): PythonWorkerLike {
  return {
    onerror: null,
    terminate: () => log.push('terminate'),
    postMessage(_message, [port]) {
      const p = port as MessagePort;
      p.onmessage = ({ data: msg }: MessageEvent<PythonRequest>) => {
        log.push(msg.op);
        if (msg.op === 'run' && msg.source.includes('while True')) return;
        const reply: PythonReply =
          msg.op === 'run' && msg.source.includes('recursion')
            ? { id: msg.id, ok: false, error: 'Pyodide has suffered a fatal error', fatal: true }
            : { id: msg.id, ok: true, value: msg.op === 'init' ? { loadMs: 5 } : { load: { ok: true }, responses: [], output: '' } };
        p.postMessage(reply);
      };
    },
  };
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
    const client = createPythonClient(() => fakeWorker(log), { startMs: 1000, runMs: 30, scriptMs: 30 });
    await expect(client.run('while True: pass', [])).rejects.toBeInstanceOf(PythonTimeoutError);
    await new Promise((r) => setTimeout(r, 20));
    expect(log).toEqual(['init', 'run', 'terminate', 'init']);
    expect((await client.run('app = 1', [])).load).toEqual({ ok: true });
  });

  it('replaces the worker after a fatal error', async () => {
    const log: string[] = [];
    const client = createPythonClient(() => fakeWorker(log));
    await expect(client.run('recursion', [])).rejects.toThrow(/fatal/);
    await new Promise((r) => setTimeout(r, 20));
    expect(log).toEqual(['init', 'run', 'terminate', 'init']);
    expect(client.status().state).toBe('ready');
  });
});
