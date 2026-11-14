import { beforeAll, describe, expect, it } from 'vitest';
import { nodePython } from '../../../scripts/pyodide/node';
import type { PythonRuntime, StaticRule } from './runtime';

let analyze: PythonRuntime['analyze'];

beforeAll(async () => {
  ({ analyze } = await nodePython());
}, 60_000);

const check = (files: Record<string, string>, rules: StaticRule[], entry?: string) => analyze({ files, entry }, rules).problems;

describe('static rules', () => {
  it('uses: names, attributes, keywords, file filter', () => {
    const files = { 'main.py': 'from fastapi import Depends\nx = Depends(f)\napp.dependency_overrides[x] = y\n', 'tests/t.py': 'pass\n' };
    expect(check(files, [{ rule: 'uses', name: 'dependency_overrides' }])).toEqual([]);
    expect(check(files, [{ rule: 'uses', name: 'Depends' }])).toEqual([]);
    expect(check(files, [{ rule: 'uses', name: 'dependency_overrides', file: 'tests/t.py' }])).toHaveLength(1);
    expect(check(files, [{ rule: 'uses', name: 'BackgroundTasks', message: 'Нужен BackgroundTasks.' }])).toEqual(['Нужен BackgroundTasks.']);
    expect(check({ 'main.py': '@app.get("/", response_model=X)\ndef f(): ...\n' }, [{ rule: 'uses', name: 'response_model' }])).toEqual([]);
  });

  it('imports: module and name', () => {
    const files = { 'main.py': 'import time\nfrom fastapi import FastAPI, Depends\nfrom pydantic.fields import Field\n' };
    expect(check(files, [{ rule: 'imports', module: 'time' }, { rule: 'imports', module: 'fastapi', name: 'Depends' }])).toEqual([]);
    expect(check(files, [{ rule: 'imports', module: 'pydantic' }])).toEqual([]);
    expect(check(files, [{ rule: 'imports', module: 'fastapi', name: 'Header' }])[0]).toContain('from fastapi import Header');
    expect(check(files, [{ rule: 'imports', module: 'os' }])[0]).toContain('import os');
  });

  it('no-blocking-in-async: direct calls only, aliases resolved', () => {
    const bad = 'import time\nimport requests as r\nfrom time import sleep\n\nasync def a():\n    time.sleep(1)\n    r.get("x")\n    sleep(2)\n';
    const problems = check({ 'main.py': bad }, [{ rule: 'no-blocking-in-async' }]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain('main.py:6');
    const ok = 'import time\n\ndef s():\n    time.sleep(1)\n\nasync def a():\n    def inner():\n        time.sleep(1)\n    await asyncio.sleep(1)\n';
    expect(check({ 'main.py': ok }, [{ rule: 'no-blocking-in-async' }])).toEqual([]);
    expect(check({ 'main.py': 'async def a():\n    db.query()\n' }, [{ rule: 'no-blocking-in-async', calls: ['db.*'] }])).toHaveLength(1);
  });

  it('router: defined, has a route, included by the entry module', () => {
    const router = 'from fastapi import APIRouter\nrouter = APIRouter()\n\n@router.get("/")\ndef f(): ...\n';
    const rule: StaticRule = { rule: 'router', file: 'routers/items.py' };
    const main = 'from fastapi import FastAPI\nfrom routers.items import router as items\napp = FastAPI()\napp.include_router(items)\n';
    expect(check({ 'main.py': main, 'routers/items.py': router }, [rule])).toEqual([]);
    expect(check({ 'main.py': 'from routers import items\napp.include_router(items.router)\n', 'routers/items.py': router }, [rule])).toEqual([]);
    expect(check({ 'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n', 'routers/items.py': router }, [rule])[0]).toContain('не подключён');
    expect(check({ 'main.py': main, 'routers/items.py': 'from fastapi import APIRouter\nrouter = APIRouter()\n' }, [rule])[0]).toContain('нет ни одного маршрута');
    expect(check({ 'main.py': main, 'routers/items.py': 'x = 1\n' }, [rule])[0]).toContain('не создан APIRouter');
    expect(check({ 'main.py': main }, [rule])[0]).toContain('не найден');
  });

  it('response-model-hides: response_model, list, optional, return annotation, bases', () => {
    const models = 'from pydantic import BaseModel\n\nclass Base(BaseModel):\n    id: int\n    password: str\n\nclass UserOut(Base):\n    name: str\n\nclass Safe(BaseModel):\n    name: str\n';
    const rule: StaticRule = { rule: 'response-model-hides', field: 'password' };
    const route = (decl: string) => `from models import *\n${decl}\n`;
    const hit = (decl: string) => check({ 'main.py': route(decl), 'models.py': models }, [rule]);
    expect(hit('@app.get("/", response_model=UserOut)\ndef f(): ...')[0]).toContain('main.py:3');
    expect(hit('@app.get("/", response_model=list[UserOut])\ndef f(): ...')).toHaveLength(1);
    expect(hit('@app.get("/", response_model=UserOut | None)\ndef f(): ...')).toHaveLength(1);
    expect(hit('@app.get("/")\ndef f() -> list[UserOut]: ...')).toHaveLength(1);
    expect(hit('@app.get("/", response_model=Safe)\ndef f(): ...')).toEqual([]);
    expect(hit('@app.get("/")\ndef f(): ...')).toEqual([]);
  });

  it('no-literal-secret: assignments, keywords, dict keys; environment reads pass', () => {
    const rule: StaticRule = { rule: 'no-literal-secret', names: ['SECRET_KEY', 'password'] };
    expect(check({ 'main.py': 'SECRET_KEY = "abc"\n' }, [rule])[0]).toContain('main.py:1');
    expect(check({ 'main.py': 'cfg = Settings(Password="x")\n' }, [rule])).toHaveLength(1);
    expect(check({ 'main.py': 'cfg = {"secret_key": "x"}\n' }, [rule])).toHaveLength(1);
    expect(check({ 'main.py': 'import os\nSECRET_KEY = os.environ["SECRET_KEY"]\nOTHER = "x"\nSECRET_KEY2 = ""\n' }, [rule])).toEqual([]);
  });

  it('pattern: required and forbidden, message override, bad regex', () => {
    const files = { 'main.py': 'x = 1\nprint("hi")\n' };
    expect(check(files, [{ rule: 'pattern', regex: 'print\\(', forbid: true, message: 'Уберите print.' }])).toEqual(['Уберите print.']);
    expect(check(files, [{ rule: 'pattern', regex: 'logging', message: 'Нужен logging.' }])).toEqual(['Нужен logging.']);
    expect(check(files, [{ rule: 'pattern', regex: '^x = 1$', message: 'm' }])).toEqual([]);
    expect(check(files, [{ rule: 'pattern', regex: '(', message: 'm' }])[0]).toBe('m');
  });

  it('works across files and reports a syntax error with file:line, skipping the rules', () => {
    const files = { 'main.py': 'import fastapi\n', 'routers/a.py': 'def f(:\n    pass\n', 'b.py': 'x = (\n' };
    const problems = check(files, [{ rule: 'uses', name: 'nothing' }]);
    expect(problems).toHaveLength(2);
    expect(problems.every((p) => p.includes('синтаксическая ошибка'))).toBe(true);
    expect(problems.some((p) => p.startsWith('routers/a.py:1:'))).toBe(true);
    expect(check({ 'main.py': 'import fastapi\n', 'notes.txt': 'def (' }, [{ rule: 'imports', module: 'fastapi' }])).toEqual([]);
    expect(check({ 'main.py': 'x = 1\n' }, [{ rule: 'nope' } as unknown as StaticRule])[0]).toContain('Неизвестное правило');
  });

  it('no-blocking-in-async: lambdas, local helpers, assignment aliases, offloaded lambdas pass', () => {
    const rule: StaticRule = { rule: 'no-blocking-in-async' };
    const run = (src: string) => check({ 'main.py': src }, [rule]);
    expect(run('import time\nasync def a():\n    f = lambda: time.sleep(1)\n')).toHaveLength(1);
    const helper = 'import time\ndef wait():\n    time.sleep(1)\nasync def a():\n    wait()\n';
    expect(run(helper)[0]).toContain('main.py:3');
    expect(run(helper)[0]).toContain('wait');
    expect(run('import time\ns = time.sleep\nasync def a():\n    s(1)\n')).toHaveLength(1);
    expect(run('import time, asyncio\nasync def a():\n    await asyncio.to_thread(lambda: time.sleep(1))\n')).toEqual([]);
    expect(run('import time\ndef wait():\n    time.sleep(1)\ndef other():\n    wait()\nasync def a():\n    other()\n')).toEqual([]);
  });

  it('uses/imports/router: only files reachable from the entry, no tests, no dead code', () => {
    const files = {
      'main.py': 'from routers import items\nimport pkg.sub\nif False:\n    import secretmod\n    app.dependency_overrides = 1\n',
      'routers/__init__.py': '',
      'routers/items.py': 'import json\nBackgroundTasks\n',
      'pkg/__init__.py': '',
      'pkg/sub.py': '',
      'orphan.py': 'import orphanmod\nOrphanName\n',
      'tests/test_a.py': 'import testonly\nTestName\n',
    };
    expect(check(files, [{ rule: 'imports', module: 'json' }, { rule: 'uses', name: 'BackgroundTasks' }])).toEqual([]);
    expect(check(files, [{ rule: 'imports', module: 'orphanmod' }])).toHaveLength(1);
    expect(check(files, [{ rule: 'imports', module: 'testonly' }])).toHaveLength(1);
    expect(check(files, [{ rule: 'uses', name: 'OrphanName' }])).toHaveLength(1);
    expect(check(files, [{ rule: 'uses', name: 'TestName' }])).toHaveLength(1);
    expect(check(files, [{ rule: 'uses', name: 'TestName', file: 'tests/test_a.py' }])).toEqual([]);
    expect(check(files, [{ rule: 'imports', module: 'secretmod' }])).toHaveLength(1);
    expect(check(files, [{ rule: 'uses', name: 'dependency_overrides' }])).toHaveLength(1);
    const router = 'from fastapi import APIRouter\nrouter = APIRouter()\n@router.get("/")\ndef f(): ...\n';
    const dead = { 'main.py': 'from routers.r import router\nif 0:\n    app.include_router(router)\n', 'routers/r.py': router };
    expect(check(dead, [{ rule: 'router', file: 'routers/r.py' }])[0]).toContain('не подключён');
  });

  it('pattern ignores comments but not strings', () => {
    const files = { 'main.py': 'x = 1  # print("hi")\n# eval(1)\ns = "eval(2)"\n' };
    expect(check(files, [{ rule: 'pattern', regex: 'print', forbid: true, message: 'm' }])).toEqual([]);
    expect(check(files, [{ rule: 'pattern', regex: 'eval\\(1', forbid: true, message: 'm' }])).toEqual([]);
    expect(check(files, [{ rule: 'pattern', regex: 'eval\\(2', forbid: true, message: 'm' }])).toEqual(['m']);
  });

  it('no-literal-secret: f-strings, concatenations, literal defaults of getenv', () => {
    const rule: StaticRule = { rule: 'no-literal-secret', names: ['SECRET_KEY'] };
    const run = (src: string) => check({ 'main.py': `import os\n${src}\n` }, [rule]);
    expect(run('SECRET_KEY = f"abc{1}"')).toHaveLength(1);
    expect(run('SECRET_KEY = "a" + "b"')).toHaveLength(1);
    expect(run('SECRET_KEY = os.getenv("SECRET_KEY", "dev")')).toHaveLength(1);
    expect(run('x = os.environ.get("SECRET_KEY", "dev")')).toHaveLength(1);
    expect(run('SECRET_KEY = os.getenv("SECRET_KEY")')).toEqual([]);
    expect(run('SECRET_KEY = os.environ.get("SECRET_KEY") or die()')).toEqual([]);
    expect(run('SECRET_KEY = "a" + os.environ["X"]')).toEqual([]);
  });

  it('tests-api-only: allowed modules and names pass, the rest is named with file:line', () => {
    const rule: StaticRule = { rule: 'tests-api-only' };
    const app = { 'main.py': 'import os\napp = 1\n' };
    const good = 'import pytest\nimport json\nfrom fastapi.testclient import TestClient\nfrom main import app\n\ndef test_x(monkeypatch):\n    monkeypatch.setattr("main.x", 1)\n';
    expect(check({ ...app, 'tests/test_a.py': good }, [rule])).toEqual([]);
    const bad = check(
      { ...app, 'tests/test_b.py': 'import os\nimport importlib\nfrom sys import path\n\ndef test_x():\n    open("f")\n    eval("1")\n    getattr(os, "x")\n    __file__\n' },
      [rule],
    );
    expect(bad.some((p) => p.startsWith('tests/test_b.py:1:') && p.includes('«os»'))).toBe(true);
    expect(bad.some((p) => p.includes(':2:') && p.includes('importlib'))).toBe(true);
    expect(bad.some((p) => p.includes(':3:') && p.includes('«sys»'))).toBe(true);
    for (const n of ['open', 'eval', 'getattr', '__file__']) expect(bad.some((p) => p.includes(n))).toBe(true);
    expect(check({ ...app, 'tests/t.py': 'import os\n' }, [{ rule: 'tests-api-only', message: 'Только API.' }])).toEqual(['Только API.']);
    expect(check({ ...app, 'tests/t.py': 'import time\n' }, [rule])).toHaveLength(1);
  });

  it('tests-api-only: refuses attribute chains, dunders, getattr and MonkeyPatch', () => {
    const rule: StaticRule = { rule: 'tests-api-only' };
    const app = { 'main.py': 'app = 1\n' };
    const bad = (body: string) => check({ ...app, 'tests/t.py': `import typing\nimport pytest\n\ndef test_x(fn):\n    ${body}\n` }, [rule]);
    expect(bad('typing.sys.modules["builtins"].open("routers/items.py").read()').length).toBeGreaterThan(0);
    expect(bad('getattr(fn, "__co" + "de__")').length).toBeGreaterThan(0);
    expect(bad('pytest.MonkeyPatch()').length).toBeGreaterThan(0);
    expect(bad('fn.__globals__')).toHaveLength(1);
    expect(bad('fn.__class__.__mro__').length).toBeGreaterThan(0);
    expect(bad('setattr(fn, "x", 1)').length).toBeGreaterThan(0);
    expect(bad('monkeypatch.setattr("main.x", 1)\n    monkeypatch.setenv("A", "b")')).toEqual([]);
  });

  it('never executes the project', () => {
    const files = { 'main.py': 'raise SystemExit(1)\nopen("/should-not-exist", "w")\n' };
    expect(check(files, [{ rule: 'uses', name: 'SystemExit' }])).toEqual([]);
  });
});
