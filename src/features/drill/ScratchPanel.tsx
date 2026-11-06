import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { PythonStatusLine } from '@/features/api/FastapiPanel';
import { pythonClient } from '@/engine/python/pythonClient';
import type { ScriptRun } from '@/engine/python/runtime';
import { Button } from '@/ui/Button';
import { PlayIcon } from '@/ui/icons';
import type { ExportFile } from './instanceView';

const CodeEditor = lazy(() => import('@/features/api/CodeEditor'));

type Outcome = ScriptRun | { output: string; failure: string };

/** Collapsed Python scratch pad: the data files of the task are there under their saved names. Mount with key = instance. */
export function ScratchPanel({ starter, files }: { starter: string; files: ExportFile[] }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState(starter);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Outcome | null>(null);
  const latest = useRef({ source, files });
  latest.current = { source, files };

  useEffect(() => {
    if (open) pythonClient().prewarm();
  }, [open]);

  const execute = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { source: code, files: list } = latest.current;
      setRun(await pythonClient().script(code, Object.fromEntries(list.map((f) => [f.name, f.text]))));
    } catch (e) {
      setRun({ output: '', failure: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const error = run && 'error' in run ? run.error : undefined;
  const failure = run && 'failure' in run ? run.failure : undefined;

  return (
    <section aria-label="Черновик на Python" className="rounded-md border border-line bg-panel">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="scratch-body"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-dim hover:text-fg"
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span> Черновик на Python
        </button>
      </h3>
      {open && (
        <div id="scratch-body" className="border-t border-line">
          <div className="flex items-center gap-3 px-3 py-2">
            <Button variant="run" icon={<PlayIcon />} shortcut="Ctrl ↵" disabled={busy} onClick={() => void execute()}>
              {busy ? 'Выполняю…' : 'Выполнить'}
            </Button>
            <PythonStatusLine />
            {files.length > 0 && <span className="truncate font-mono text-[11.5px] text-faint">файлы: {files.map((f) => f.name).join(', ')}</span>}
          </div>
          <div className="h-56 border-y border-line">
            <Suspense fallback={null}>
              <CodeEditor language="python" ariaLabel="Черновик на Python" value={source} onChange={setSource} onRun={() => void execute()} />
            </Suspense>
          </div>
          <div aria-live="polite" className="px-3 py-2 font-mono text-[12.5px]">
            {run && (
              <>
                {run.output && <pre className="whitespace-pre-wrap text-fg">{run.output}</pre>}
                {error && (
                  <p className="font-sans text-err">
                    {error.type}: {error.message}
                    {error.line ? ` (строка ${error.line})` : ''}
                  </p>
                )}
                {failure && <p className="font-sans text-err">{failure}</p>}
                {!run.output && !error && !failure && <p className="text-faint">Ничего не выведено</p>}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
