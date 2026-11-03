import { create } from 'zustand';
import { checkChoice, createChecker, SolutionError, type Checker, type CheckResult } from '@/checker';
import { course } from '@/content/course';
import { allTasks, errorHint, type Lesson, type Task } from '@/content/loadCourse';
import {
  createEngine,
  type QueryPlan,
  type SandboxEngine,
  type SchemaInfo,
  type SqlError,
  type StatementResult,
} from '@/engine';
import { taskProgress, useProgress } from '@/progress/store';
import { formatMs } from '@/ui/format';
import { formatSqlError, summarizeStatement } from './format';

export type LogKind = 'cmd' | 'info' | 'ok' | 'error' | 'hint';

export interface LogEntry {
  id: number;
  kind: LogKind;
  text: string;
  at: number;
}

export type EngineStatus = 'off' | 'starting' | 'ready' | 'busy' | 'failed';
export type ResultTab = 'result' | 'schema' | 'plan';
export type TaskTab = 'theory' | 'task';

export interface Verdict extends CheckResult {
  at: number;
}

interface WorkspaceState {
  status: EngineStatus;
  task: Task | null;
  lesson: Lesson | null;
  taskTab: TaskTab;
  code: string;
  selected: number[];
  verdict: Verdict | null;
  log: LogEntry[];
  result: StatementResult | null;
  error: SqlError | null;
  schema: SchemaInfo | null;
  plan: QueryPlan | null;
  tab: ResultTab;

  setCode: (code: string) => void;
  setTab: (tab: ResultTab) => void;
  setTaskTab: (tab: TaskTab) => void;
  print: (kind: LogKind, text: string) => void;
  clearLog: () => void;
  openTask: (task: Task) => Promise<void>;
  goRelative: (delta: 1 | -1) => void;
  toggleOption: (index: number) => void;
  resetDatabase: () => Promise<void>;
  run: () => Promise<void>;
  explain: () => Promise<void>;
  explainTarget: () => Promise<void>;
  check: () => Promise<void>;
  revealHint: () => void;
  revealSolution: () => void;
}

const LOG_LIMIT = 300;
let nextLogId = 1;

let enginePromise: Promise<{ engine: SandboxEngine; checker: Checker }> | null = null;

export const lessonOf = (task: Task): Lesson =>
  course.worlds.flatMap((w) => w.lessons).find((l) => l.id === task.lessonId)!;

