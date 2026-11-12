import { useEffect, useMemo, useState } from 'react';
import { courseById } from '@/content/courses';
import { consoleHint } from '@/features/broker/errorHint';
import { errorHint, type Lesson } from '@/content/loadCourse';
import { splitTheory } from '@/content/theory';
import type { ExecOutcome } from '@/engine';
import { Button } from '@/ui/Button';
import { PlayIcon } from '@/ui/icons';
import { Markdown } from '@/ui/Markdown';
import { highlightSql } from '@/ui/highlightSql';
import { resetBrokerExamples, runBrokerExample, runScenarioExample, type BrokerRun, type ScenarioRun } from './brokerExamples';
import { resetExamples, runExample } from './examples';
import { resetShellExamples, runShellExample, type ShellRun } from './shellExamples';
import { resetHttpExamples, runGraphqlExample, runHttpExample, runProtoExample, runPythonExample, type HttpRun, type SchemaRun } from './httpExamples';
import { pythonClient } from '@/engine/python/pythonClient';
import { PythonStatusLine } from '@/features/api/FastapiPanel';
import { prettyBody, statusText } from '@/engine/api/http';
import { statusTone, ValidationProblems } from '@/features/api/ResponseView';
import { summarizeStatement } from './format';
import { ResultTable } from './ResultTable';

