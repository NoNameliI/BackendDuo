import { useEffect, useRef } from 'react';
import { courseById } from '@/content/courses';
import { allTasks, errorHint, type Task } from '@/content/loadCourse';
import { selectCourse, selectTask, useProgress } from '@/progress/store';
import { Button, Kbd } from '@/ui/Button';
import { CheckIcon } from '@/ui/icons';
import { Markdown } from '@/ui/Markdown';
import { Panel } from '@/ui/Panel';
import { Tabs } from '@/ui/Tabs';
import { highlightSql } from '@/ui/highlightSql';
import { TheoryView } from './TheoryView';
import { lessonApi, useWorkspace, type Verdict } from './workspace';

export const TASK_KIND: Record<Task['type'], string> = {
  result: 'SQL · выборка',
  state: 'SQL · изменение данных',
  schema: 'Собери схему',
  plan: 'Оптимизируй запрос',
  choice: 'Тест',
  review: 'Найди баг',
  graph: 'Git · история',
  worktree: 'Git · файлы',
  commands: 'Git · команды',
  hosting: 'Хостинг',
  ci: 'CI',
  request: 'HTTP · запрос',
};

const tabs = [
  { id: 'theory', title: 'Теория' },
  { id: 'task', title: 'Задание' },
] as const;

export function TaskPanel() {
  const { task, lesson, taskTab, setTaskTab } = useWorkspace();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [task?.id, taskTab]);

  if (!task || !lesson) return <Panel title="Задание">{null}</Panel>;

  return (
    <Panel
      tabs={<Tabs label="Урок" items={tabs} value={taskTab} onChange={setTaskTab} idPrefix="lesson" />}
      actions={<TaskStepper />}
    >
      <div
        ref={scrollRef}
        id="lesson-panel"
        role="tabpanel"
        aria-labelledby={`lesson-tab-${taskTab}`}
        className="h-full overflow-y-auto px-5 py-4"
      >
        {taskTab === 'theory' ? (
          <>
            <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
              {courseById(lesson.courseId).worlds.find((w) => w.id === lesson.worldId)?.title}
            </p>
            <h1 className="mb-3 text-[22px] font-semibold leading-tight tracking-tight">{lesson.title}</h1>
            <TheoryView lesson={lesson} />
            <Button variant="run" className="mt-5" onClick={() => setTaskTab('task')}>
              К заданию →
            </Button>
          </>
        ) : (
          <TaskView task={task} />
        )}
      </div>
    </Panel>
  );
}

