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
        if (msg.op === 'run' && msg.project.files['main.py'].includes('while True')) return;
        const reply: PythonReply =
          msg.op === 'run' && msg.project.files['main.py'].includes('recursion')
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

/** A worker that records what it receives and takes `packageMs` to unpack a group. */
function groupWorker(log: string[], packageMs = 0): PythonWorkerLike {
  return {
    onerror: null,
    terminate: () => log.push('terminate'),
    postMessage(_message, [port]) {
      const p = port as MessagePort;
      p.onmessage = ({ data: msg }: MessageEvent<PythonRequest>) => {
        log.push(msg.op === 'packages' ? `packages:${Object.keys(msg.archives).join(',')}` : msg.op);
        const value =
          msg.op === 'init'
            ? { loadMs: 1 }
            : msg.op === 'packages'
              ? Object.keys(msg.archives)
              : msg.op === 'test'
                ? { exit: 0, counts: { passed: 0, failed: 0, error: 0, skipped: 0 }, tests: [], output: '', ms: 1 }
                : { load: { ok: true }, responses: [], output: '' };
        setTimeout(() => p.postMessage({ id: msg.id, ok: true, value } satisfies PythonReply), msg.op === 'packages' ? packageMs : 0);
      };
    },
  };
}

describe('python client groups', () => {
  const setup = (packageMs = 0, limits = { startMs: 1000, runMs: 1000, scriptMs: 1000 }) => {
    const log: string[] = [];
    const fetched: string[] = [];
    const client = createPythonClient(
      () => groupWorker(log, packageMs),
      limits,
      async (group) => {
        fetched.push(group);
        return new Uint8Array([1, 2, 3]);
      },
    );
    return { log, fetched, client };
  };
  const project = { files: { 'main.py': 'app = 1' } };

  it('loads each group once per worker and fetches the bytes once', async () => {
    const { log, fetched, client } = setup();
    await client.run(project, [], { groups: ['client'] });
    await client.run(project, [], { groups: ['client'] });
    await client.run(project, [], { groups: ['client', 'pytest'] });
    await client.test(project, { groups: ['client', 'pytest'] });
    expect(log).toEqual(['init', 'packages:client', 'run', 'run', 'packages:pytest', 'run', 'test']);
    expect(fetched).toEqual(['client', 'pytest']);
    await client.run(project, []); // no groups: nothing to load
    expect(log.at(-1)).toBe('run');
  });

  it('sends the groups again after a respawn without fetching again', async () => {
    const { log, fetched, client } = setup();
    await client.run(project, [], { groups: ['client'] });
    await client.run(project, [], { groups: ['client'], reference: true }); // the worker is tainted: respawn
    expect(log).toEqual(['init', 'packages:client', 'run', 'terminate', 'init', 'packages:client', 'run']);
    expect(fetched).toEqual(['client']);
  });

  it('respawns before a reference only when learner code ran, for run and for test', async () => {
    const { log, client } = setup();
    await client.run(project, [], { reference: true });
    await client.test(project, { reference: true });
    expect(log).toEqual(['init', 'run', 'test']);
    await client.test(project); // learner tests taint the worker
    await client.test(project, { reference: true });
    expect(log).toEqual(['init', 'run', 'test', 'test', 'terminate', 'init', 'test']);
    await client.run(project, []);
    await client.run(project, [], { reference: true });
    expect(log.slice(-4)).toEqual(['run', 'terminate', 'init', 'run']);
  });

  it('does not count the group load against the run limit', async () => {
    const { client } = setup(300, { startMs: 2000, runMs: 150, scriptMs: 150 });
    expect((await client.run(project, [], { groups: ['client'] })).load).toEqual({ ok: true });
    expect((await client.test(project, { groups: ['pytest'] })).exit).toBe(0);
  });

  it('fails the run when a group cannot be fetched, and tries again next time', async () => {
    const log: string[] = [];
    let attempts = 0;
    const client = createPythonClient(
      () => groupWorker(log),
      undefined,
      async () => {
        if (++attempts === 1) throw new Error('offline');
        return new Uint8Array([1]);
      },
    );
    await expect(client.run(project, [], { groups: ['client'] })).rejects.toThrow('offline');
    await client.run(project, [], { groups: ['client'] });
    expect(log).toEqual(['init', 'packages:client', 'run']);
  });

  it('wraps a plain source string as main.py', async () => {
    const seen: unknown[] = [];
    const client = createPythonClient(() => ({
      onerror: null,
      terminate() {},
      postMessage(_m, [port]) {
        const p = port as MessagePort;
        p.onmessage = ({ data: msg }: MessageEvent<PythonRequest>) => {
          if (msg.op === 'run') seen.push(msg.project);
          p.postMessage({ id: msg.id, ok: true, value: msg.op === 'init' ? { loadMs: 1 } : { load: { ok: true }, responses: [], output: '' } });
        };
      },
    }));
    await client.run('app = 3', []);
    expect(seen).toEqual([{ files: { 'main.py': 'app = 3' } }]);
  });
});

describe('python client races', () => {
  it('respawns a reference whose worker received learner code while its groups were loading', async () => {
    const log: string[] = [];
    const client = createPythonClient(() => groupWorker(log, 50), { startMs: 1000, runMs: 1000, scriptMs: 1000 }, async () => new Uint8Array([1]));
    const project = { files: { 'main.py': 'app = 1' } };
    const reference = client.run(project, [], { reference: true, groups: ['client'] });
    const learner = client.run(project, []);
    expect((await reference).load).toEqual({ ok: true });
    await learner;
    expect(log.slice(log.indexOf('terminate'))).toEqual(['terminate', 'init', 'packages:client', 'run']);
    expect(log).toContain('terminate');
  });
});
