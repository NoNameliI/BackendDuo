import { beforeAll, describe, expect, it } from 'vitest';
import { parseRequest } from '@/engine/api/http';
import { nodePython } from '../../../scripts/pyodide/node';
import type { AppRun, PythonRuntime } from './runtime';

const get = (path: string) => parseRequest(`GET ${path}`);
const json = (run: AppRun, i = 0) => JSON.parse(run.responses[i].body);

let py: PythonRuntime;
beforeAll(async () => {
  py = await nodePython();
}, 60_000);

const loadError = (run: AppRun) => (run.load.ok ? null : run.load.error);

describe('multi-file projects', () => {
  const files = (price: string) => ({
    'app/__init__.py': '',
    'app/main.py': 'from fastapi import FastAPI\nfrom .routers import items\n\napp = FastAPI()\napp.include_router(items.router)\n',
    'app/routers/__init__.py': '',
    'app/routers/items.py': 'from fastapi import APIRouter\nfrom ..schemas import Item\n\nrouter = APIRouter(prefix="/items")\n\n@router.get("/{item_id}", response_model=Item)\ndef read(item_id: int):\n    return {"id": item_id, "name": "tea", "price": 2.5}\n',
    'app/schemas.py': `from pydantic import BaseModel\n\nclass Item(BaseModel):\n    id: int\n    name: str\n    price: ${price}\n`,
  });

  it('imports routers with relative imports from an entry inside a package', async () => {
    const run = await py.run({ files: files('float'), entry: 'app/main.py' }, [get('/items/3')]);
    expect(run.load).toEqual({ ok: true });
    expect(json(run)).toEqual({ id: 3, name: 'tea', price: 2.5 });
  });

  it('sees an edit of an imported file on the next run', async () => {
    const entry = 'app/main.py';
    expect(json(await py.run({ files: files('float'), entry }, [get('/items/1')])).price).toBe(2.5);
    const edited = await py.run({ files: files('int'), entry }, [get('/items/1')]);
    expect(edited.responses[0].status).toBe(500);
    expect(edited.responses[0].error).toMatchObject({ type: 'ResponseValidationError' });
    expect(json(await py.run({ files: files('float'), entry }, [get('/items/1')])).price).toBe(2.5);
  });

  it('names the file and line of an error in an imported module', async () => {
    const broken = { ...files('float'), 'app/routers/items.py': 'from fastapi import APIRouter\nrouter = APIRouter()\n\n@router.get("/x")\ndef x():\n    return 1 / 0\n' };
    const crash = await py.run({ files: broken, entry: 'app/main.py' }, [get('/x')]);
    expect(crash.responses[0].error).toMatchObject({ type: 'ZeroDivisionError', file: 'app/routers/items.py', line: 6 });
    expect(crash.responses[0].error?.trace?.at(-1)).toEqual({ file: 'app/routers/items.py', line: 6, name: 'x' });
    const wrong = { ...broken, 'app/routers/items.py': 'from fastapi import APIRouter\nrouter = APIRouter(\n' };
    expect(loadError(await py.run({ files: wrong, entry: 'app/main.py' }, []))).toMatchObject({ kind: 'syntax', file: 'app/routers/items.py', line: 2 });
  });

  it('reports a circular import and a relative import beyond the top level', async () => {
    const circular = await py.run({ files: { 'main.py': 'from a import f\napp = None\n', 'a.py': 'from b import g\ndef f(): return 1\n', 'b.py': 'from a import f\ndef g(): return 2\n' } }, []);
    expect(loadError(circular)).toMatchObject({ type: 'ImportError', file: 'b.py', message: expect.stringMatching(/circular import/) });
    const beyond = await py.run({ files: { 'main.py': 'from routers import items\napp = None\n', 'routers/__init__.py': '', 'routers/items.py': 'from ..schemas import X\n', 'schemas.py': 'X = 1\n' } }, []);
    expect(loadError(beyond)).toMatchObject({ type: 'ImportError', message: expect.stringMatching(/beyond top-level/) });
    const missing = await py.run({ files: { 'main.py': 'from fastapi import FastAPI\nfrom routers import items\napp = FastAPI()\n', 'routers/items.py': 'X = 1\n' } }, []);
    expect(loadError(missing)).toBeNull(); // a folder without __init__.py is a namespace package and still imports
    const none = await py.run({ files: { 'main.py': 'import utils\napp = None\n' } }, []);
    expect(loadError(none)).toMatchObject({ type: 'ModuleNotFoundError', message: "No module named 'utils'", file: 'main.py', line: 1 });
  });
});

