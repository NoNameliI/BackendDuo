import { describe, expect, it } from 'vitest';
import { buildTree, closeTab, createFile, deleteFile, hasTests, MAX_BYTES, MAX_FILES, openFile, pathError, renameFile, sizeError, visibleNodes, type ProjectState } from './project';

const state = (): ProjectState => ({ files: { 'main.py': 'app', 'routers/items.py': 'r', 'tests/test_a.py': 't' }, entry: 'main.py', active: 'main.py', open: ['main.py'] });

describe('pathError', () => {
  it('accepts the names the runtime accepts', () => {
    for (const p of ['main.py', 'app/main.py', 'routers/items.py', '_x.py', 'a-b.c', 'tests/__init__.py', '.env']) expect(pathError(p), p).toBeNull();
  });
  it('refuses the names the runtime refuses', () => {
    for (const p of ['', ' ', '/main.py', 'a//b.py', 'a/', '../x.py', 'a/../b.py', 'a..b.py', '.envrc', '.git', '-x.py', 'a b.py', 'файл.py', ' main.py']) expect(pathError(p), p).not.toBeNull();
  });
  it('explains in Russian', () => {
    expect(pathError('')).toBe('Введите имя файла');
    expect(pathError('a/../b')).toContain('..');
  });
});

describe('file operations', () => {
  it('creates and opens a file', () => {
    const r = createFile(state(), 'models.py', 'x = 1');
    expect(r).toMatchObject({ ok: true, value: { active: 'models.py', open: ['main.py', 'models.py'] } });
    if (r.ok) expect(r.value.files['models.py']).toBe('x = 1');
  });
  it('refuses duplicates, file/folder clashes and bad names', () => {
    expect(createFile(state(), 'main.py')).toMatchObject({ ok: false, error: 'Файл «main.py» уже есть' });
    expect(createFile(state(), 'routers')).toMatchObject({ ok: false });
    expect(createFile(state(), 'main.py/x.py')).toMatchObject({ ok: false });
    expect(createFile(state(), '../x.py')).toMatchObject({ ok: false });
  });
  it('enforces the limits', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_FILES }, (_, i) => [`f${i}.py`, '']));
    expect(createFile({ files: many, entry: 'f0.py', active: 'f0.py', open: ['f0.py'] }, 'one_more.py')).toMatchObject({ ok: false });
    expect(sizeError({ 'main.py': 'x'.repeat(MAX_BYTES + 1) })).toContain('КБ');
    expect(sizeError({ 'main.py': 'x' })).toBeNull();
  });
  it('renames, and moves the entry with its file', () => {
    const open = { ...state(), open: ['main.py', 'routers/items.py'], active: 'routers/items.py' };
    const r = renameFile(open, 'routers/items.py', 'routers/things.py');
    expect(r).toMatchObject({ ok: true, value: { active: 'routers/things.py', open: ['main.py', 'routers/things.py'] } });
    const e = renameFile(state(), 'main.py', 'app/main.py');
    expect(e).toMatchObject({ ok: true, value: { entry: 'app/main.py', active: 'app/main.py', open: ['app/main.py'] } });
    expect(renameFile(state(), 'main.py', 'tests/test_a.py')).toMatchObject({ ok: false });
    expect(renameFile(state(), 'nope.py', 'x.py')).toMatchObject({ ok: false });
  });
  it('deletes any file but the entry', () => {
    expect(deleteFile(state(), 'main.py')).toMatchObject({ ok: false });
    const s = { ...state(), open: ['main.py', 'routers/items.py'], active: 'routers/items.py' };
    const r = deleteFile(s, 'routers/items.py');
    expect(r).toMatchObject({ ok: true, value: { active: 'main.py', open: ['main.py'] } });
    if (r.ok) expect(Object.keys(r.value.files)).toEqual(['main.py', 'tests/test_a.py']);
  });
  it('opens and closes tabs, keeping one', () => {
    const s = openFile(openFile(state(), 'routers/items.py'), 'tests/test_a.py');
    expect(s.open).toEqual(['main.py', 'routers/items.py', 'tests/test_a.py']);
    expect(closeTab(s, 'tests/test_a.py')).toMatchObject({ active: 'routers/items.py', open: ['main.py', 'routers/items.py'] });
    expect(closeTab(state(), 'main.py').open).toEqual(['main.py']);
    expect(openFile(state(), 'ghost.py')).toEqual(state());
  });
});

describe('tree', () => {
  it('puts folders first and sorts by name', () => {
    const tree = buildTree(['main.py', 'tests/test_a.py', 'routers/items.py', 'routers/__init__.py', 'a.py']);
    expect(tree.map((n) => n.name)).toEqual(['routers', 'tests', 'a.py', 'main.py']);
    expect(tree[0].children.map((n) => n.path)).toEqual(['routers/__init__.py', 'routers/items.py']);
  });
  it('lists visible nodes and honours collapsed folders', () => {
    const tree = buildTree(['main.py', 'routers/items.py']);
    expect(visibleNodes(tree, new Set()).map((v) => `${v.depth}:${v.node.path}`)).toEqual(['0:routers', '1:routers/items.py', '0:main.py']);
    expect(visibleNodes(tree, new Set(['routers'])).map((v) => v.node.path)).toEqual(['routers', 'main.py']);
  });
  it('detects tests', () => {
    expect(hasTests({ 'main.py': '', 'tests/test_a.py': '' })).toBe(true);
    expect(hasTests({ 'main.py': '' })).toBe(false);
  });
});
