import { beforeAll, describe, expect, it } from 'vitest';
import { freshNodePythonWith } from '../../../scripts/pyodide/node';
import type { Project, PythonRuntime } from './runtime';

let py: PythonRuntime;
beforeAll(async () => {
  py = await freshNodePythonWith(['client', 'pytest']);
}, 120_000);

const MAIN = `
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException

@asynccontextmanager
async def lifespan(app):
    app.state.items = {1: {"id": 1, "name": "tea", "price": 2.5}}
    yield

app = FastAPI(lifespan=lifespan)

@app.get("/items/{item_id}")
def read(item_id: int):
    item = app.state.items.get(item_id)
    if item is None:
        raise HTTPException(404, "нет")
    return item
`;

const CONFTEST = `
import pytest
from fastapi.testclient import TestClient
from main import app

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c
`;

const PASSING = `
import pytest

def test_read(client):
    assert client.get("/items/1").status_code == 200

@pytest.mark.parametrize("item_id", [2, 3])
def test_missing(client, item_id):
    assert client.get(f"/items/{item_id}").status_code == 404
`;

const project = (tests: Record<string, string>): Project => ({ files: { 'main.py': MAIN, 'tests/conftest.py': CONFTEST, ...tests } });

describe('pytest runner', () => {
  it('runs passing tests with fixtures, lifespan and parametrize; reports the first run time', () => {
    const run = py.test(project({ 'tests/test_items.py': PASSING }));
    console.log(`pytest first run: ${run.ms} ms`);
    expect(run.exit).toBe(0);
    expect(run.counts).toEqual({ passed: 3, failed: 0, error: 0, skipped: 0 });
    expect(run.tests.map((t) => t.nodeid)).toEqual(['tests/test_items.py::test_read', 'tests/test_items.py::test_missing[2]', 'tests/test_items.py::test_missing[3]']);
    expect(run.tests[0]).toMatchObject({ outcome: 'passed', file: 'tests/test_items.py', message: '' });
    expect(run.output).toMatch(/3 passed/);
  });

  it('reports a failing test with the crash lines, file and line; the second run sees an edited test file', () => {
    const failing = PASSING.replace('== 200', '== 404');
    const first = py.test(project({ 'tests/test_items.py': failing }));
    expect(first.exit).toBe(1);
    expect(first.counts).toMatchObject({ passed: 2, failed: 1 });
    const bad = first.tests.find((t) => t.outcome === 'failed')!;
    expect(bad.nodeid).toBe('tests/test_items.py::test_read');
    expect(bad.message).toContain('assert 200 == 404');
    expect(bad).toMatchObject({ file: 'tests/test_items.py', line: 5 });
    expect(bad.message.length).toBeLessThanOrEqual(600);
    expect(first.output).toMatch(/1 failed, 2 passed/);

    const second = py.test(project({ 'tests/test_items.py': PASSING }));
    console.log(`pytest second run: ${second.ms} ms`);
    expect(second.exit).toBe(0);
    expect(second.counts.failed).toBe(0);
  });

  it('sees an edit of the application between runs too', () => {
    const tests = { 'tests/test_items.py': PASSING };
    expect(py.test(project(tests)).exit).toBe(0);
    const edited = { files: { ...project(tests).files, 'main.py': MAIN.replace('"/items/{item_id}"', '"/products/{item_id}"') } };
    const run = py.test(edited);
    expect(run.exit).toBe(1);
    expect(run.tests.find((t) => t.outcome === 'failed')?.message).toContain('assert 404 == 200');
  });

  it('turns a collection error into an error case', () => {
    const run = py.test(project({ 'tests/test_items.py': 'from missing_module import thing\n\ndef test_x():\n    assert thing\n' }));
    expect(run.exit).toBe(2);
    expect(run.counts.error).toBe(1);
    const err = run.tests.find((t) => t.outcome === 'error')!;
    expect(err.nodeid).toBe('tests/test_items.py');
    expect(err.message).toContain("No module named 'missing_module'");
    expect(err).toMatchObject({ file: 'tests/test_items.py', line: 1 });
  });

  it('reports a missing fixture as an error of that test', () => {
    const run = py.test(project({ 'tests/test_items.py': 'def test_x(no_such_fixture):\n    pass\n' }));
    expect(run.counts).toMatchObject({ error: 1, passed: 0 });
    expect(run.tests[0].message).toContain("fixture 'no_such_fixture' not found");
  });

  it('exits with 5 when there are no tests, and passes arguments through', () => {
    const none = py.test({ files: { 'main.py': MAIN } });
    expect(none.exit).toBe(5);
    expect(none.tests).toEqual([]);
    const some = py.test(project({ 'tests/test_items.py': PASSING }), ['-k', 'missing']);
    expect(some.counts.passed).toBe(2);
  });

  it('refuses reading app files from a test, but lazy imports and the app itself still work', () => {
    const reads = [
      'def test_a():\n    from pathlib import Path\n    Path("/project/main.py").read_text()\n',
      'def test_b():\n    open("main.py").read()\n',
      'def test_c():\n    import os\n    os.listdir("/project")\n',
    ];
    const run = py.test(project({ 'tests/test_r.py': reads.join('\n') }));
    expect(run.counts).toMatchObject({ failed: 3, passed: 0 });
    expect(run.tests.every((t) => t.message.includes('не чтением его файлов'))).toBe(true);
    const lazy = 'def test_lazy(client):\n    import lazymod\n    assert lazymod.X == 1\n    assert client.get("/data").json() == {"v": "ok"}\n';
    const main = `${MAIN}\n@app.get("/data")\ndef data():\n    return {"v": open("/project/data.txt").read()}\n`;
    const files = project({ 'tests/test_l.py': lazy, 'lazymod.py': 'X = 1\n', 'data.txt': 'ok', 'main.py': main });
    expect(py.test(files).counts).toMatchObject({ passed: 1, failed: 0, error: 0 });
  });

  it('returns an error output for an invalid project instead of throwing', () => {
    const run = py.test({ files: { '../x.py': '' } });
    expect(run.exit).toBe(4);
    expect(run.output).toMatch(/Недопустимое имя файла/);
  });

  it('does not leave the project behind for the next run', async () => {
    py.test(project({ 'tests/test_items.py': PASSING }));
    const run = await py.run({ files: { 'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n' } }, [{ method: 'GET', url: '/items/1', headers: [], body: '' }]);
    expect(run.responses[0].status).toBe(404);
  });
});