describe('lifespan', () => {
  const APP = `
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request

@asynccontextmanager
async def lifespan(app):
    app.state.hits = 0
    print("startup")
    yield
    print("shutdown")

app = FastAPI(lifespan=lifespan)

@app.get("/hits")
def hits(request: Request):
    request.app.state.hits += 1
    return {"hits": request.app.state.hits}
`;

  it('keep=false: startup before the first request, shutdown after the batch', async () => {
    const run = await py.run(APP, [get('/hits'), get('/hits')]);
    expect(run.load).toEqual({ ok: true });
    expect(run.responses.map((r) => json({ ...run, responses: [r] }).hits)).toEqual([1, 2]);
    expect(run.output).toBe('startup\nshutdown\n');
    expect((await py.run(APP, [get('/hits')])).output).toBe('startup\nshutdown\n');
  });

  it('keep=true: one startup across sends, shutdown when the project changes', async () => {
    py.forget();
    const first = await py.run(APP, [get('/hits')], { keep: true });
    expect(first.output).toBe('startup\n');
    const second = await py.run(APP, [get('/hits')], { keep: true });
    expect(second.output).toBe('');
    expect(json(second).hits).toBe(2);
    const changed = await py.run(APP.replace('"hits": ', '"n": '), [get('/hits')], { keep: true });
    expect(changed.output).toBe('shutdown\nstartup\n');
    expect(json(changed).n).toBe(1);
    py.forget();
  });

  it('a failing startup is a load error with the line', async () => {
    const bad = APP.replace('    print("startup")', '    raise RuntimeError("no db")');
    const run = await py.run(bad, [get('/hits')], { keep: true });
    expect(run.responses).toEqual([]);
    expect(loadError(run)).toMatchObject({ kind: 'load', type: 'RuntimeError', message: 'no db', file: 'main.py', line: 8 });
  });
});

describe('answers and output', () => {
  it('collects a StreamingResponse completely, in several chunks', async () => {
    const run = await py.run(
      `import asyncio
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI()

@app.get("/stream")
async def stream():
    async def gen():
        for i in range(3):
            await asyncio.sleep(1)
            yield f"data: {i}\\n\\n"
    return StreamingResponse(gen(), media_type="text/event-stream")
`,
      [get('/stream')],
    );
    expect(run.responses[0].body).toBe('data: 0\n\ndata: 1\n\ndata: 2\n\n');
    expect(run.responses[0].chunks).toBeGreaterThan(1);
    expect(run.responses[0].ms).toBeLessThan(2000); // the clock is virtual: three sleeps of a second do not wait
  });

  it('puts print and BackgroundTasks output into the request', async () => {
    const run = await py.run(
      `from fastapi import BackgroundTasks, FastAPI

app = FastAPI()

def later(name):
    print("background", name)

@app.post("/send")
def send(tasks: BackgroundTasks):
    print("handler")
    tasks.add_task(later, "mail")
    return {"queued": True}
`,
      [parseRequest('POST /send'), parseRequest('POST /send')],
    );
    expect(run.responses.map((r) => r.output)).toEqual(['handler\nbackground mail\n', 'handler\nbackground mail\n']);
    expect(run.output).toBe('');
  });

  it('routes a logger created at import time into the request that logs', async () => {
    const src = `import logging
from fastapi import FastAPI

log = logging.getLogger("shop")
log.addHandler(logging.StreamHandler())
log.propagate = False
log.warning("loaded")

app = FastAPI()

@app.get("/buy")
def buy():
    log.warning("low stock")
    return {}
`;
    const run = await py.run(src, [get('/buy'), get('/buy')]);
    expect(run.output).toBe('loaded\n');
    expect(run.responses.map((r) => r.output)).toEqual(['low stock\n', 'low stock\n']);
  });

  it('captures the warning about a forgotten await', async () => {
    const run = await py.run(
      `import asyncio
from fastapi import FastAPI

app = FastAPI()

@app.get("/wait")
async def wait():
    asyncio.sleep(1)
    return {"ok": True}
`,
      [get('/wait')],
    );
    expect(run.responses[0].status).toBe(200);
    expect(run.responses[0].output).toContain("RuntimeWarning: coroutine 'sleep' was never awaited");
  });

  it('reports a handler that waits for a client that never answers, and keeps working', async () => {
    const src = `from fastapi import FastAPI, Request

app = FastAPI()

@app.post("/twice")
async def twice(request: Request):
    await request.body()
    async for _ in request.stream():
        pass
    await request.receive()
    return {}

@app.get("/ok")
def ok():
    return {"ok": True}
`;
    const run = await py.run(src, [parseRequest('POST /twice'), get('/ok')]);
    expect(run.responses[0].error).toMatchObject({ type: 'Deadlock' });
    expect(run.responses[1].status).toBe(200);
  });
});

