import { lazy, Suspense, useEffect, useState, type DragEvent } from 'react';
import { useHotkeys } from '@/app/hotkeys';
import type { CheckResult } from '@/checker';
import { errorHint, type Onboarding } from '@/content/loadCourse';
import type { OnboardingStep } from '@/content/schema';
import { course } from '@/content/course';
import { ResultTable } from '@/features/lesson/ResultTable';
import { useWorkspace } from '@/features/lesson/workspace';
import { Button } from '@/ui/Button';
import { CheckIcon, PlayIcon } from '@/ui/icons';
import { Markdown } from '@/ui/Markdown';
import { useFocusHeading } from '@/ui/useFocusHeading';
import { useLatestState } from './useLatest';
import { VisualTable } from './VisualTable';

const SqlEditor = lazy(() => import('@/features/lesson/SqlEditor'));

type Screen = { kind: 'intro' } | { kind: 'step'; index: number } | { kind: 'query' } | { kind: 'outro' };

export function BeginnerFlow({ data, onFinish }: { data: Onboarding; onFinish: () => void }) {
  const [screen, setScreen] = useState<Screen>({ kind: 'intro' });
  const rootRef = useFocusHeading<HTMLDivElement>(screen.kind === 'step' ? `step-${screen.index}` : screen.kind);
  const total = data.steps.length + 2;
  const position = screen.kind === 'intro' ? 0 : screen.kind === 'step' ? screen.index + 1 : screen.kind === 'query' ? total - 1 : total;

  const next = () =>
    setScreen(
      screen.kind === 'intro'
        ? { kind: 'step', index: 0 }
        : screen.kind === 'step' && screen.index + 1 < data.steps.length
          ? { kind: 'step', index: screen.index + 1 }
          : screen.kind === 'step'
            ? { kind: 'query' }
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

      {screen.kind === 'step' && <StepView key={screen.index} step={data.steps[screen.index]} data={data} onNext={next} />}
      {screen.kind === 'query' && <FirstQuery data={data} onDone={next} />}

      {screen.kind === 'outro' && (
        <section className="animate-pop space-y-4 rounded-md border border-ok/40 bg-ok/10 p-6">
          <h1 className="flex items-center gap-2 text-[24px] font-semibold text-ok">
            <CheckIcon width={22} height={22} /> {data.outro.title}
          </h1>
          <Markdown source={data.outro.text} className="text-[15px]" />
          <Button variant="check" onClick={onFinish}>
            К карте навыков →
          </Button>
        </section>
      )}
    </div>
  );
}

function StepView({ step, data, onNext }: { step: OnboardingStep; data: Onboarding; onNext: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <section className="animate-rise space-y-4">
      <h1 className="text-[22px] font-semibold tracking-tight">{step.title}</h1>
      <Markdown source={step.text} className="text-[15px]" />
      {step.kind === 'link' ? <LinkStep step={step} data={data} onDone={() => setDone(true)} /> : <PickStep step={step} data={data} onDone={() => setDone(true)} />}
      {done && (
        <div className="animate-pop rounded-md border border-ok/40 bg-ok/10 p-4">
          <Markdown source={step.explanation} className="text-[14px]" />
          <Button variant="check" className="mt-3" onClick={onNext} autoFocus>
            Дальше →
          </Button>
        </div>
      )}
    </section>
  );
}

function PickStep({ step, data, onDone }: { step: Exclude<OnboardingStep, { kind: 'link' }>; data: Onboarding; onDone: () => void }) {
  const table = data.tables[step.table];
  const [marked, setMarked] = useState<{ row?: number; column?: string; tone: 'ok' | 'err' } | undefined>();
  const [solved, setSolved] = useState(false);

  const pickRow = (row: number) => {
    if (solved || step.kind !== 'pickRow') return;
    const ok = row === step.answer;
    setMarked({ row, tone: ok ? 'ok' : 'err' });
    if (ok) {
      setSolved(true);
      onDone();
    }
  };
  const pickColumn = (column: string) => {
    if (solved || step.kind !== 'pickColumn') return;
    const ok = column === step.answer;
    setMarked({ column, tone: ok ? 'ok' : 'err' });
    if (ok) {
      setSolved(true);
      onDone();
    }
  };

  return (
    <div className="space-y-2">
      <VisualTable
        name={step.table}
        columns={table.columns}
        rows={table.rows}
        pick={solved ? undefined : step.kind === 'pickRow' ? 'row' : 'column'}
        onPickRow={pickRow}
        onPickColumn={pickColumn}
        marked={marked}
      />
      {marked?.tone === 'err' && <p role="alert" className="text-[13px] text-err">Не совсем. Попробуйте ещё раз.</p>}
    </div>
  );
}

