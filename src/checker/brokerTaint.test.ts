import { describe, expect, it } from 'vitest';
import { freshNodePython } from '../../scripts/pyodide/node';
import { createPythonClient, type PythonWorkerLike } from '@/engine/python/pythonClient';
import type { PythonRequest } from '@/engine/python/protocol';
import { checkClientTask, type ClientRunner } from './broker';
import { fixtureCourse, fixtureTask } from './brokerFixture';
import type { BrokerTask } from '@/content/loadCourse';

const rabbit = fixtureCourse();
const task = fixtureTask(rabbit, 'fx-client') as BrokerTask & { pythonSolution: string };
const lazy = 'import pika  # basic_publish\n';

// A worker double: every spawn is a new interpreter with its own runtime, like a real respawn.
function setup() {
  let spawns = 0;
  const client = createPythonClient(() => {
    spawns++;
    const runtime = freshNodePython();
    const worker: PythonWorkerLike = {
      onerror: null,
      terminate() {},
      postMessage(_message, transfer) {
        const port = transfer[0] as unknown as MessagePort;
        port.onmessage = async ({ data }: MessageEvent<PythonRequest>) => {
          const rt = await runtime;
          if (data.op === 'init') port.postMessage({ id: data.id, ok: true, value: { loadMs: 0 } });
          else if (data.op === 'client') port.postMessage({ id: data.id, ok: true, value: rt.client(data.source, data.setup) });
          else if (data.op === 'script') port.postMessage({ id: data.id, ok: true, value: rt.script(data.source, data.files) });
          else port.postMessage({ id: data.id, ok: false, error: 'unsupported' });
        };
      },
    };
    return worker;
  });
  const run: ClientRunner = (source, setup, options) => client.client(source, setup, options);
  return { run, script: (source: string) => client.script(source, {}), spawns: () => spawns };
}

const tamperRuntime = `
import studio_runtime
class D(dict):
    def __missing__(self, k):
        return 1 if k in ('conn', 'ch', 'seq') else ([] if k in ('deliveries', 'returned', 'returns') else None)
    def get(self, k, d=None):
        return self[k]
studio_runtime.broker_call = lambda op, **a: {'ok': True, 'value': D()}
`;

const tamperImport = `
import studio_runtime, types
real = studio_runtime._real_import
ch = types.SimpleNamespace(basic_publish=lambda *a, **k: None, queue_declare=lambda *a, **k: None)
fake = types.SimpleNamespace(BlockingConnection=lambda *a, **k: types.SimpleNamespace(channel=lambda: ch, close=lambda: None), ConnectionParameters=lambda *a, **k: None, URLParameters=lambda *a, **k: None, BasicProperties=lambda *a, **k: None)
studio_runtime._BUILTINS['__import__'] = lambda n, *a, **k: fake if n == 'pika' else real(n, *a, **k)
`;

describe('client references stay out of the learner worker', () => {
  it('a check without earlier learner runs does not respawn', async () => {
    const { run, spawns } = setup();
    const t = { ...task } as typeof task;
    expect(await checkClientTask(t, rabbit.scenarios, task.pythonSolution, run)).toEqual({ passed: true, problems: [] });
    expect(spawns()).toBe(1);
  }, 120_000);

  for (const [name, tamper] of [['broker_call', tamperRuntime], ['_BUILTINS["__import__"]', tamperImport]] as const) {
    it(`patching ${name} does not make a do-nothing program pass`, async () => {
      const { run, spawns } = setup();
      const other = { ...task } as typeof task; // a fresh task: no cached reference yet
      await run(tamper, { flavor: 'rabbit', scripts: [] });
      const t0 = Date.now();
      const r = await checkClientTask(other, rabbit.scenarios, lazy, run);
      const extra = Date.now() - t0;
      expect(r.passed).toBe(false);
      expect(spawns()).toBe(2);
      // the program of a normal solution still passes afterwards
      expect(await checkClientTask(other, rabbit.scenarios, task.pythonSolution, run)).toEqual({ passed: true, problems: [] });
      console.log(`check after respawn (${name}): ${extra} ms`);
    }, 180_000);
  }

  it('a standalone script taints the worker as well', async () => {
    const { run, script, spawns } = setup();
    const other = { ...task } as typeof task;
    await script(tamperRuntime);
    expect((await checkClientTask(other, rabbit.scenarios, lazy, run)).passed).toBe(false);
    expect(spawns()).toBe(2);
  }, 180_000);
});