export function TheoryView({ lesson }: { lesson: Lesson }) {
  const segments = useMemo(() => splitTheory(lesson.theory), [lesson.theory]);
  const runnable = segments.some((s) => s.kind === 'example');
  const shell = segments.some((s) => s.kind === 'example' && s.lang === 'sh');
  const http = segments.some((s) => s.kind === 'example' && (s.lang === 'http' || s.lang === 'graphql' || s.lang === 'proto' || s.lang === 'python'));
  const broker = segments.some((s) => s.kind === 'example' && (s.lang === 'broker' || s.lang === 'scenario'));
  const python = segments.some((s) => s.kind === 'example' && s.lang === 'python');

  // Python takes seconds to load: it starts while the learner reads the theory.
  useEffect(() => {
    if (python) pythonClient().prewarm();
  }, [python]);

  return (
    <div className="space-y-4">
      {runnable && (
        <p className="rounded border border-line bg-well px-3 py-2 text-[12.5px] leading-relaxed text-dim">
          {broker
            ? 'Примеры работают в отдельной учебной песочнице брокера и не трогают задание. Команды выполняются по порядку и продолжают друг друга; сценарий каждый раз запускается заново.'
            : http
            ? python
              ? 'Примеры на FastAPI выполняются настоящим Python внутри приложения, сети нет. Каждый пример запускает своё приложение заново и не трогает задание.'
              : 'Примеры запускаются на учебном сервере внутри приложения, сети нет. Сервер примеров отдельный и не трогает задание; запускайте примеры по порядку.'
            : shell
            ? 'Примеры с кнопкой «Выполнить» работают в отдельной учебной песочнице Git и не трогают задание. Запускайте их по порядку — каждый продолжает предыдущий.'
            : 'Примеры с кнопкой «Выполнить» работают в отдельной учебной базе и не трогают задание. Запускайте их по порядку и меняйте прямо в тексте задания — так быстрее всего понять синтаксис.'}{' '}
          <button
            type="button"
            className="text-nav underline underline-offset-2"
            onClick={() => (broker ? resetBrokerExamples() : http ? resetHttpExamples(lesson) : shell ? resetShellExamples(lesson) : void resetExamples(lesson))}
          >
            {broker ? 'Начать примеры заново' : http ? 'Вернуть сервер примеров в исходное состояние' : shell ? 'Начать примеры заново' : 'Вернуть базу примеров в исходное состояние'}
          </button>
        </p>
      )}
      {segments.map((segment, i) =>
        segment.kind === 'markdown' ? (
          <Markdown key={i} source={segment.text} />
        ) : (
          segment.lang === 'broker' ? (
            <BrokerExample key={`${lesson.id}-${i}`} lesson={lesson} script={segment.code} />
          ) : segment.lang === 'scenario' ? (
            <ScenarioExample key={`${lesson.id}-${i}`} json={segment.code} />
          ) : segment.lang === 'sh' ? (
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
      {/* Mounted before the result arrives, so screen readers announce the first result too. */}
      <div aria-live="polite">
        {result && (
        <div className="animate-rise border-t border-line bg-panel px-3 py-2 font-mono text-[12.5px] leading-relaxed">
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
      </div>
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
      <div aria-live="polite">
        {result && (
        <div className="animate-rise space-y-2 border-t border-line bg-panel px-3 py-2 font-mono text-[12.5px] leading-relaxed">
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
                {run.response.status === 422 && <ValidationProblems body={run.response.body} className="font-sans" />}
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
      </div>
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
      <div aria-live="polite">
        {result && (
        <div className="animate-rise space-y-2 border-t border-line bg-panel px-3 py-2 font-mono text-[12.5px] leading-relaxed">
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
      </div>
    </figure>
  );
}

function BrokerExample({ lesson, script }: { lesson: Lesson; script: string }) {
  const [result, setResult] = useState<BrokerRun[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setResult(await runBrokerExample(lesson, script));
    } finally {
      setBusy(false);
    }
  };
  return (
    <figure className="overflow-hidden rounded-md border border-line bg-well">
      <div className="relative">
        <pre className="md-code !rounded-none !border-0 pr-32">{script}</pre>
        <Button variant="run" icon={<PlayIcon />} className="absolute right-2 top-2" disabled={busy} onClick={() => void run()}>
          Выполнить
        </Button>
      </div>
      <div aria-live="polite">
        {result && (
          <div className="animate-rise border-t border-line bg-panel px-3 py-2 font-mono text-[12.5px] leading-relaxed">
            {result.map((step, i) => {
              const hint = consoleHint(courseById(lesson.courseId), step.code);
              return (
                <div key={i}>
                  <p className="whitespace-pre-wrap break-words">
                    <span className="text-ok">$</span> <span className="text-fg">{step.command}</span>
                  </p>
                  {step.lines.map((line, j) => (
                    <p key={j} className={`min-h-[1.5em] whitespace-pre-wrap break-words ${line.tone === 'err' ? 'text-err' : line.tone === 'dim' ? 'text-dim' : 'text-fg'}`}>
                      {line.text}
                    </p>
                  ))}
                  {hint && <p className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-snug text-dim">{hint}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </figure>
  );
}

/** `scenario example`: the scenario runs to its end in its own broker; the verdict of its expectations and the notable journal lines are shown. */
function ScenarioExample({ json }: { json: string }) {
  const [result, setResult] = useState<ScenarioRun | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setResult(await runScenarioExample(json));
    } finally {
      setBusy(false);
    }
  };
  return (
    <figure className="overflow-hidden rounded-md border border-line bg-well">
      <div className="relative">
        <pre className="md-code !rounded-none !border-0 pr-32">{json}</pre>
        <Button variant="run" icon={<PlayIcon />} className="absolute right-2 top-2" disabled={busy} onClick={() => void run()}>
          Запустить
        </Button>
      </div>
      <div aria-live="polite">
        {result && (
          <div className="animate-rise space-y-1.5 border-t border-line bg-panel px-3 py-2 text-[12.5px] leading-relaxed">
            {result.error ? (
              <p className="text-err">{result.error}</p>
            ) : (
              <>
                <p className="text-dim">
                  Сценарий прошёл {(result.durationMs / 1000).toFixed(1).replace('.', ',')} с виртуального времени, опубликовано сообщений: {result.published}.
                </p>
                {result.checks.map((c, i) => (
                  <p key={i} className={c.ok ? 'text-ok' : 'text-err'}>
                    {c.ok ? '✓' : '✗'} {c.text}
                  </p>
                ))}
                {result.trace.map((t, i) => (
                  <p key={i} className="text-fg">
                    {t}
                  </p>
                ))}
                {result.notable.length > 0 && (
                  <ul className="list-none space-y-0.5 p-0 font-mono text-[12px] text-dim">
                    {result.notable.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </figure>
  );
}
