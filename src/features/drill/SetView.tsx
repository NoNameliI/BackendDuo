import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useHotkeys } from '@/app/hotkeys';
import type { Course, DrillConfig } from '@/content/loadCourse';
import { Button } from '@/ui/Button';
import { Markdown } from './StatementMarkdown';
import { Panel } from '@/ui/Panel';
import { useFocusHeading } from '@/ui/useFocusHeading';
import { AnswerField } from './AnswerField';
import { DataViewer } from './DataViewer';
import { buildSet, remainingSeconds, useDrill } from './drillStore';
import { exportsOf, renderInstance } from './instanceView';
import { mmss } from './Level';

/** Wall-clock time that ticks once a second. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function SetView({ course, cfg }: { course: Course; cfg: DrillConfig }) {
  const run = useDrill((s) => s.set);
  const { selectInSet, setAnswer, finishSet } = useDrill.getState();
  const now = useNow();
  const [confirming, setConfirming] = useState(false);
  const rootRef = useFocusHeading<HTMLDivElement>('set');
  const built = useMemo(() => (run ? buildSet(course, run.master, run.level) : []), [course, run?.master, run?.level]);
  const left = run ? remainingSeconds(run.startedAt, cfg.set.minutes, now) : 0;
  const finished = useRef(false);
  const finishBtn = useRef<HTMLSpanElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (wasConfirming.current && !confirming) finishBtn.current?.querySelector('button')?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const onDialogKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setConfirming(false);
    } else if (e.key === 'Tab') {
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !items.includes(active as HTMLElement))) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  useEffect(() => {
    if (run && left <= 0 && !finished.current) {
      finished.current = true;
      finishSet();
    }
  }, [run, left, finishSet]);

  const ns = built.map((b) => b.n);
  const step = (delta: number) => {
    if (!run) return;
    const next = ns[ns.indexOf(run.current) + delta];
    if (next !== undefined) selectInSet(next);
  };
  useHotkeys({ 'Alt+ArrowLeft': () => step(-1), 'Alt+ArrowRight': () => step(1) });

  const current = built.find((b) => b.n === run?.current);
  const view = useMemo(() => (current ? { rendered: renderInstance(current.task, current.instance), files: exportsOf(current.instance, current.task) } : null), [current]);
  if (!run) return null;
  const empty = ns.filter((n) => !(run.answers[n] ?? '').trim()).length;

  // The timer is read out only at a few thresholds, never every second.
  const announce = left <= 0 ? 'Время вышло' : left <= 60 ? 'Осталась минута' : left <= 300 ? 'Осталось меньше пяти минут' : '';

  return (
    <div ref={rootRef} className="flex h-full flex-col gap-1.5">
      <h1 className="sr-only">{cfg.labels.modes.full}</h1>
      <Panel
        title={cfg.labels.modes.full}
        actions={
          <>
            <span role="timer" aria-live="off" aria-label="Оставшееся время" className={`mr-2 font-mono text-[14px] tabular-nums ${left <= 300 ? 'text-amber' : 'text-dim'}`}>
              {mmss(left)}
            </span>
            <span role="status" className="sr-only">
              {announce}
            </span>
            <span ref={finishBtn} className="inline-flex">
              <Button variant="check" onClick={() => setConfirming(true)}>
                Завершить
              </Button>
            </span>
          </>
        }
      >
        <div className="flex h-full flex-col">
          <nav aria-label="Номера набора" className="flex shrink-0 flex-wrap gap-1.5 border-b border-line p-2.5">
            {ns.map((n) => {
              const answered = (run.answers[n] ?? '').trim() !== '';
              return (
                <button
                  key={n}
                  type="button"
                  aria-current={run.current === n ? 'step' : undefined}
                  aria-label={`${cfg.labels.number} ${n}${answered ? ', ответ дан' : ''}`}
                  onClick={() => selectInSet(n)}
                  className={`h-8 min-w-8 rounded border px-2 font-mono text-[12.5px] transition ${
                    run.current === n ? 'border-nav bg-nav/10 text-fg' : answered ? 'border-ok/50 text-ok hover:bg-raised' : 'border-line text-dim hover:bg-raised'
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {current && view && (
              <div className="mx-auto max-w-3xl space-y-4 p-5">
                <h2 className="font-mono text-[12px] uppercase tracking-[0.14em] text-faint">
                  {cfg.labels.number} {current.n}
                </h2>
                <Markdown source={view.rendered.statement} className="text-[15px]" />
                {view.files.length > 0 && <DataViewer key={current.n} files={view.files} captions={current.task.labels} />}
                <AnswerField key={current.n} value={run.answers[current.n] ?? ''} onChange={(text) => setAnswer(current.n, text)} />
                <div className="flex gap-2">
                  <Button variant="outline" disabled={ns.indexOf(current.n) <= 0} onClick={() => step(-1)} shortcut="Alt ←">
                    Назад
                  </Button>
                  <Button variant="outline" disabled={ns.indexOf(current.n) >= ns.length - 1} onClick={() => step(1)} shortcut="Alt →">
                    Дальше
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Panel>
      {confirming && (
        <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-label="Завершить набор" onKeyDown={onDialogKey} className="fixed inset-0 z-40 grid place-items-center bg-black/50" onMouseDown={() => setConfirming(false)}>
          <div className="w-[min(420px,92vw)] rounded-lg border border-line-strong bg-panel p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <p className="text-[15px] font-semibold">Завершить набор?</p>
            <p className="mt-1 text-[13.5px] text-dim">{empty > 0 ? `Без ответа: ${empty}. Вернуться к ним после завершения будет нельзя.` : 'Проверка выполнится сразу.'}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" autoFocus onClick={() => setConfirming(false)}>
                Продолжить решать
              </Button>
              <Button variant="check" onClick={finishSet}>
                Завершить
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