describe('import guard', () => {
  it('blocks js and pyodide from project files, with a Russian message', async () => {
    const run = await py.run({ files: { 'main.py': 'from fastapi import FastAPI\nfrom helper import x\napp = FastAPI()\n', 'helper.py': 'import js\nx = 1\n' } }, []);
    expect(loadError(run)).toMatchObject({ type: 'ImportError', file: 'helper.py', line: 1, message: expect.stringMatching(/Модуль js недоступен/) });
    const other = await py.run({ files: { 'main.py': 'from pyodide.ffi import to_js\napp = None\n' } }, []);
    expect(loadError(other)).toMatchObject({ type: 'ImportError', line: 1 });
    expect(loadError(await py.run({ files: { 'main.py': '__import__("js")\napp = None\n' } }, []))).toMatchObject({ type: 'ImportError' });
  });

  it('explains pip and micropip', async () => {
    for (const name of ['pip', 'micropip']) {
      const run = await py.run(`import ${name}\napp = None`, []);
      expect(loadError(run)).toMatchObject({ type: 'ImportError', message: 'Установка пакетов недоступна: пакеты урока уже подключены' });
    }
    expect(py.script('import micropip', {}).error).toMatchObject({ type: 'ImportError', message: expect.stringMatching(/Установка пакетов/) });
  });

  it('leaves the runtime, the broker shims and ordinary imports working', async () => {
    const run = await py.run('import json, logging, asyncio\nfrom fastapi import FastAPI\napp = FastAPI()\nprint(json.dumps(1))', [get('/')]);
    expect(run.load).toEqual({ ok: true });
    expect(run.output).toBe('1\n');
    expect(py.script('import json\nprint(json.dumps({"a": 1}))', {}).output).toBe('{"a": 1}\n');
    const out = py.client("import pika\nc = pika.BlockingConnection(pika.ConnectionParameters('localhost'))\nch = c.channel()\nch.queue_declare(queue='q', durable=True)\nprint('ok')\nc.close()\n", { flavor: 'rabbit', scripts: [] });
    expect(out.error).toBeUndefined();
    expect(out.output).toBe('ok\n');
    expect(py.client('import js', { flavor: 'rabbit', scripts: [] }).error).toMatchObject({ type: 'ImportError' });
  });
});

describe('project validation', () => {
  const run = (files: Record<string, string>, entry?: string) => py.run({ files, entry }, []);
  const APP = 'from fastapi import FastAPI\napp = FastAPI()\n';

  it('rejects unsafe or unusable paths in Russian', async () => {
    for (const name of ['../x.py', 'a/../x.py', '/abs.py', 'a b.py', 'x//y.py', '.hidden.py', 'dir/', 'a\\b.py', '']) {
      const error = loadError(await run({ 'main.py': APP, [name]: 'x = 1\n' }));
      expect(error, name).toMatchObject({ kind: 'load', type: 'LoadError', message: expect.stringMatching(/Недопустимое имя файла/) });
    }
  });

  it('limits the number and the size of files', async () => {
    const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`f${i}.py`, '']));
    expect(loadError(await run({ ...many, 'main.py': APP }))).toMatchObject({ message: expect.stringMatching(/не больше 40/) });
    expect(loadError(await run({ 'main.py': APP, 'big.py': `x = "${'a'.repeat(410 * 1024)}"` }))).toMatchObject({ message: expect.stringMatching(/не больше 400 КБ/) });
    expect(loadError(await run({ 'main.py': APP, 'ok.py': `x = "${'a'.repeat(300 * 1024)}"` }))).toBeNull();
  });

  it('needs the entry file, an app of FastAPI and a name that is a file or a folder, not both', async () => {
    expect(loadError(await run({ 'other.py': APP }))).toMatchObject({ message: expect.stringMatching(/нет файла main\.py/) });
    expect(loadError(await run({ 'other.py': APP }, 'other.py'))).toBeNull();
    expect(loadError(await run({ 'main.py': 'x = 1\n' }))).toMatchObject({ message: expect.stringMatching(/нет переменной app/) });
    expect(loadError(await run({ 'main.py': 'app = 1\n' }))).toMatchObject({ message: expect.stringMatching(/нужно приложение FastAPI/) });
    expect(loadError(await run({ 'main.py': APP, 'a': 'x', 'a/b.py': 'y' }))).toMatchObject({ message: expect.stringMatching(/конфликтует/) });
  });
});

describe('sessions and guards', () => {
  const COUNTER = (v: number) => `from fastapi import FastAPI

app = FastAPI()
count = {"n": 0}

@app.get("/n")
def n():
    count["n"] += 1
    return {"n": count["n"], "v": ${v}}
`;

  it('a run without keep leaves the kept app alone', async () => {
    py.forget();
    const body = async (code: string, keep: boolean) => json(await py.run(code, [get('/n')], { keep }));
    expect(await body(COUNTER(1), true)).toMatchObject({ n: 1 });
    expect(await body(COUNTER(1), true)).toMatchObject({ n: 2 });
    expect(await body(COUNTER(2), false)).toMatchObject({ n: 1, v: 2 });
    expect(await body(COUNTER(1), true)).toMatchObject({ n: 3 });
    py.forget();
  });

  it('guards importlib.import_module for project files, not for the runtime', async () => {
    const run = await py.run({ files: { 'main.py': 'import importlib\nimportlib.import_module("js")\napp = None\n' } }, []);
    expect(loadError(run)).toMatchObject({ type: 'ImportError', line: 2, message: expect.stringMatching(/Модуль js недоступен/) });
    const pip = await py.run({ files: { 'main.py': 'import importlib\nimportlib.import_module("micropip")\napp = None\n' } }, []);
    expect(loadError(pip)).toMatchObject({ message: expect.stringMatching(/Установка пакетов/) });
    expect(loadError(await py.run({ files: { 'main.py': 'import importlib\nimportlib.import_module("json")\nfrom fastapi import FastAPI\napp = FastAPI()\n' } }, []))).toBeNull();
  });
});
