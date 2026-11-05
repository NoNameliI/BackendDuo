import { useEffect, useMemo, useState } from 'react';
import type { CheckResult } from '@/checker';
import { checkApiTask, freshServer } from '@/checker/api';
import type { ApiOnboarding } from '@/content/loadCourse';
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
  const course = useCourse();
  const task = data.firstTask;
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
