import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRun, PytestRun } from '@/engine/python/runtime';

const mocks = vi.hoisted(() => ({ run: vi.fn(), test: vi.fn() }));
vi.mock('@/engine/python/pythonClient', () => ({
  PYTHON_BASE_URL: 'http://127.0.0.1:8000',
  pythonClient: () => ({ run: mocks.run, test: mocks.test, prewarm: () => {}, forget: async () => {} }),
}));

import { accessLine, createApiSandboxStore, PYTHON_LOG_LIMIT } from './apiStore';

const run = (over: Partial<AppRun['responses'][number]> = {}, output = ''): AppRun => ({
  load: { ok: true },
  output,
  responses: [{ status: 200, headers: [], body: '{}', ms: 3, output: '', chunks: 1, ...over }],
});

const start = { files: { 'main.py': 'app', 'tests/test_a.py': 't' }, entry: 'main.py', tree: true, groups: ['x'] };

beforeEach(() => {
  mocks.run.mockReset();
  mocks.test.mockReset();
});

describe('python project in the sandbox store', () => {
  it('starts with the entry open and edits the active file', () => {
    const store = createApiSandboxStore();
    store.getState().reset('GET /', { python: start });
    expect(store.getState().python).toMatchObject({ active: 'main.py', open: ['main.py'], tree: true, groups: ['x'] });
    store.getState().setPythonSource('app2');
    store.getState().openPythonFile('tests/test_a.py');
    store.getState().setPythonSource('t2');
    expect(store.getState().python?.files).toEqual({ 'main.py': 'app2', 'tests/test_a.py': 't2' });
    store.getState().closePythonTab('tests/test_a.py');
    expect(store.getState().python).toMatchObject({ active: 'main.py', open: ['main.py'] });
  });

  it('creates, renames and deletes files, refusing the entry and bad names', () => {
    const store = createApiSandboxStore();
    store.getState().reset('GET /', { python: start });
    const s = store.getState();
    expect(s.createPythonFile('routers/items.py')).toBeNull();
    expect(store.getState().python?.active).toBe('routers/items.py');
    expect(store.getState().createPythonFile('../x.py')).toContain('..');
    expect(store.getState().deletePythonFile('main.py')).toContain('точка входа');
    expect(store.getState().renamePythonFile('main.py', 'app/main.py')).toBeNull();
    expect(store.getState().python).toMatchObject({ entry: 'app/main.py' });
    expect(store.getState().deletePythonFile('routers/items.py')).toBeNull();
    expect(Object.keys(store.getState().python?.files ?? {})).toEqual(['app/main.py', 'tests/test_a.py']);
  });

  it('sends the whole project with its groups and writes the app log', async () => {
    mocks.run.mockResolvedValue(run({ output: 'hello\n' }, 'loaded\n'));
    const store = createApiSandboxStore();
    store.getState().reset('GET /items?limit=2', { python: start });
    await store.getState().send();
    expect(mocks.run).toHaveBeenCalledWith({ files: start.files, entry: 'main.py' }, [expect.objectContaining({ method: 'GET' })], { keep: true, groups: ['x'] });
    expect(store.getState().pythonLog.map((l) => [l.kind, l.text])).toEqual([
      ['load', 'loaded'],
      ['access', 'INFO:     127.0.0.1:50000 - "GET /items?limit=2 HTTP/1.1" 200'],
      ['output', 'hello'],
    ]);
    const notes = store.getState().exchanges[0].notes ?? [];
    expect(notes.map((n) => n.text)).toEqual(['Вывод print: loaded\nhello']);
    store.getState().clearPythonLog();
    expect(store.getState().pythonLog).toEqual([]);
  });

  it('notes a streamed answer and caps the log', async () => {
    mocks.run.mockResolvedValue(run({ chunks: 3, output: 'x' }));
    const store = createApiSandboxStore();
    store.getState().reset('GET /', { python: start });
    for (let i = 0; i < PYTHON_LOG_LIMIT; i++) await store.getState().send();
    expect(store.getState().exchanges.at(-1)?.notes?.map((n) => n.text)).toContain('Потоковый ответ: показан целиком после завершения');
    expect(store.getState().pythonLog).toHaveLength(PYTHON_LOG_LIMIT);
  });

  it('reads the docs from /openapi.json and marks them stale after an edit', async () => {
    const spec = { openapi: '3.1.0', info: { title: 'Shop', version: '1' }, paths: { '/items': { get: { responses: { '200': { description: 'ok' } } } } } };
    mocks.run.mockResolvedValue(run({ body: JSON.stringify(spec) }));
    const store = createApiSandboxStore();
    store.getState().reset('GET /', { python: start });
    await store.getState().loadDocs();
    expect(mocks.run).toHaveBeenCalledWith({ files: start.files, entry: 'main.py' }, [expect.objectContaining({ url: '/openapi.json' })], { keep: true, groups: ['x'] });
    expect(store.getState().docs).toMatchObject({ error: null, stale: false, spec: { title: 'Shop' } });
    store.getState().setPythonSource('other');
    expect(store.getState().docs.stale).toBe(true);
  });

  it('reports docs errors and pytest runs', async () => {
    mocks.run.mockResolvedValue(run({ status: 500 }));
    const store = createApiSandboxStore();
    store.getState().reset('GET /', { python: start });
    await store.getState().loadDocs();
    expect(store.getState().docs.error).toContain('500');
    const pytest: PytestRun = { exit: 0, counts: { passed: 1, failed: 0, error: 0, skipped: 0 }, tests: [], output: '', ms: 1 };
    mocks.test.mockResolvedValue(pytest);
    await store.getState().runTests();
    expect(mocks.test).toHaveBeenCalledWith({ files: start.files, entry: 'main.py' }, { groups: ['x'] });
    expect(store.getState().tests).toEqual({ running: false, run: pytest, error: null });
  });
});

describe('accessLine', () => {
  it('writes the path with its query, without the origin', () => {
    expect(accessLine({ method: 'POST', url: 'http://127.0.0.1:8000/a?b=1', headers: [], body: '' }, 201)).toBe('INFO:     127.0.0.1:50000 - "POST /a?b=1 HTTP/1.1" 201');
    expect(accessLine({ method: 'GET', url: 'x', headers: [], body: '' }, 404)).toContain('"GET /x HTTP/1.1" 404');
  });
});