function LinkStep({ step, data, onDone }: { step: Extract<OnboardingStep, { kind: 'link' }>; data: Onboarding; onDone: () => void }) {
  const customers = data.tables.customers;
  const orders = data.tables.orders;
  const [links, setLinks] = useState<Record<number, number>>({});
  const [held, setHeld] = useState<number | null>(null);
  const [miss, setMiss] = useState<number | null>(null);
  const linkColumn = orders.columns.indexOf('customer_id');

  const assign = (orderId: number, customerRow: number) => {
    const order = step.orders.find((o) => o.id === orderId);
    const customerId = Number(customers.rows[customerRow][0]);
    if (!order || links[orderId] !== undefined) return;
    if (order.customer !== customerId) {
      setMiss(orderId);
      return;
    }
    const next = { ...links, [orderId]: customerId };
    setLinks(next);
    setHeld(null);
    setMiss(null);
    if (step.orders.every((o) => next[o.id] !== undefined)) onDone();
  };

  const onDrop = (row: number, e: DragEvent) => {
    e.currentTarget.classList.remove('drag-over');
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id) assign(id, row);
  };

  const orderRows = orders.rows.map((r) => r.map((cell, j) => (j === linkColumn ? (links[Number(r[0])] ?? null) : cell)));
  const fresh = new Set(Object.keys(links).map((id) => `${orders.rows.findIndex((r) => Number(r[0]) === Number(id))}:customer_id`));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <ul className="space-y-2" aria-label="Заказы без покупателя">
          {step.orders.map((o) => {
            const row = orders.rows.find((r) => Number(r[0]) === o.id)!;
            const linked = links[o.id] !== undefined;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  draggable={!linked}
                  disabled={linked}
                  aria-pressed={held === o.id}
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', String(o.id))}
                  onClick={() => setHeld(held === o.id ? null : o.id)}
                  className={`w-full rounded-md border px-3 py-2.5 text-left transition ${
                    linked
                      ? 'border-ok/40 bg-ok/5 opacity-60'
                      : held === o.id
                        ? 'border-amber bg-amber/10'
                        : miss === o.id
                          ? 'animate-shake border-err bg-err/10'
                          : 'cursor-grab border-line bg-panel hover:border-line-strong'
                  }`}
                >
                  <span className="flex items-baseline gap-2 font-mono text-[12px] text-faint">
                    заказ {o.id} · {row[1]} · {row[2]} ₽{linked && <CheckIcon className="ml-auto text-ok" />}
                  </span>
                  <span className="mt-0.5 block text-[14px]">{o.story}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <VisualTable
          name="customers"
          columns={customers.columns}
          rows={customers.rows}
          onDropRow={onDrop}
          rowAction={held !== null ? { label: () => `← заказ ${held}`, onAction: (i) => assign(held, i) } : undefined}
        />
      </div>
      {miss !== null && <p role="alert" className="text-[13px] text-err">Это заказ другого покупателя — перечитайте историю.</p>}
      <VisualTable name="orders" columns={orders.columns} rows={orderRows} fresh={fresh} />
    </div>
  );
}

function FirstQuery({ data, onDone }: { data: Onboarding; onDone: () => void }) {
  const task = data.firstQuery;
  const { prepare, verify } = useWorkspace();
  const [code, setCode, latestCode] = useLatestState('');
  const [result, setResult] = useState<CheckResult | null>(null);

  useEffect(() => {
    void prepare(task);
  }, [prepare, task]);

  const run = async () => {
    const sql = latestCode();
    if (!sql.trim()) return;
    setResult(await verify(task, { kind: 'sql', code: sql }));
  };
  useHotkeys({ 'Ctrl+Enter': () => void run() });

  const hint = result?.error ? errorHint(course, result.error.code) : undefined;

  return (
    <section className="animate-rise space-y-4">
      <h1 className="text-[22px] font-semibold tracking-tight">{task.title}</h1>
      <Markdown source={task.prompt} className="text-[15px]" />
      <div className="overflow-hidden rounded-md border border-line">
        <div className="flex items-center justify-between border-b border-line bg-panel px-3 py-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-dim">SQL</span>
          <Button variant="run" icon={<PlayIcon />} shortcut="Ctrl ↵" onClick={() => void run()}>
            Выполнить
          </Button>
        </div>
        <div className="h-28">
          <Suspense fallback={<div className="h-full bg-well" />}>
            <SqlEditor value={code} onChange={setCode} error={result?.error ?? null} />
          </Suspense>
        </div>
      </div>
      {result && !result.passed && (
        <div role="alert" className="rounded-md border border-err/40 bg-err/10 p-3 text-[13px]">
          {result.error && <p className="font-mono text-[12px]">{result.error.message}</p>}
          {hint && <p className="mt-1 text-dim">{hint}</p>}
          {result.problems.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
      {result?.passed && result.actual && (
        <div className="animate-pop space-y-3">
          <div className="h-56 overflow-hidden rounded-md border border-ok/40">
            <ResultTable result={result.actual} />
          </div>
          <Button variant="check" onClick={onDone} autoFocus>
            Дальше →
          </Button>
        </div>
      )}
    </section>
  );
}
