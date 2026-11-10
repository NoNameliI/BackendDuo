import { useEffect, useMemo, useRef } from 'react';
import type { Course, DrillConfig } from '@/content/loadCourse';
import { seedHex } from '@/engine/drill/rng';
import type { Level } from '@/engine/drill/types';
import { Button } from '@/ui/Button';
import { Markdown } from './StatementMarkdown';
import { AnswerField } from './AnswerField';
import { DataViewer } from './DataViewer';
import { canShowSolution, taskFor, useDrill } from './drillStore';
import { Explanation } from './Explanation';
import { HintLadder } from './HintLadder';
import { exportsOf, renderInstance } from './instanceView';
import { LevelSwitch } from './Level';
import { ScratchPanel } from './ScratchPanel';

export function TaskView({ course, cfg }: { course: Course; cfg: DrillConfig }) {
  const p = useDrill((s) => s.practice);
  const { setInput, check, revealHint, revealSolution, newInstance, openNumber } = useDrill.getState();
  const task = p?.instance ? taskFor(course, p.n, p.level, p.instance.seed) : null;
  const rendered = useMemo(() => (p?.instance && task ? renderInstance(task, p.instance) : null), [p?.instance, task]);
  const files = useMemo(() => (p?.instance && task ? exportsOf(p.instance, task) : []), [p?.instance, task]);

  const explanationRef = useRef<HTMLParagraphElement>(null);
  const finishedNow = !!p && (p.solved || p.solutionShown);
  // The answer field gets disabled and "Show solution" unmounts: keep focus on the explanation.
  useEffect(() => {
    if (finishedNow) explanationRef.current?.focus();
  }, [finishedNow, p?.instance?.key]);

  if (!p) return null;
  if (p.error || !p.instance || !task || !rendered) {
    return (
      <div role="alert" className="p-5 text-[13.5px] text-err">
        {p.error ?? 'Не удалось подготовить задание.'}
      </div>
    );
  }

  const after = course.solutionAfterAttempts;
  const finished = p.solved || p.solutionShown;
  const verdict = p.solved
    ? { tone: 'ok' as const, text: 'Верно!' }
    : p.solutionShown
      ? { tone: 'info' as const, text: 'Решение показано. Попробуйте новый вариант.' }
      : p.missed
        ? { tone: 'err' as const, text: `Неверно. Неверных проверок: ${p.wrong}.` }
        : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <LevelSwitch cfg={cfg} value={p.level} onChange={(level: Level) => openNumber(p.n, { level })} />
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              title="Скопировать зерно варианта"
              aria-label={`Зерно варианта ${seedHex(p.instance.seed)}. Скопировать`}
              onClick={() => void navigator.clipboard?.writeText(seedHex(p.instance!.seed))}
              className="rounded border border-line px-2 py-0.5 font-mono text-[11.5px] text-dim hover:border-line-strong hover:text-fg"
            >
              #{seedHex(p.instance.seed)}
            </button>
            <Button variant="outline" onClick={newInstance}>
              Новый вариант
            </Button>
          </div>
        </div>

        <Markdown source={rendered.statement} className="text-[15px]" />
        {files.length > 0 && <DataViewer files={files} captions={task.labels} />}

        <AnswerField value={p.input} onChange={setInput} onCheck={check} disabled={finished} problem={p.problem} verdict={verdict} />

        <HintLadder hints={rendered.hints} shown={p.hints} onReveal={revealHint} disabled={finished} />

        {!finished && (
          <div>
            <Button variant="outline" disabled={!canShowSolution(p.wrong, after)} onClick={revealSolution}>
              Показать решение
            </Button>
            {!canShowSolution(p.wrong, after) && (
              <span className="ml-3 text-[12.5px] text-faint">
                Откроется после неверных проверок: {after ?? 1} (сейчас {p.wrong})
              </span>
            )}
          </div>
        )}

        {finished && <Explanation headingRef={explanationRef} text={rendered.explanation} answer={p.instance.answer} shown={p.solutionShown} />}

        <ScratchPanel key={p.instance.key} starter={rendered.starter} files={files} />
      </div>
    </div>
  );
}
