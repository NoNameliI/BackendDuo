import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { pythonClient, type PythonStatus } from '@/engine/python/pythonClient';
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

/** FastAPI tasks: main.py on the left, requests to the running app on the right. */
export function FastapiPanel() {
  const useStore = useApiSandbox();
  const python = useStore((s) => s.python);
  const setPythonSource = useStore((s) => s.setPythonSource);
  if (!python) return null;
  return (
    <div className="grid h-full min-h-0 grid-rows-[3fr_2fr] @3xl:grid-cols-[3fr_2fr] @3xl:grid-rows-1">
      <section aria-label="Код приложения main.py" className="flex min-h-0 flex-col border-b border-line @3xl:border-r @3xl:border-b-0">
        <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3">
          <span className="font-mono text-[12px] text-dim">main.py</span>
          <PythonStatusLine />
        </div>
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <CodeEditor language="python" ariaLabel="Редактор main.py" value={python.source} onChange={setPythonSource} />
          </Suspense>
        </div>
      </section>
      <section aria-label="Запрос к приложению" className="min-h-0 overflow-auto">
        <RequestComposer />
      </section>
    </div>
  );
}
