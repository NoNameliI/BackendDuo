import { useEffect, useMemo, useState } from 'react';
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
import { resetHttpExamples, runGraphqlExample, runHttpExample, runProtoExample, runPythonExample, type HttpRun, type SchemaRun } from './httpExamples';
import { pythonClient } from '@/engine/python/pythonClient';
import { PythonStatusLine } from '@/features/api/FastapiPanel';
import { prettyBody, statusText } from '@/engine/api/http';
import { statusTone } from '@/features/api/ResponseView';
import { explain422 } from '@/engine/api/explain';
import { summarizeStatement } from './format';
import { ResultTable } from './ResultTable';

export function TheoryView({ lesson }: { lesson: Lesson }) {
  const segments = useMemo(() => splitTheory(lesson.theory), [lesson.theory]);
  const runnable = segments.some((s) => s.kind === 'example');
  const shell = segments.some((s) => s.kind === 'example' && s.lang === 'sh');
  const http = segments.some((s) => s.kind === 'example' && (s.lang === 'http' || s.lang === 'graphql' || s.lang === 'proto' || s.lang === 'python'));
  const python = segments.some((s) => s.kind === 'example' && s.lang === 'python');

  // Python takes seconds to load: it starts while the learner reads the theory.
  useEffect(() => {
    if (python) pythonClient().prewarm();
  }, [python]);

  return (
    <div className="space-y-4">
      {runnable && (
        <p className="rounded border border-line bg-well px-3 py-2 text-[12.5px] leading-relaxed text-dim">
          {http
            ? python
              ? 'Примеры на FastAPI выполняются настоящим Python внутри приложения, сети нет. Каждый пример запускает своё приложение заново и не трогает задание.'
              : 'Примеры запускаются на учебном сервере внутри приложения, сети нет. Сервер примеров отдельный и не трогает задание; запускайте примеры по порядку.'
            : shell
            ? 'Примеры с кнопкой «Выполнить» работают в отдельной учебной песочнице Git и не трогают задание. Запускайте их по порядку — каждый продолжает предыдущий.'
            : 'Примеры с кнопкой «Выполнить» работают в отдельной учебной базе и не трогают задание. Запускайте их по порядку и меняйте прямо в тексте задания — так быстрее всего понять синтаксис.'}{' '}
          <button
            type="button"
            className="text-nav underline underline-offset-2"
            onClick={() => (http ? resetHttpExamples(lesson) : shell ? resetShellExamples(lesson) : void resetExamples(lesson))}
          >
            {http ? 'Вернуть сервер примеров в исходное состояние' : shell ? 'Начать примеры заново' : 'Вернуть базу примеров в исходное состояние'}
          </button>
        </p>
      )}
      {segments.map((segment, i) =>
        segment.kind === 'markdown' ? (
          <Markdown key={i} source={segment.text} />
        ) : (
          segment.lang === 'sh' ? (
            <ShellExample key={`${lesson.id}-${i}`} lesson={lesson} script={segment.code} />
          ) : segment.lang === 'http' ? (
            <HttpExample key={`${lesson.id}-${i}`} lesson={lesson} text={segment.code} />
          ) : segment.lang === 'python' ? (
            <HttpExample key={`${lesson.id}-${i}`} lesson={lesson} text={segment.code} python />
          ) : segment.lang === 'graphql' || segment.lang === 'proto' ? (
            <SchemaExample key={`${lesson.id}-${i}`} lesson={lesson} lang={segment.lang} text={segment.code} />
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

/** `http example` sends requests to the lesson's server; `python example` runs a FastAPI main.py and sends requests to it. */
function HttpExample({ lesson, text, python = false }: { lesson: Lesson; text: string; python?: boolean }) {
  const [result, setResult] = useState<HttpRun[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setResult(python ? await runPythonExample(text) : runHttpExample(lesson, text));
    } finally {
      setBusy(false);
    }
  };
  return (
    <figure className="overflow-hidden rounded-md border border-line bg-well">
      <div className="relative">
        <pre className="md-code !rounded-none !border-0 pr-32">{text}</pre>
        <Button variant="run" icon={<PlayIcon />} className="absolute right-2 top-2" disabled={busy} onClick={() => void run()}>
          {python ? 'Запустить' : 'Отправить'}
        </Button>
      </div>
      {python && busy && (
        <div className="border-t border-line bg-panel px-3 py-2">
          <PythonStatusLine />
        </div>
      )}
      {result && (
        <div className="animate-rise space-y-2 border-t border-line bg-panel px-3 py-2 font-mono text-[12.5px] leading-relaxed" aria-live="polite">
          {result.map((run, i) =>
            run.response ? (
              <div key={i}>
                <p className={`font-semibold ${statusTone(run.response.status)}`}>
                  {run.response.status} {statusText(run.response.status)}
                </p>
                {run.response.headers.map((h, j) => (
                  <p key={j} className="text-faint">
                    {h.name}: {h.value}
                  </p>
                ))}
                {run.response.status === 422 &&
                  explain422(run.response.body)?.map((line, j) => (
                    <p key={`e${j}`} className="font-sans text-amber">
                      • {line}
                    </p>
                  ))}
                {run.error && <p className="font-sans text-amber">{run.error}</p>}
                {run.response.body && <pre className="mt-1 whitespace-pre-wrap text-fg">{prettyBody(run.response.body)}</pre>}
                {run.output && <pre className="mt-1 whitespace-pre-wrap text-dim">{run.output}</pre>}
              </div>
            ) : (
              <p key={i} className="text-err">
                {run.error}
              </p>
            ),
          )}
        </div>
      )}
    </figure>
  );
}

/** `graphql example` runs the query on the lesson server's schema; `proto example` parses, encodes and calls. */
function SchemaExample({ lesson, lang, text }: { lesson: Lesson; lang: 'graphql' | 'proto'; text: string }) {
  const [result, setResult] = useState<SchemaRun | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setResult(lang === 'graphql' ? await runGraphqlExample(lesson, text) : await runProtoExample(lesson, text));
    } finally {
      setBusy(false);
    }
  };
  return (
    <figure className="overflow-hidden rounded-md border border-line bg-well">
      <div className="relative">
        <pre className="md-code !rounded-none !border-0 pr-32">{text}</pre>
        <Button variant="run" icon={<PlayIcon />} className="absolute right-2 top-2" disabled={busy} onClick={() => void run()}>
          {lang === 'graphql' ? 'Выполнить' : 'Разобрать'}
        </Button>
      </div>
      {result && (
        <div className="animate-rise space-y-2 border-t border-line bg-panel px-3 py-2 font-mono text-[12.5px] leading-relaxed" aria-live="polite">
          {result.summary?.messages.map((m) => (
            <p key={m.name} className="text-dim">
              message {m.name}: {m.fields.map((f) => `${f.name} = ${f.number}`).join(', ') || 'без полей'}
            </p>
          ))}
          {result.lines.map((line, i) => (
            <pre key={i} className={`whitespace-pre-wrap ${line.ok ? 'text-fg' : 'font-sans text-amber'}`}>
              {line.text}
            </pre>
          ))}
        </div>
      )}
    </figure>
  );
}
