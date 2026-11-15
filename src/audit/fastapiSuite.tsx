// The FastAPI suite: the real FastapiPanel (and ApiWorkbench around it) over a sandbox store filled with fixed data:
// single-file and tree projects, read-only marks, tab overflow, a rich OpenAPI document, test runs, logs, a stream note and
// a check in progress. No Python runs: everything the panel shows is put into the store.
import { useSyncExternalStore, type ReactElement } from 'react';
import { ApiSandboxContext, createApiSandboxStore, type ApiSandboxState, type PythonDocs } from '@/features/api/apiStore';
import { ApiWorkbench } from '@/features/api/ApiWorkbench';
import { FastapiPanel, type Side } from '@/features/api/FastapiPanel';
import { readSpec } from '@/features/fastapi/openapi';
import { CheckProgress } from '@/features/lesson/CheckProgress';
import { Button } from '@/ui/Button';
import { CheckIcon, ResetIcon } from '@/ui/icons';
import type { AuditCase } from './api';
import { logLines, manyFiles, richOpenapi, SINGLE_FILE, streamExchange, testRun, TREE_FILES, TREE_READONLY } from './fastapiFixture';
import { registerSuite, settle, type AuditSuite } from './suites';

interface Scene {
  label: string;
  files: Record<string, string>;
  /** Show the tree (default: more than one file). */
  tree?: boolean;
  readonly?: string[];
  /** Files opened in tabs besides the entry; the last is active. */
  open?: string[];
  side?: Side;
  /** Width of the panel in px (default: the page). */
  width?: number;
  height?: number;
  state?: Partial<Pick<ApiSandboxState, 'pythonLog' | 'tests' | 'exchanges'>> & { docs?: PythonDocs };
  /** Open every operation and schema of the documentation. */
  expand?: boolean;
  /** Put the panel in the lesson's workbench and show a long check on its button. */
  workbench?: { checking: boolean };
}

const docs = (): PythonDocs => ({ spec: readSpec(richOpenapi()), loading: false, error: null, stale: false });
const MANY = manyFiles();

interface Fixture {
  id: string;
  stress: boolean;
  scenes: Scene[];
}

const FIXTURES: Fixture[] = [
  {
    id: 'single',
    stress: false,
    scenes: [
      { label: 'request', files: SINGLE_FILE },
      { label: 'docs', files: SINGLE_FILE, side: 'docs', state: { docs: docs() } },
      { label: 'log', files: SINGLE_FILE, side: 'log', state: { pythonLog: logLines('long') } },
      { label: 'stacked 700', files: SINGLE_FILE, width: 700 },
    ],
  },
  {
    id: 'tree',
    stress: false,
    scenes: [
      { label: 'readonly marks', files: TREE_FILES, readonly: TREE_READONLY, open: ['app/config.py'] },
      { label: 'readonly entry of a tab', files: TREE_FILES, readonly: TREE_READONLY, open: ['app/config.py', 'tests/conftest.py'] },
      { label: 'stacked 700', files: TREE_FILES, readonly: TREE_READONLY, open: ['app/config.py'], width: 700 },
    ],
  },
  {
    id: 'tree-many',
    stress: true,
    scenes: [
      { label: 'thirty files', files: MANY, readonly: Object.keys(MANY).slice(1, 6) },
      { label: 'tabs overflow', files: MANY, readonly: Object.keys(MANY).slice(1, 6), open: Object.keys(MANY).slice(1, 13) },
      { label: 'tabs overflow narrow', files: MANY, readonly: Object.keys(MANY).slice(1, 6), open: Object.keys(MANY).slice(1, 13), width: 700 },
    ],
  },
  {
    id: 'docs-rich',
    stress: true,
    scenes: [
      { label: 'collapsed', files: TREE_FILES, side: 'docs', state: { docs: docs() } },
      { label: 'expanded', files: TREE_FILES, side: 'docs', state: { docs: docs() }, expand: true },
      { label: 'expanded narrow', files: SINGLE_FILE, side: 'docs', state: { docs: docs() }, expand: true, width: 700 },
      { label: 'loading', files: SINGLE_FILE, side: 'docs', state: { docs: { spec: null, loading: true, error: null, stale: false } } },
      { label: 'error', files: SINGLE_FILE, side: 'docs', state: { docs: { spec: null, loading: false, error: 'Приложение не запустилось: ModuleNotFoundError: No module named «app.routers.very_long_module_name»', stale: false } } },
    ],
  },
  {
    id: 'tests',
    stress: false,
    scenes: [
      { label: 'not run', files: TREE_FILES, side: 'tests' },
      { label: 'passed', files: TREE_FILES, side: 'tests', state: { tests: { running: false, run: testRun('passed'), error: null } } },
      { label: 'failed and error', files: TREE_FILES, side: 'tests', state: { tests: { running: false, run: testRun('mixed'), error: null } } },
      { label: 'running', files: TREE_FILES, side: 'tests', state: { tests: { running: true, run: null, error: null } } },
      { label: 'could not run', files: TREE_FILES, side: 'tests', state: { tests: { running: false, run: null, error: 'pytest не запустился: ' + 'очень_длинное_сообщение_'.repeat(6) } } },
    ],
  },
  {
    id: 'tests-long',
    stress: true,
    scenes: [
      { label: 'long assertion', files: TREE_FILES, side: 'tests', state: { tests: { running: false, run: testRun('long'), error: null } } },
      { label: 'long assertion narrow', files: TREE_FILES, side: 'tests', width: 700, state: { tests: { running: false, run: testRun('long'), error: null } } },
      { label: 'forty cases', files: TREE_FILES, side: 'tests', state: { tests: { running: false, run: testRun('many'), error: null } } },
    ],
  },
  {
    id: 'log',
    stress: true,
    scenes: [
      { label: 'empty', files: TREE_FILES, side: 'log' },
      { label: 'long lines', files: TREE_FILES, side: 'log', state: { pythonLog: logLines('long') } },
      { label: 'long lines narrow', files: TREE_FILES, side: 'log', width: 700, state: { pythonLog: logLines('long') } },
      { label: 'many lines', files: TREE_FILES, side: 'log', state: { pythonLog: logLines('many') } },
    ],
  },
  {
    id: 'workbench',
    stress: false,
    scenes: [
      { label: 'stream note', files: SINGLE_FILE, height: 760, workbench: { checking: false }, state: { exchanges: [streamExchange()] } },
      { label: 'check in progress', files: TREE_FILES, readonly: TREE_READONLY, height: 760, workbench: { checking: true }, state: { exchanges: [streamExchange()] } },
    ],
  },
];

