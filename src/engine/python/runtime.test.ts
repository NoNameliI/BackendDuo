import { beforeAll, describe, expect, it } from 'vitest';
import { parseRequest } from '@/engine/api/http';
import { nodePython } from '../../../scripts/pyodide/node';
import type { AppRunner, ScriptRunner } from './runtime';

const APP = `
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()
TASKS = {1: {"id": 1, "title": "Купить хлеб", "done": False}}

class TaskIn(BaseModel):
    title: str = Field(min_length=1)

@app.get("/tasks/{task_id}")
def get_task(task_id: int):
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    return TASKS[task_id]

@app.post("/tasks", status_code=201)
async def create_task(task: TaskIn):
    new_id = max(TASKS) + 1
    TASKS[new_id] = {"id": new_id, "title": task.title, "done": False}
    print("создана", new_id)
    return TASKS[new_id]

@app.get("/boom")
def boom():
    return {"x": 1 / 0}
`;

const req = (text: string) => parseRequest(text);
let run: AppRunner;
let script: ScriptRunner;

beforeAll(async () => {
  ({ run, script } = await nodePython());
}, 60_000);

describe('FastAPI in Pyodide', () => {
  it('answers like FastAPI: data, 404, 422, 201, print output', async () => {
    const out = await run(APP, [
      req('GET /tasks/1'),
      req('GET /tasks/7'),
      req('GET /tasks/abc'),
      req('POST /tasks\nContent-Type: application/json\n\n{"title": "Позвонить"}'),
      req('POST http://127.0.0.1:8000/tasks\nContent-Type: application/json\n\n{"title": ""}'),
    ]);
    expect(out.load).toEqual({ ok: true });
    expect(out.responses.map((r) => r.status)).toEqual([200, 404, 422, 201, 422]);
    expect(JSON.parse(out.responses[0].body)).toEqual({ id: 1, title: 'Купить хлеб', done: false });
    expect(JSON.parse(out.responses[1].body)).toEqual({ detail: 'Задача не найдена' });
    expect(JSON.parse(out.responses[2].body).detail[0]).toMatchObject({ type: 'int_parsing', loc: ['path', 'task_id'] });
    expect(out.output).toBe('создана 2\n');
  });

  it('keeps the app between sends only when asked and for the same code', async () => {
    const post = req('POST /tasks\nContent-Type: application/json\n\n{"title": "a"}');
    expect(JSON.parse((await run(APP, [post], { keep: true })).responses[0].body).id).toBe(2);
    expect(JSON.parse((await run(APP, [post], { keep: true })).responses[0].body).id).toBe(3);
    expect(JSON.parse((await run(APP, [post])).responses[0].body).id).toBe(2);
  });

  it('reports errors with the line of main.py', async () => {
    const boom = (await run(APP, [req('GET /boom')])).responses[0];
    expect(boom.status).toBe(500);
    expect(boom.error).toEqual({ kind: 'request', type: 'ZeroDivisionError', message: 'division by zero', line: 26 });
    expect((await run('from fastapi import FastAPI\napp = FastAPI(\n', [])).load).toMatchObject({ ok: false, error: { kind: 'syntax', line: 2 } });
    expect((await run('x = 1', [])).load).toMatchObject({ ok: false, error: { kind: 'load', message: expect.stringMatching(/нет переменной app/) } });
    expect((await run('import js\napp = None', [])).load).toMatchObject({ ok: false, error: { type: 'ImportError', line: 1 } });
    expect((await run('import uvicorn\nfrom fastapi import FastAPI\napp = FastAPI()\nuvicorn.run(app)', [])).output).toMatch(/не нужен/);
  });
});

describe('script op', () => {
  it('reads a saved file (utf-8-sig), prints, reports errors and blocks js', () => {
    const csv = '\uFEFFa;b\r\n1;2\r\n3;4\r\n';
    const ok = script("with open('t.csv', encoding='utf-8-sig') as f:\n    print(len(f.read().splitlines()))", { 't.csv': csv });
    expect(ok.output).toBe('3\n');
    expect(ok.error).toBeUndefined();
    expect(script('print(1/0)', {}).error).toMatchObject({ type: 'ZeroDivisionError', line: 1 });
    expect(script('x = (', {}).error).toMatchObject({ kind: 'syntax' });
    expect(script('import js', {}).error).toMatchObject({ type: 'ImportError', line: 1 });
    expect(script('print(__name__)', {}).output).toBe('__main__\n');
    expect(script("open('t.csv')", {}).error).toMatchObject({ type: 'FileNotFoundError' });
    expect(script('print(1)', { '../x': 'a' }).error).toMatchObject({ type: 'ValueError' });
  });

  it('leaves the kept FastAPI app untouched', async () => {
    const post = req('POST /tasks\nContent-Type: application/json\n\n{"title": "a"}');
    const id = async () => JSON.parse((await run(APP, [post], { keep: true })).responses[0].body).id as number;
    const first = await id();
    expect(script('app = 1\nprint(app)', {}).output).toBe('1\n');
    expect(await id()).toBe(first + 1);
  });
});
