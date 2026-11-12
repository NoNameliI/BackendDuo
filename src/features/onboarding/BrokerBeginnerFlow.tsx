import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { CheckResult } from '@/checker';
import type { BrokerOnboarding } from '@/content/loadCourse';
import { useCourse } from '@/app/useCourse';
import { BrokerContext, createBrokerStore, loadBrokerLib } from '@/features/broker/brokerStore';
import { Button } from '@/ui/Button';
import { CheckIcon } from '@/ui/icons';
import { Markdown } from '@/ui/Markdown';
import { ConceptFlow } from './GitBeginnerFlow';

const BrokerWorkbench = lazy(() => import('@/features/broker/BrokerWorkbench'));

/** First steps with message brokers: concept cards, then a first publication in the lab. */
export function BrokerBeginnerFlow({ data, onFinish }: { data: BrokerOnboarding; onFinish: () => void }) {
  return <ConceptFlow data={data} onFinish={onFinish} task={(done) => <FirstPublish data={data} onDone={done} />} />;
}

function FirstPublish({ data, onDone }: { data: BrokerOnboarding; onDone: () => void }) {
  const course = useCourse();
  const task = data.firstTask;
  const store = useMemo(() => createBrokerStore(), []);
  const [result, setResult] = useState<CheckResult | null>(null);

  useEffect(() => {
    void store.getState().reset({ sim: task.sim, setup: task.brokerSetup, scenario: null, props: task.propsStarter, starter: task.brokerStarter });
  }, [store, task]);

  const check = async () => {
    const { checkBrokerTask } = await loadBrokerLib();
    try {
      setResult(checkBrokerTask(task, course.scenarios, store.getState().input()));
    } catch (e) {
      setResult({ passed: false, problems: [e instanceof Error ? e.message : String(e)] });
    }
  };

  return (
    <section className="animate-rise space-y-4">
      <h1 className="text-[22px] font-semibold tracking-tight">{task.title}</h1>
      <Markdown source={task.prompt} className="text-[15px] text-dim" />
      <BrokerContext.Provider value={store}>
        <div className="h-[440px]">
          <Suspense fallback={<div className="h-full rounded-md border border-line bg-well" />}>
            <BrokerWorkbench prefix="broker-onboarding" />
          </Suspense>
        </div>
      </BrokerContext.Provider>
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
        <Button variant="check" icon={<CheckIcon />} onClick={() => void check()}>
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
            'Получилось: это ваша первая публикация сообщения.'
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
