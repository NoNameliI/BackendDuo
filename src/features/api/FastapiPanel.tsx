import { lazy, Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ApiRequest } from '@/engine/api/http';
import { pythonClient, type PythonStatus } from '@/engine/python/pythonClient';
import { FileTree } from '@/features/fastapi/FileTree';
import { LogPanel } from '@/features/fastapi/LogPanel';
import { OpenApiViewer } from '@/features/fastapi/OpenApiViewer';
import { hasTests } from '@/features/fastapi/project';
import { TestsPanel } from '@/features/fastapi/TestsPanel';
import { Tabs } from '@/ui/Tabs';
import { useApiSandbox } from './apiStore';
import { RequestComposer } from './RequestComposer';

const CodeEditor = lazy(() => import('./CodeEditor'));

export function usePythonStatus(): PythonStatus {
  const client = pythonClient();
  return useSyncExternalStore(client.subscribe, client.status);
}

/** Whether Python is ready; while loading, how long it has been loading. */
export function PythonStatusLine() {
  const status = usePythonStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status.state !== 'loading') return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [status.state]);
  const [tone, text] =
    status.state === 'ready'
      ? ['text-ok', 'Python готов']
      : status.state === 'loading'
        ? ['text-amber', 'Загружаю Python и FastAPI…']
        : status.state === 'failed'
          ? ['text-err', `Python не запустился: ${status.error}`]
          : ['text-faint', 'Python запустится при первом запросе'];
  // Screen readers hear the state changes; the running seconds are for the eyes only.
  return (
    <span className={`truncate font-mono text-[12px] ${tone}`}>
      <span role="status">{text}</span>
      {status.state === 'loading' && <span aria-hidden="true"> {Math.max(0, Math.round((now - status.since) / 1000))} с</span>}
    </span>
  );
}

type Side = 'request' | 'docs' | 'tests' | 'log';

const languageOf = (path: string) => (path.endsWith('.py') ? 'python' : path.endsWith('.json') ? 'json' : 'plaintext');

/** Editor tabs of the open files: select, close (the last one stays). */
function EditorTabs() {
  const useStore = useApiSandbox();
  const python = useStore((s) => s.python);
  const openFile = useStore((s) => s.openPythonFile);
  const closeTab = useStore((s) => s.closePythonTab);
  if (!python) return null;
  return (
    <div role="tablist" aria-label="Открытые файлы" className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line">
      {python.open.map((path) => {
        const selected = path === python.active;
        return (
          <div key={path} className={`relative flex shrink-0 items-center border-r border-line ${selected ? 'bg-raised' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => openFile(path)}
              className={`h-full pl-3 font-mono text-[12px] ${python.open.length > 1 ? 'pr-1' : 'pr-3'} ${selected ? 'text-fg' : 'text-dim hover:text-fg'}`}
            >
              {path}
            </button>
            {python.open.length > 1 && (
              <button type="button" aria-label={`Закрыть вкладку ${path}`} onClick={() => closeTab(path)} className="mr-1 rounded px-1 text-faint hover:text-err">
                ×
              </button>
            )}
            <span aria-hidden className={`absolute inset-x-0 -bottom-px h-0.5 ${selected ? 'bg-amber' : 'bg-transparent'}`} />
          </div>
        );
      })}
    </div>
  );
}

/** FastAPI tasks: the code on the left (a file tree and tabs for a multi-file project), requests, docs, tests and log on the right. */
export function FastapiPanel() {
  const useStore = useApiSandbox();
  const python = useStore((s) => s.python);
  const setPythonSource = useStore((s) => s.setPythonSource);
  const setDraft = useStore((s) => s.setDraft);
  const docs = useStore((s) => s.docs);
  const loadDocs = useStore((s) => s.loadDocs);
  const tests = useStore((s) => s.tests);
  const runTests = useStore((s) => s.runTests);
  const log = useStore((s) => s.pythonLog);
  const clearLog = useStore((s) => s.clearPythonLog);
  const openFile = useStore((s) => s.openPythonFile);
  const createFile = useStore((s) => s.createPythonFile);
  const renameFile = useStore((s) => s.renamePythonFile);
  const deleteFile = useStore((s) => s.deletePythonFile);
  const [side, setSide] = useState<Side>('request');
  const withTests = python ? hasTests(python.files) : false;
  const paths = useMemo(() => Object.keys(python?.files ?? {}), [python?.files]);

  // The documentation is read when its tab opens, and again when the code changed since.
  useEffect(() => {
    if (side === 'docs' && !docs.loading && (docs.stale || (!docs.spec && !docs.error))) void loadDocs();
  }, [side, docs.stale, docs.spec, docs.error, docs.loading, loadDocs]);
  // A project without tests has no tab for them (a file was renamed away from tests/).
  useEffect(() => {
    if (side === 'tests' && !withTests) setSide('request');
  }, [side, withTests]);

  if (!python) return null;
  const tabs = [
    { id: 'request', title: 'Запрос' },
    { id: 'docs', title: 'Документация' },
    ...(withTests ? [{ id: 'tests', title: 'Тесты' }] : []),
    { id: 'log', title: 'Лог' },
  ] as { id: Side; title: string }[];
  const tryRequest = (request: ApiRequest) => {
    setDraft(request);
    setSide('request');
  };
  const editor = (
    <Suspense fallback={null}>
      <CodeEditor language={languageOf(python.active)} path={python.tree ? python.active : undefined} ariaLabel={`Редактор ${python.active}`} value={python.files[python.active] ?? ''} onChange={setPythonSource} />
    </Suspense>
  );
  return (
    <div className="grid h-full min-h-0 grid-rows-[3fr_2fr] @3xl:grid-cols-[3fr_2fr] @3xl:grid-rows-1">
      <section aria-label={`Код приложения ${python.entry}`} className="flex min-h-0 flex-col border-b border-line @3xl:border-r @3xl:border-b-0">
        {python.tree ? (
          <div className="flex min-h-0 flex-1">
            <div className="w-44 shrink-0 border-r border-line">
              <FileTree paths={paths} entry={python.entry} active={python.active} onOpen={openFile} onCreate={createFile} onRename={renameFile} onDelete={deleteFile} />
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <EditorTabs />
              <div className="min-h-0 flex-1">{editor}</div>
              <div className="flex h-7 shrink-0 items-center border-t border-line px-3">
                <PythonStatusLine />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3">
              <span className="font-mono text-[12px] text-dim">{python.active}</span>
              <PythonStatusLine />
            </div>
            <div className="min-h-0 flex-1">{editor}</div>
          </>
        )}
      </section>
      <section aria-label="Запрос к приложению" className="flex min-h-0 flex-col">
        <div className="flex h-9 shrink-0 items-stretch border-b border-line px-3">
          <Tabs label="Работа с приложением" items={tabs} value={side} onChange={setSide} idPrefix="fastapi" />
        </div>
        <div id="fastapi-panel" role="tabpanel" aria-labelledby={`fastapi-tab-${side}`} className="min-h-0 flex-1 overflow-auto">
          {side === 'request' ? (
            <RequestComposer />
          ) : side === 'docs' ? (
            <OpenApiViewer spec={docs.spec} loading={docs.loading} error={docs.error} onReload={() => void loadDocs()} onTry={tryRequest} />
          ) : side === 'tests' ? (
            <TestsPanel running={tests.running} run={tests.run} error={tests.error} onRun={() => void runTests()} />
          ) : (
            <LogPanel lines={log} onClear={clearLog} />
          )}
        </div>
      </section>
    </div>
  );
}