const isSqlTask = (task: Task | null) => task !== null && task.type !== 'choice' && task.type !== 'review';

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const print = (kind: LogKind, text: string) => get().print(kind, text);

  const sandbox = () => {
    if (!enginePromise) {
      set({ status: 'starting' });
      const started = performance.now();
      const engine = createEngine(course.engine);
      enginePromise = engine.init().then(
        () => {
          print('ok', `Песочница PostgreSQL готова (${formatMs(performance.now() - started)})`);
          return { engine, checker: createChecker(engine) };
        },
        (e: unknown) => {
          enginePromise = null;
          set({ status: 'failed' });
          throw e;
        },
      );
    }
    return enginePromise;
  };

  /** Runs sandbox work one job at a time, in order, and keeps `status` in sync. */
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;
  const withSandbox = (work: (s: { engine: SandboxEngine; checker: Checker }) => Promise<void>) => {
    pending++;
    const job = async () => {
      try {
        const s = await sandbox();
        set({ status: 'busy' });
        await work(s);
      } catch (e) {
        const message =
          e instanceof SolutionError ? `Ошибка в самом задании: ${e.message}` : e instanceof Error ? e.message : String(e);
        print('error', message);
      } finally {
        pending--;
        if (pending === 0) set({ status: enginePromise ? 'ready' : 'failed' });
      }
    };
    queue = queue.then(job);
    return queue;
  };

  const refreshSchema = async (engine: SandboxEngine) => set({ schema: await engine.introspect() });

  const printError = (error: SqlError) => {
    print('error', formatSqlError(error));
    const hint = errorHint(course, error.code);
    if (hint) print('hint', hint);
  };

  const saveDraft = () => {
    const { task, code } = get();
    if (task && isSqlTask(task)) useProgress.getState().saveDraft(task.id, code);
  };

  return {
    status: 'off',
    task: null,
    lesson: null,
    taskTab: 'theory',
    code: '',
    selected: [],
    verdict: null,
    log: [],
    result: null,
    error: null,
    schema: null,
    plan: null,
    tab: 'result',

    setCode: (code) => set({ code, error: null }),
    setTab: (tab) => set({ tab }),
    setTaskTab: (taskTab) => set({ taskTab }),
    print: (kind, text) =>
      set((s) => ({ log: [...s.log, { id: nextLogId++, kind, text, at: Date.now() }].slice(-LOG_LIMIT) })),
    clearLog: () => set({ log: [] }),

    openTask: async (task) => {
      saveDraft();
      const lesson = lessonOf(task);
      const progress = taskProgress(useProgress.getState(), task.id);
      set({
        task,
        lesson,
        taskTab: lesson.tasks[0].id === task.id && !progress.solved ? 'theory' : 'task',
        code: 'solution' in task ? (progress.draft ?? task.starter) : '',
        selected: [],
        verdict: null,
        result: null,
        error: null,
        plan: null,
        schema: null,
        tab: 'result',
      });
      if (!isSqlTask(task)) return;
      await withSandbox(async ({ engine }) => {
        if (get().task?.id !== task.id) return; // a later navigation superseded this one
        await engine.reset(task.setupSql);
        await refreshSchema(engine);
        print('info', `Задание «${task.title}»: база подготовлена`);
      });
    },

    goRelative: (delta) => {
      const { task } = get();
      if (!task) return;
      const tasks = allTasks(course);
      const next = tasks[tasks.findIndex((t) => t.id === task.id) + delta];
      if (next) void get().openTask(next);
    },

    toggleOption: (index) => {
      const { task, selected, verdict } = get();
      if (!task || (task.type !== 'choice' && task.type !== 'review') || verdict?.passed) return;
      const multiple = task.answer.length > 1;
      const next = multiple
        ? selected.includes(index)
          ? selected.filter((i) => i !== index)
          : [...selected, index]
        : [index];
      set({ selected: next, verdict: null });
    },

    resetDatabase: () =>
      withSandbox(async ({ engine }) => {
        await engine.reset(get().task?.setupSql ?? '');
        await refreshSchema(engine);
        set({ result: null, plan: null, error: null });
        print('info', 'База возвращена к исходному состоянию задания');
      }),

    run: () =>
      withSandbox(async ({ engine }) => {
        const { code } = get();
        if (!code.trim() || !isSqlTask(get().task)) return;
        print('cmd', firstLine(code));
        const out = await engine.execute(code);
        out.results.forEach((r) => print('ok', summarizeStatement(r)));
        out.notices.forEach((n) => print('info', `NOTICE: ${n}`));
        if (out.error) printError(out.error);
        else print('info', `Готово за ${formatMs(out.durationMs)}`);

        const shown = out.results.findLast((r) => r.columns.length > 0) ?? null;
        set({ result: shown ?? get().result, error: out.error ?? null, ...(shown ? { tab: 'result' as const } : {}) });
        if (out.results.length > 0) await refreshSchema(engine);
      }),

    explain: () =>
      withSandbox(async ({ engine }) => {
        const { code } = get();
        if (!code.trim() || !isSqlTask(get().task)) return;
        print('cmd', `EXPLAIN ${firstLine(code)}`);
        const out = await engine.explain(code, { analyze: true });
        if (out.error) {
          printError(out.error);
          set({ error: out.error });
          return;
        }
        set({ plan: out.plan, tab: 'plan' });
        print('ok', `План построен${out.plan.analyzed ? ' и выполнен' : ''}: стоимость ${out.plan.root.totalCost.toFixed(0)}`);
      }),

    explainTarget: () =>
      withSandbox(async ({ engine }) => {
        const { task } = get();
        if (task?.type !== 'plan') return;
        print('cmd', `EXPLAIN ${firstLine(task.query)}`);
        const out = await engine.explain(task.query);
        if (out.error) return printError(out.error);
        set({ plan: out.plan, tab: 'plan' });
        print('ok', `План целевого запроса: стоимость ${out.plan.root.totalCost.toFixed(0)}`);
      }),

    check: async () => {
      const { task, selected, code } = get();
      if (!task) return;
      const progress = useProgress.getState();

      if (task.type === 'choice' || task.type === 'review') {
        if (selected.length === 0) return;
        const verdict = checkChoice(task, selected);
        progress.recordAttempt(task.id, verdict.passed);
        set({ verdict: { ...verdict, at: Date.now() } });
        return;
      }

      await withSandbox(async ({ engine, checker }) => {
        if (get().task?.id !== task.id) return;
        print('cmd', 'Проверка решения…');
        const verdict = await checker.check(task, { kind: 'sql', code });
        progress.recordAttempt(task.id, verdict.passed);
        progress.saveDraft(task.id, code);
        await refreshSchema(engine);
        set({
          verdict: { ...verdict, at: Date.now() },
          error: verdict.error ?? null,
          result: verdict.actual ?? get().result,
          plan: verdict.plan ?? get().plan,
          taskTab: 'task',
          ...(verdict.plan ? { tab: 'plan' as const } : verdict.actual ? { tab: 'result' as const } : {}),
        });
        if (verdict.error) printError(verdict.error);
        verdict.problems.forEach((p) => print('error', p));
        if (verdict.passed) print('ok', 'Решение принято');
      });
    },

    revealHint: () => {
      const { task } = get();
      if (!task || taskProgress(useProgress.getState(), task.id).hintsUsed >= task.hints.length) return;
      useProgress.getState().useHint(task.id);
      set({ taskTab: 'task' });
    },

    revealSolution: () => {
      const { task } = get();
      if (task) useProgress.getState().revealSolution(task.id);
    },
  };
});

function firstLine(code: string): string {
  const line = code.trim().split('\n')[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}
