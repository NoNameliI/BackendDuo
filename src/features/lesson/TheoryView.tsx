import { useMemo, useState } from 'react';
import { courseById } from '@/content/courses';
import { errorHint, type Lesson } from '@/content/loadCourse';
import { splitTheory } from '@/content/theory';
import type { ExecOutcome } from '@/engine';
import { Button } from '@/ui/Button';
import { PlayIcon } from '@/ui/icons';
import { Markdown } from '@/ui/Markdown';
import { highlightSql } from '@/ui/highlightSql';
import { resetExamples, runExample } from './examples';
import { resetShellExamples, runShellExample, type ShellRun } from './shellExamples';
import { summarizeStatement } from './format';
import { ResultTable } from './ResultTable';

export function TheoryView({ lesson }: { lesson: Lesson }) {
  const segments = useMemo(() => splitTheory(lesson.theory), [lesson.theory]);
  const runnable = segments.some((s) => s.kind === 'example');
  const shell = segments.some((s) => s.kind === 'example' && s.lang === 'sh');

  return (
    <div className="space-y-4">
      {runnable && (
        <p className="rounded border border-line bg-well px-3 py-2 text-[12.5px] leading-relaxed text-dim">
          {shell
            ? 'Примеры с кнопкой «Выполнить» работают в отдельной учебной песочнице Git и не трогают задание. Запускайте их по порядку — каждый продолжает предыдущий.'
            : 'Примеры с кнопкой «Выполнить» работают в отдельной учебной базе и не трогают задание. Запускайте их по порядку и меняйте прямо в тексте задания — так быстрее всего понять синтаксис.'}{' '}
          <button
            type="button"
            className="text-nav underline underline-offset-2"
            onClick={() => (shell ? resetShellExamples(lesson) : void resetExamples(lesson))}
          >
            {shell ? 'Начать примеры заново' : 'Вернуть базу примеров в исходное состояние'}
          </button>
        </p>
      )}
      {segments.map((segment, i) =>
        segment.kind === 'markdown' ? (
          <Markdown key={i} source={segment.text} />
        ) : (
          segment.lang === 'sh' ? (
            <ShellExample key={`${lesson.id}-${i}`} lesson={lesson} script={segment.code} />
          ) : (
            <RunnableExample key={`${lesson.id}-${i}`} lesson={lesson} sql={segment.code} />
          )
        ),
      )}
    </div>
  );
}

function RunnableExample({ lesson, sql }: { lesson: Lesson; sql: string }) {
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<ExecOutcome | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      setOutcome(await runExample(lesson, sql));
    } finally {
      setRunning(false);
    }
  };

  const table = outcome?.results.findLast((r) => r.columns.length > 0);
  const hint = outcome?.error ? errorHint(courseById(lesson.courseId), outcome.error.code) : undefined;

  return (
    <figure className="overflow-hidden rounded-md border border-line bg-well">
      <div className="relative">
        <pre className="md-code !rounded-none !border-0 pr-32" dangerouslySetInnerHTML={{ __html: highlightSql(sql) }} />
        <Button variant="run" icon={<PlayIcon />} className="absolute right-2 top-2" onClick={() => void run()} disabled={running}>
          {running ? 'Выполняю…' : 'Выполнить'}
        </Button>
      </div>
      {outcome && (
        <div className="animate-rise border-t border-line bg-panel" aria-live="polite">
          {outcome.error ? (
            <div role="alert" className="px-3 py-2 text-[12.5px]">
              <p className="font-mono text-err">{outcome.error.message}</p>
              {hint && <p className="mt-1 text-dim">{hint}</p>}
            </div>
          ) : table ? (
            <div style={{ height: Math.min(70 + table.rows.length * 26, 300) }}>
              <ResultTable result={table} />
            </div>
          ) : (
            <p className="px-3 py-2 font-mono text-[12px] text-ok">{outcome.results.map(summarizeStatement).join(' · ') || 'Готово'}</p>
          )}
        </div>
      )}
    </figure>
  );
}

function ShellExample({ lesson, script }: { lesson: Lesson; script: string }) {
  const [result, setResult] = useState<ShellRun[] | null>(null);
  return (
    <figure className="overflow-hidden rounded-md border border-line bg-well">
      <div className="relative">
        <pre className="md-code !rounded-none !border-0 pr-32">{script}</pre>
        <Button variant="run" icon={<PlayIcon />} className="absolute right-2 top-2" onClick={() => setResult(runShellExample(lesson, script))}>
          Выполнить
        </Button>
      </div>
      {result && (
        <div className="animate-rise border-t border-line bg-panel px-3 py-2 font-mono text-[12.5px] leading-relaxed" aria-live="polite">
          {result.map((step, i) => (
            <div key={i}>
              <p className="whitespace-pre-wrap">
                <span className="text-ok">{step.prompt}</span> <span className="text-fg">{step.command}</span>
              </p>
              {step.lines.map((line, j) => (
                <p key={j} className={`min-h-[1.5em] whitespace-pre-wrap ${step.exit !== 0 && line.stream === 'err' ? 'text-err' : 'text-dim'}`}>
                  {line.text}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}
