import { beforeAll, describe, expect, it } from 'vitest';
import { parseRequest } from '@/engine/api/http';
import { freshNodePythonWith } from '../../../scripts/pyodide/node';
import type { PythonRuntime } from './runtime';

let py: PythonRuntime;
beforeAll(async () => {
  py = await freshNodePythonWith(['pytest']);
}, 120_000);

const get = (path: string) => parseRequest(`GET ${path}`);
const OK = 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/ok")\ndef ok():\n    return {"ok": 1}\n';

describe('runtime hardening', () => {
  it('caps the recursion limit: endless recursion is a RecursionError and the next run works', async () => {
    const main = `import sys
from fastapi import FastAPI
app = FastAPI()
sys.setrecursionlimit(10**8)

def deep(n):
    return deep(n + 1)

@app.get("/deep")
def endpoint():
    return {"x": deep(0)}
`;
    const out = await py.run({ files: { 'main.py': main } }, [get('/deep')]);
    expect(out.load).toEqual({ ok: true });
    expect(out.responses[0].status).toBe(500);
    expect(out.responses[0].error?.type).toBe('RecursionError');
    const next = await py.run({ files: { 'main.py': OK } }, [get('/ok')]);
    expect(next.responses[0].status).toBe(200);
  }, 60_000);

  it('rewrites /project on every run: a database file does not survive', async () => {
    const main = `import os
from fastapi import FastAPI
app = FastAPI()
@app.get("/seen")
def seen():
    return {"seen": os.path.exists("stray.db")}
@app.get("/make")
def make():
    open("stray.db", "w").write("x")
    return {"made": True}
`;
    const project = { files: { 'main.py': main } };
    const first = await py.run(project, [get('/make'), get('/seen')]);
    expect(JSON.parse(first.responses[1].body)).toEqual({ seen: true });
    const second = await py.run(project, [get('/seen')]);
    expect(JSON.parse(second.responses[0].body)).toEqual({ seen: false });
  });

  it('restores the environment before every load', async () => {
    const main = `import os
from fastapi import FastAPI
app = FastAPI()
@app.get("/env")
def env():
    first = os.environ.get("STRAY_VAR")
    os.environ["STRAY_VAR"] = "left"
    return {"before": first}
`;
    const project = { files: { 'main.py': main } };
    const a = await py.run(project, [get('/env')]);
    expect(JSON.parse(a.responses[0].body)).toEqual({ before: null });
    const b = await py.run(project, [get('/env')]);
    expect(JSON.parse(b.responses[0].body)).toEqual({ before: null });
    const s = await py.script('import os\nprint(os.environ.get("STRAY_VAR"))\nos.environ["STRAY_VAR"] = "x"', {});
    expect(s.output.trim()).toBe('None');
    const s2 = await py.script('import os\nprint(os.environ.get("STRAY_VAR"))', {});
    expect(s2.output.trim()).toBe('None');
  });

  it('cuts a response body kept in the result at 1 MB with a note', async () => {
    const main = `from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
app = FastAPI()
@app.get("/big", response_class=PlainTextResponse)
def big():
    return "a" * (3 * 1024 * 1024)
`;
    const out = await py.run({ files: { 'main.py': main } }, [get('/big')]);
    expect(out.responses[0].body.length).toBe(1024 * 1024);
    expect(out.responses[0].output).toContain('обрезано');
  }, 60_000);
});