const PROGRESS = 'Тесты на копии с ошибкой 2 из 3…';

async function waitFor(done: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
}

function build(scene: Scene): ReactElement {
  const store = createApiSandboxStore();
  const paths = Object.keys(scene.files);
  store.getState().reset('GET /ping', {
    server: null,
    python: { files: scene.files, entry: 'main.py', tree: scene.tree ?? paths.length > 1, groups: [], readonly: scene.readonly ?? [] },
  });
  for (const path of scene.open ?? []) store.getState().openPythonFile(path);
  if (scene.state) store.setState(scene.state);
  const body = scene.workbench ? (
    <ApiWorkbench
      prefix="audit-fastapi"
      actions={
        <>
          <CheckProgress checking={scene.workbench.checking} progress={PROGRESS} />
          <Button aria-label="Вернуть запрос к началу задания" title="Сбросить" icon={<ResetIcon />} />
          <Button variant="check" icon={<CheckIcon />} shortcut="Ctrl ⇧ ↵" disabled={scene.workbench.checking}>
            {scene.workbench.checking ? 'Проверяю…' : 'Проверить'}
          </Button>
        </>
      }
    />
  ) : (
    <div className="@container h-full overflow-hidden rounded-md border border-line bg-panel">
      <FastapiPanel initialSide={scene.side} />
    </div>
  );
  return (
    <ApiSandboxContext.Provider value={store}>
      <div style={{ width: scene.width ? `min(100%, ${scene.width}px)` : '100%', height: scene.height ?? 620 }}>{body}</div>
    </ApiSandboxContext.Provider>
  );
}

// --- page ---------------------------------------------------------------------------------------------------------

let current: ReactElement | null = null;
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};

export function FastapiAuditPage() {
  const element = useSyncExternalStore(subscribe, () => current);
  return (
    <main className="min-h-full p-4 text-fg">
      {element && (
        <section aria-label="Фикстура FastAPI" className="flex flex-col gap-3">
          {element}
        </section>
      )}
    </main>
  );
}

export const fastapiSuite: AuditSuite = registerSuite({
  id: 'fastapi',
  plan(o) {
    const out: AuditCase[] = [];
    FIXTURES.forEach((f, i) => {
      if (o.only && !o.only.includes(i + 1)) return;
      f.scenes.forEach((scene, s) => out.push({ suite: 'fastapi', n: i + 1, level: 'core', seed: s, tag: f.stress ? 'bad' : 'seed', view: 'task', label: `${f.id}/${scene.label}` }));
    });
    return out;
  },
  async render(c) {
    const scene = FIXTURES[c.n - 1]?.scenes[c.seed];
    if (!scene) return 'unknown fixture';
    current = null;
    listeners.forEach((l) => l());
    await settle();
    current = build(scene);
    listeners.forEach((l) => l());
    await settle();
    // Monaco loads lazily; the editor is part of what the panel shows.
    await waitFor(() => document.querySelector('.monaco-editor .view-lines') !== null, 15_000);
    if (scene.expand) {
      for (let round = 0; round < 3; round++) {
        document.querySelectorAll<HTMLButtonElement>('#fastapi-panel button[aria-expanded="false"]').forEach((b) => b.click());
        await settle();
      }
    }
    await settle();
    window.scrollTo(0, 0);
    return document.querySelector('.monaco-editor') ? null : 'editor did not load';
  },
});
