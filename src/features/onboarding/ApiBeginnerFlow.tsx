import { useEffect, useMemo, useState } from 'react';
import type { CheckResult } from '@/checker';
import { pythonGroups } from '@/checker/fastapi';
import { checkApiTask, freshServer } from '@/checker/api';
import type { ApiOnboarding, PythonTask } from '@/content/loadCourse';
import { pythonClient } from '@/engine/python/pythonClient';
import { FastapiPanel } from '@/features/api/FastapiPanel';
import { useCourse } from '@/app/useCourse';
import { ApiSandboxContext, createApiSandboxStore } from '@/features/api/apiStore';
import { RequestComposer } from '@/features/api/RequestComposer';
import { ResponseView } from '@/features/api/ResponseView';
import { Button } from '@/ui/Button';
import { CheckIcon } from '@/ui/icons';
import { Markdown } from '@/ui/Markdown';
import { ConceptFlow } from './GitBeginnerFlow';

/** First steps in APIs for a beginner: what an API is, a few quick questions, then a first real request. */
export function ApiBeginnerFlow({ data, onFinish }: { data: ApiOnboarding; onFinish: () => void }) {
  return <ConceptFlow data={data} onFinish={onFinish} task={(done) => <FirstRequest data={data} onDone={done} />} />;
}

function FirstRequest({ data, onDone }: { data: ApiOnboarding; onDone: () => void }) {
  const task = data.firstTask;
  return 'project' in task ? <FirstRoute task={task as PythonTask} onDone={onDone} /> : <FirstCall data={data} onDone={onDone} />;
}

/** The first practical step in Python: complete a tiny route, send a request to it, check. */
function FirstRoute({ task, onDone }: { task: PythonTask; onDone: () => void }) {
  const store = useMemo(() => createApiSandboxStore(), []);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState('');

  useEffect(() => {
    store.getState().reset(task.httpStarter, { server: null, python: { files: task.project.starter, entry: task.project.entry, tree: false, groups: pythonGroups(task), readonly: task.readonly } });
  }, [store, task]);

  const check = async () => {
    if (checking) return;
    setChecking(true);
    setResult(null);
    try {
      const { checkPythonTask } = await import('@/checker/fastapiCourse');
      const python = store.getState().python;
      setResult(await checkPythonTask(task, { files: python?.files ?? {}, entry: python?.entry }, pythonClient(), setProgress));
    } catch (e) {
      setResult({ passed: false, problems: [e instanceof Error ? e.message : String(e)] });
    } finally {
      setChecking(false);
      setProgress('');
    }
  };

  return (
    <section className="animate-rise space-y-4">
      <h1 className="text-[22px] font-semibold tracking-tight">{task.title}</h1>
      <Markdown source={task.prompt} className="text-[15px] text-dim" />
      <ApiSandboxContext.Provider value={store}>
        <div className="@container h-[440px] overflow-hidden rounded-md border border-line bg-panel">
          <FastapiPanel />
        </div>
      </ApiSandboxContext.Provider>
      <details className="text-[14px] text-dim">
        <summary className="cursor-pointer text-nav">Подсказки</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          {task.hints.map((h, i) => (
            <li key={i}>
              <Markdown source={h} className="inline" />
            </li>
          ))}
        </ol>
      </details>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="check" icon={<CheckIcon />} disabled={checking} onClick={() => void check()}>
          {checking ? 'Проверяю…' : 'Проверить'}
        </Button>
        {result?.passed && (
          <Button variant="run" onClick={onDone}>
            Дальше →
          </Button>
        )}
        <span role="status" aria-live="polite" className="text-[13px] text-amber">
          {checking ? progress : ''}
        </span>
      </div>
      {result && (
        <div role="status" className={`rounded-md border p-3 text-[14px] ${result.passed ? 'border-ok/40 bg-ok/5 text-ok' : 'border-err/40 bg-err/5'}`}>
          {result.passed ? (
            'Получилось: приложение на FastAPI отвечает так, как нужно.'
          ) : (
            <ul className="space-y-1">
              {result.problems.map((p, i) => (
                <li key={i}>• {p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function FirstCall({ data, onDone }: { data: ApiOnboarding; onDone: () => void }) {
  const course = useCourse();
  const task = data.firstTask as Extract<ApiOnboarding['firstTask'], { type: 'request' | 'response' }>;
  const store = useMemo(() => createApiSandboxStore(), []);
  const [result, setResult] = useState<CheckResult | null>(null);

  useEffect(() => {
    store.getState().reset(task.httpStarter, { server: task.server ? freshServer(task, course.servers) : null });
  }, [store, task, course]);

  const check = () => setResult(checkApiTask(task, course.servers, { draft: store.getState().draft, cors: null }));

  return (
    <section className="animate-rise space-y-4">
      <h1 className="text-[22px] font-semibold tracking-tight">{task.title}</h1>
      <Markdown source={task.prompt} className="text-[15px] text-dim" />
      <ApiSandboxContext.Provider value={store}>
        <div className="grid gap-2 md:grid-cols-2">
          <div className="@container h-[320px] overflow-auto rounded-md border border-line bg-panel">
            <RequestComposer />
          </div>
          <div className="h-[320px] overflow-hidden rounded-md border border-line bg-panel">
            <ResponseView />
          </div>
        </div>
      </ApiSandboxContext.Provider>
      <details className="text-[14px] text-dim">
        <summary className="cursor-pointer text-nav">Подсказки</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          {task.hints.map((h, i) => (
            <li key={i}>
              <Markdown source={h} className="inline" />
            </li>
          ))}
        </ol>
      </details>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="check" icon={<CheckIcon />} onClick={check}>
          Проверить
        </Button>
        {result?.passed && (
          <Button variant="run" onClick={onDone}>
            Дальше →
          </Button>
        )}
      </div>
      {result && (
        <div role="status" className={`rounded-md border p-3 text-[14px] ${result.passed ? 'border-ok/40 bg-ok/5 text-ok' : 'border-err/40 bg-err/5'}`}>
          {result.passed ? (
            'Получилось: это ваш первый запрос к API.'
          ) : (
            <ul className="space-y-1">
              {result.problems.map((p, i) => (
                <li key={i}>• {p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