function TaskView({ task }: { task: Task }) {
  const { verdict, schema, explainTarget, revealHint, revealSolution, setCode, status } = useWorkspace();
  const progress = useProgress(selectTask(task));
  const after = courseById(task.courseId).solutionAfterAttempts ?? 1;
  const solvable = 'solution' in task || 'shellSolution' in task || 'httpSolution' in task;
  const canShowSolution = solvable && (progress.attempts >= after || progress.hintsUsed >= task.hints.length);

  return (
    <article className="space-y-5">
      <header>
        <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em]">
          <span className="text-amber">{TASK_KIND[task.type]}</span>
          <span className="text-faint">+{task.xp} XP</span>
          {progress.solved && <span className="ml-auto flex items-center gap-1 text-ok"><CheckIcon /> решено</span>}
        </div>
        <h2 className="text-[19px] font-semibold leading-snug tracking-tight">{task.title}</h2>
      </header>

      {solvable && <Markdown source={task.prompt} />}

      {task.type === 'plan' && (
        <section aria-label="Целевой запрос" className="space-y-2">
          <SectionLabel>{task.check.mode === 'ddl' ? 'Запрос, который нужно ускорить' : 'Исходный запрос'}</SectionLabel>
          <pre className="md-code" dangerouslySetInnerHTML={{ __html: highlightSql(task.query) }} />
          <div className="flex gap-2">
            <Button variant="run" onClick={() => void explainTarget()} disabled={status === 'busy'}>
              Показать план
            </Button>
            {task.check.mode === 'query' && (
              <Button variant="outline" onClick={() => setCode(task.query)}>Скопировать в редактор</Button>
            )}
          </div>
        </section>
      )}

      {'solution' in task && schema && schema.tables.length > 0 && (
        <section aria-label="Таблицы задания">
          <SectionLabel>Таблицы</SectionLabel>
          <ul className="space-y-1 font-mono text-[12px]">
            {schema.tables.map((t) => (
              <li key={t.name} className="leading-relaxed">
                <span className="font-semibold text-fg">{t.name}</span>
                <span className="text-faint"> ({t.columns.map((c) => c.name).join(', ')})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {verdict && <VerdictCard verdict={verdict} task={task} />}

      <section aria-label="Подсказки" className="space-y-2">
        {task.hints.slice(0, progress.hintsUsed).map((hint, i) => (
          <div key={i} className="animate-rise rounded border-l-2 border-amber bg-amber/5 px-3 py-2 text-[13px]">
            <span className="mr-1 font-mono text-[11px] text-amber">#{i + 1}</span>
            <Markdown source={hint} className="inline-block" />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {progress.hintsUsed < task.hints.length && (
            <Button variant="outline" onClick={revealHint}>
              Подсказка {progress.hintsUsed + 1} из {task.hints.length}
            </Button>
          )}
          {!canShowSolution && solvable && after > 1 && progress.attempts > 0 && progress.hintsUsed < task.hints.length && (
            <span className="self-center text-[12px] text-faint">Решение откроется после {after} попыток (сейчас {progress.attempts})</span>
          )}
          {canShowSolution && !progress.solutionShown && (
            <Button variant="outline" onClick={revealSolution}>Показать решение</Button>
          )}
        </div>
        {'solution' in task && progress.solutionShown && (
          <div className="space-y-2">
            <SectionLabel>Эталонное решение</SectionLabel>
            <pre className="md-code" dangerouslySetInnerHTML={{ __html: highlightSql(task.solution) }} />
            <Button variant="outline" onClick={() => setCode(task.solution)}>Вставить в редактор</Button>
          </div>
        )}
        {'httpSolution' in task && progress.solutionShown && (
          <div className="space-y-2">
            <SectionLabel>Эталонный запрос</SectionLabel>
            <pre className="md-code whitespace-pre-wrap">{task.httpSolution}</pre>
            <Button variant="outline" onClick={() => lessonApi.getState().setDraftText(task.httpSolution)}>Вставить в композер</Button>
          </div>
        )}
        {'shellSolution' in task && progress.solutionShown && (
          <div className="space-y-2">
            <SectionLabel>Эталонное решение</SectionLabel>
            <pre className="md-code whitespace-pre-wrap">{task.shellSolution}</pre>
            <p className="text-[12.5px] text-dim">Наберите эти команды в терминале по одной; «Сбросить» вернёт песочницу к началу задания.</p>
          </div>
        )}
      </section>
    </article>
  );
}

function CostLine({ verdict }: { verdict: Verdict }) {
  if (!verdict.plan || verdict.baselineCost === undefined) return null;
  const now = verdict.plan.root.totalCost;
  const change = Math.round((1 - now / verdict.baselineCost) * 100);
  return (
    <p className="mt-1.5 font-mono text-[12px] text-dim">
      стоимость плана: {verdict.baselineCost.toFixed(0)} → <span className="text-fg">{now.toFixed(0)}</span>
      {change > 0 && <span className="text-ok"> (−{change}%)</span>}
    </p>
  );
}

function VerdictCard({ verdict, task }: { verdict: Verdict; task: Task }) {
  const { goRelative } = useWorkspace();
  const tasks = allTasks(courseById(task.courseId));
  const hasNext = tasks.findIndex((t) => t.id === task.id) < tasks.length - 1;
  const hint = verdict.error ? errorHint(courseById(task.courseId), verdict.error.code) : undefined;

  if (verdict.passed) {
    return (
      <section key={verdict.at} role="status" className="animate-pop rounded-md border border-ok/40 bg-ok/10 p-3">
        <p className="flex items-center gap-2 font-semibold text-ok">
          <CheckIcon width={16} height={16} /> Верно!
          {verdict.reward && <span className="ml-auto font-mono text-[13px]">+{verdict.reward.xp} XP</span>}
        </p>
        <CostLine verdict={verdict} />
        {(task.type === 'choice' || task.type === 'review') && (
          <Markdown source={task.explanation} className="mt-2 text-[13px]" />
        )}
        {hasNext && (
          <Button variant="check" className="mt-3" onClick={() => goRelative(1)}>
            Следующее задание <Kbd>Alt →</Kbd>
          </Button>
        )}
      </section>
    );
  }

  return (
    <section key={verdict.at} role="alert" className="animate-rise rounded-md border border-err/40 bg-err/10 p-3 text-[13px]">
      <p className="mb-1.5 font-semibold text-err">Пока не то</p>
      <CostLine verdict={verdict} />
      {verdict.error && (
        <>
          <p className="font-mono text-[12px] text-fg">
            {verdict.error.message}
            {verdict.error.line && <span className="text-faint"> · строка {verdict.error.line}</span>}
          </p>
          {hint && <p className="mt-1.5 text-dim">{hint}</p>}
        </>
      )}
      <ul className="space-y-1">
        {verdict.problems.map((p, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-err">•</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <h3 className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">{children}</h3>;
}

function TaskStepper() {
  const { task, lesson, openTask } = useWorkspace();
  const cp = useProgress(selectCourse(lesson?.courseId ?? ''));
  if (!lesson || !task) return null;
  return (
    <nav aria-label="Задания урока" className="flex items-center gap-1">
      {lesson.tasks.map((t, i) => {
        const current = t.id === task.id;
        const solved = cp.tasks[t.id]?.solved;
        return (
          <button
            key={t.id}
            type="button"
            aria-label={`Задание ${i + 1}: ${t.title}${solved ? ', решено' : ''}`}
            aria-current={current ? 'step' : undefined}
            onClick={() => void openTask(t)}
            className="grid h-5 w-5 place-items-center rounded-full"
          >
            <span
              className={`block h-2 w-2 rounded-full transition ${
                solved ? 'bg-ok' : current ? 'bg-amber' : 'bg-line-strong'
              } ${current ? 'ring-2 ring-amber/40 ring-offset-1 ring-offset-panel' : ''}`}
            />
          </button>
        );
      })}
    </nav>
  );
}
