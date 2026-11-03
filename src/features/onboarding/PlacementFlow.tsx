import { lazy, Suspense, useEffect, useState } from 'react';
import { useHotkeys, type HotkeyMap } from '@/app/hotkeys';
import { checkChoice, type CheckResult } from '@/checker';
import { course } from '@/content/course';
import { errorHint, type Placement, type Task } from '@/content/loadCourse';
import { SchemaView } from '@/features/lesson/SchemaView';
import { useWorkspace } from '@/features/lesson/workspace';
import { Button } from '@/ui/Button';
import { CheckIcon } from '@/ui/icons';
import { Markdown } from '@/ui/Markdown';
import { OptionList } from '@/ui/OptionList';
import { placementStep } from './placement';
import { useLatestState } from './useLatest';

const SqlEditor = lazy(() => import('@/features/lesson/SqlEditor'));

interface PlacementFlowProps {
  placement: Placement;
  onFinish: (unlocks: string[]) => void;
}

export function PlacementFlow({ placement, onFinish }: PlacementFlowProps) {
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const step = placementStep(placement, answers);

  if (!started) {
    return (
      <section className="animate-rise space-y-4">
        <h1 className="text-[26px] font-semibold tracking-tight">{placement.title}</h1>
        <Markdown source={placement.intro} className="text-[15px] text-dim" />
        <ol className="grid gap-2 sm:grid-cols-2">
          {placement.blocks.map((b, i) => (
            <li key={b.id} className="rounded-md border border-line bg-panel px-3 py-2.5 text-[14px]">
              <span className="mr-2 font-mono text-[12px] text-faint">{i + 1}</span>
              {b.title}
            </li>
          ))}
        </ol>
        <Button variant="check" onClick={() => setStarted(true)}>
          Начать тест →
        </Button>
      </section>
    );
  }

  const blockState = (index: number, id: string) =>
    step.kind === 'done'
      ? step.passedBlocks.includes(id)
        ? 'passed'
        : step.failedBlock === id
          ? 'failed'
          : 'skipped'
      : index < step.blockIndex
        ? 'passed'
        : index === step.blockIndex
          ? 'current'
          : 'pending';

  const tones = { passed: 'bg-ok', failed: 'bg-err', current: 'bg-amber', pending: 'bg-line', skipped: 'bg-line' };

  return (
    <div className="space-y-6">
      <ol aria-label="Блоки теста" className="grid grid-cols-4 gap-2">
        {placement.blocks.map((b, i) => {
          const state = blockState(i, b.id);
          return (
            <li key={b.id}>
              <span className={`block h-1 rounded-full ${tones[state]}`} />
              <span className={`mt-1.5 block text-[12px] ${state === 'current' ? 'text-fg' : 'text-faint'}`}>{b.title}</span>
            </li>
          );
        })}
      </ol>

      {step.kind === 'question' ? (
        <Question
          key={step.question.id}
          task={step.question}
          label={`Вопрос ${step.number}`}
          onAnswer={(passed) => setAnswers((a) => ({ ...a, [step.question.id]: passed }))}
        />
      ) : (
        <section className="animate-pop space-y-4 rounded-md border border-line bg-panel p-6">
          <h1 className="text-[24px] font-semibold tracking-tight">
            {step.failedBlock === null ? 'Все блоки зачтены' : `Зачтено блоков: ${step.passedBlocks.length} из ${placement.blocks.length}`}
          </h1>
          <ul className="space-y-1.5 text-[14px]">
            {placement.blocks.map((b, i) => {
              const state = blockState(i, b.id);
              return (
                <li key={b.id} className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${tones[state]}`} />
                  <span className={state === 'passed' ? 'text-fg' : 'text-dim'}>{b.title}</span>
                  <span className="ml-auto font-mono text-[12px] text-faint">
                    {state === 'passed' ? 'зачтено' : state === 'failed' ? 'начнём отсюда' : 'впереди'}
                  </span>
                </li>
              );
            })}
          </ul>
          <Button variant="check" onClick={() => onFinish(step.unlocks)}>
            К карте навыков →
          </Button>
        </section>
      )}
    </div>
  );
}

function Question({ task, label, onAnswer }: { task: Task; label: string; onAnswer: (passed: boolean) => void }) {
  const { prepare, verify, schema } = useWorkspace();
  const [selected, setSelected, latestSelected] = useLatestState<number[]>([]);
  const [code, setCode, latestCode] = useLatestState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const isChoice = task.type === 'choice' || task.type === 'review';

  useEffect(() => {
    if (!isChoice) void prepare(task);
  }, [isChoice, prepare, task]);

  const submit = async () => {
    if (result) return;
    if (task.type === 'choice' || task.type === 'review') {
      if (latestSelected().length > 0) setResult(checkChoice(task, latestSelected()));
    } else if (latestCode().trim()) {
      setResult(await verify(task, { kind: 'sql', code: latestCode() }));
    }
  };

  const toggle = (i: number) => {
    if (result || !(task.type === 'choice' || task.type === 'review')) return;
    const s = latestSelected();
    setSelected(task.answer.length > 1 ? (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]) : [i]);
  };

  const optionKeys: HotkeyMap =
    task.type === 'choice' || task.type === 'review' ? Object.fromEntries(task.options.map((_, i) => [`${i + 1}`, () => toggle(i)])) : {};
  useHotkeys({ 'Ctrl+Shift+Enter': () => void submit(), 'Ctrl+Enter': () => void submit(), ...optionKeys });

  const hint = result?.error ? errorHint(course, result.error.code) : undefined;

  return (
    <section className="animate-rise space-y-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-amber">
        {label} · {isChoice ? 'теория' : 'запрос'}
      </p>
      <Markdown source={task.prompt} className="text-[16px]" />

      {(task.type === 'choice' || task.type === 'review') && (
        <OptionList
          options={task.options}
          selected={selected}
          multiple={task.answer.length > 1}
          onToggle={toggle}
          verdict={result ? { passed: result.passed, answer: task.answer } : null}
        />
      )}

      {!isChoice && (
        <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
          <div className="h-44 overflow-hidden rounded-md border border-line">
            <Suspense fallback={<div className="h-full bg-well" />}>
              <SqlEditor value={code} onChange={setCode} error={result?.error ?? null} />
            </Suspense>
          </div>
          <div className="h-44 overflow-hidden rounded-md border border-line bg-panel">
            <SchemaView schema={schema} />
          </div>
        </div>
      )}

      {result && (
        <div
          role={result.passed ? 'status' : 'alert'}
          className={`animate-pop rounded-md border p-3 text-[14px] ${result.passed ? 'border-ok/40 bg-ok/10' : 'border-err/40 bg-err/10'}`}
        >
          <p className={`flex items-center gap-2 font-semibold ${result.passed ? 'text-ok' : 'text-err'}`}>
            {result.passed ? <><CheckIcon /> Верно</> : 'Неверно'}
          </p>
          {result.error && <p className="mt-1 font-mono text-[12px]">{result.error.message}</p>}
          {hint && <p className="mt-1 text-dim">{hint}</p>}
          {result.problems.slice(0, 3).map((p, i) => (
            <p key={i} className="mt-1">{p}</p>
          ))}
          {'explanation' in task && <Markdown source={task.explanation} className="mt-2 text-[13px]" />}
        </div>
      )}

      <div className="flex gap-2">
        {result ? (
          <Button variant="check" onClick={() => onAnswer(result.passed)} autoFocus>
            Дальше →
          </Button>
        ) : (
          <>
            <Button variant="check" icon={<CheckIcon />} shortcut="Ctrl ⇧ ↵" onClick={() => void submit()}>
              Ответить
            </Button>
            <Button variant="outline" onClick={() => onAnswer(false)}>
              Не знаю
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
