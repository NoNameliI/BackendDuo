import { describe, expect, it } from 'vitest';
import { freshNodePython } from '../../scripts/pyodide/node';
import { createPythonClient, type PythonWorkerLike } from '@/engine/python/pythonClient';
import type { PythonRequest } from '@/engine/python/protocol';
import { checkFastapi, type FastapiTask } from './fastapi';

const SOLUTION = 'from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get("/notes/{note_id}")\ndef get_note(note_id: int):\n    return {"id": note_id}\n';
const DO_NOTHING = 'from fastapi import FastAPI\napp = FastAPI()\n';
// Makes every app answer 200 {"hacked": true}: a reference computed after this would accept a do-nothing app.
const TAMPER = `from fastapi import FastAPI
from fastapi.responses import JSONResponse

async def call(self, scope, receive, send):
    if scope["type"] == "http":
        await JSONResponse({"hacked": True})(scope, receive, send)

FastAPI.__call__ = call
app = FastAPI()
`;

const task = () =>
  ({ id: `fa-taint-${Math.random()}`, courseId: 'api', lessonId: 'l', type: 'fastapi', title: 'T', xp: 10, hints: ['a'], prompt: '', httpStarter: 'GET /', httpSolution: 'GET /',
    pythonStarter: '', pythonSolution: SOLUTION, httpTests: 'GET /notes/1', check: { body: 'json', headers: [], code: [] } }) as unknown as FastapiTask;

function setup() {
  let spawns = 0;
  const client = createPythonClient(() => {
    spawns++;
    const runtime = freshNodePython();
    const worker: PythonWorkerLike = {
      onerror: null,
      terminate() {},
      postMessage(_m, transfer) {
        const port = transfer[0] as unknown as MessagePort;
        port.onmessage = async ({ data }: MessageEvent<PythonRequest>) => {
          const rt = await runtime;
          if (data.op === 'init') port.postMessage({ id: data.id, ok: true, value: { loadMs: 0 } });
          else if (data.op === 'run') port.postMessage({ id: data.id, ok: true, value: await rt.run(data.project, data.requests, { keep: data.keep }) });
          else port.postMessage({ id: data.id, ok: false, error: 'unsupported' });
        };
      },
    };
    return worker;
  }, { startMs: 90_000, runMs: 30_000, scriptMs: 30_000 });
  return { client, spawns: () => spawns };
}

describe('fastapi references stay out of the learner worker', () => {
  it('a patched framework does not make a do-nothing app pass', async () => {
    const { client, spawns } = setup();
    await client.run(TAMPER, [{ method: 'GET', url: '/x', headers: [], body: '' }]);
    const result = await checkFastapi(task(), DO_NOTHING, (project, requests, options) => client.run(project, requests, options));
    expect(result.passed).toBe(false);
    expect(spawns()).toBe(2);
  }, 180_000);
});
