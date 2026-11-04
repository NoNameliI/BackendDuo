import { useEffect, useMemo, useState } from 'react';
import type { CheckResult } from '@/checker';
import { createGitChecker } from '@/checker/git';
import type { GitOnboarding } from '@/content/loadCourse';
import { useCourse } from '@/app/useCourse';
import { GitGraph } from '@/features/git/GitGraph';
import { createGitSandboxStore, SandboxContext } from '@/features/git/gitSandbox';
import { GitStatusView } from '@/features/git/GitStatusView';
import { GitTerminal } from '@/features/git/GitTerminal';
import { Button } from '@/ui/Button';
import { CheckIcon } from '@/ui/icons';
import { Markdown } from '@/ui/Markdown';
import { useFocusHeading } from '@/ui/useFocusHeading';

type Screen = { kind: 'intro' } | { kind: 'step'; index: number } | { kind: 'task' } | { kind: 'outro' };

/** First steps in Git for a beginner: what Git is, three quick questions, then a real first commit. */
export function GitBeginnerFlow({ data, onFinish }: { data: GitOnboarding; onFinish: () => void }) {
  const [screen, setScreen] = useState<Screen>({ kind: 'intro' });
  const rootRef = useFocusHeading<HTMLDivElement>(screen.kind === 'step' ? `step-${screen.index}` : screen.kind);
  const total = data.steps.length + 2;
  const position = screen.kind === 'intro' ? 0 : screen.kind === 'step' ? screen.index + 1 : screen.kind === 'task' ? total - 1 : total;

  const next = () =>
    setScreen(
      screen.kind === 'intro'
        ? { kind: 'step', index: 0 }
        : screen.kind === 'step' && screen.index + 1 < data.steps.length
          ? { kind: 'step', index: screen.index + 1 }
          : screen.kind === 'step'
            ? { kind: 'task' }
            : { kind: 'outro' },
    );

  return (
    <div ref={rootRef} className="space-y-6">
      <ol aria-label="Шаги" className="flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <li key={i} className={`h-1 flex-1 rounded-full ${i < position ? 'bg-ok' : i === position ? 'bg-amber' : 'bg-line'}`} />
        ))}
      </ol>

      {screen.kind === 'intro' && (
        <section className="animate-rise space-y-4">
          <h1 className="text-[26px] font-semibold tracking-tight">{data.intro.title}</h1>
          {data.intro.paragraphs.map((p, i) => (
            <Markdown key={i} source={p} className="text-[15px] text-dim" />
          ))}
          <Button variant="check" onClick={next}>
            Начать →
          </Button>
        </section>
      )}

      {screen.kind === 'step' && <ConceptStep key={screen.index} step={data.steps[screen.index]} onNext={next} />}
      {screen.kind === 'task' && <FirstTask data={data} onDone={next} />}

      {screen.kind === 'outro' && (
        <section className="animate-rise space-y-4">
          <h1 className="text-[26px] font-semibold tracking-tight">{data.outro.title}</h1>
          <Markdown source={data.outro.text} className="text-[15px] text-dim" />
          <Button variant="check" onClick={onFinish}>
            К карте курса →
          </Button>
        </section>
      )}
    </div>
  );
}

function ConceptStep({ step, onNext }: { step: GitOnboarding['steps'][number]; onNext: () => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const right = picked === step.answer;
  return (
    <section className="animate-rise space-y-4">
      <h1 className="text-[22px] font-semibold tracking-tight">{step.title}</h1>
      <Markdown source={step.text} className="text-[15px] text-dim" />
      <div role="radiogroup" aria-label="Варианты ответа" className="grid gap-2">
        {step.options.map((option, i) => {
          const chosen = picked === i;
          const tone = chosen ? (right ? 'border-ok bg-ok/10' : 'border-err bg-err/10') : 'border-line bg-panel hover:border-line-strong';
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={chosen}
              disabled={right}
              onClick={() => setPicked(i)}
              className={`rounded-md border px-4 py-3 text-left text-[14px] transition ${tone}`}
            >
              <Markdown source={option} className="inline" />
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div role="status" className={`rounded-md border p-3 text-[14px] ${right ? 'border-ok/40 bg-ok/5' : 'border-err/40 bg-err/5'}`}>
          <p className={`mb-1 font-semibold ${right ? 'text-ok' : 'text-err'}`}>{right ? 'Верно' : 'Не совсем — попробуйте другой вариант'}</p>
          {right && <Markdown source={step.explanation} className="text-dim" />}
        </div>
      )}
      {right && (
        <Button variant="check" onClick={onNext}>
          Дальше →
        </Button>
      )}
    </section>
  );
}

function FirstTask({ data, onDone }: { data: GitOnboarding; onDone: () => void }) {
  const course = useCourse();
  const task = data.firstTask;
  const store = useMemo(() => createGitSandboxStore(), []);
  const checker = useMemo(() => createGitChecker(), []);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [view, setView] = useState<'graph' | 'status'>('status');

  useEffect(() => {
    const state = store.getState();
    state.setHints(course.terminalHints);
    state.reset(task.shellSetup);
  }, [store, task, course]);

  const check = () => {
    const { engine, commands } = store.getState();
    setResult(checker.check(task, engine.world, commands));
  };

  return (
    <section className="animate-rise space-y-4">
      <h1 className="text-[22px] font-semibold tracking-tight">{task.title}</h1>
      <Markdown source={task.prompt} className="text-[15px] text-dim" />
      <SandboxContext.Provider value={store}>
        <div className="grid h-[340px] gap-2 md:grid-cols-[3fr_2fr]">
          <div className="overflow-hidden rounded-md border border-line">
            <GitTerminal />
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-line bg-panel">
            <div role="tablist" aria-label="Состояние репозитория" className="flex gap-4 border-b border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em]">
              {(['status', 'graph'] as const).map((v) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={view === v ? 'text-fg' : 'text-faint'}>
                  {v === 'status' ? 'Статус' : 'Граф'}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">{view === 'status' ? <GitStatusView /> : <GitGraph />}</div>
          </div>
        </div>
      </SandboxContext.Provider>
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
            'Получилось: это ваш первый коммит.'
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
