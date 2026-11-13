import { create } from 'zustand';
import { checkChoice, createChecker, SolutionError, type Answer, type Checker, type CheckResult } from '@/checker';
import { checkApiTask, freshServer, readCorsConfig } from '@/checker/api';
import { createGitChecker } from '@/checker/git';
import { createApiSandboxStore, readJsonObject } from '@/features/api/apiStore';
import { schemaClient } from '@/engine/api/schemaClient';
import { pythonClient } from '@/engine/python/pythonClient';
import { SetupError } from '@/engine/git/GitSandboxEngine';
import { createGitSandboxStore } from '@/features/git/gitSandbox';
import { courseById } from '@/content/courses';
import { allTasks, errorHint, type BrokerTask, type Lesson, type Task } from '@/content/loadCourse';
import { createBrokerStore } from '@/features/broker/brokerStore';
import type { ClientRun } from '@/engine/python/runtime';
import { parseScenario, type Scenario } from '@/engine/sim/scenario';
import {
  createEngine,
  type QueryPlan,
  type SandboxEngine,
  type SchemaInfo,
  type SqlError,
  type StatementResult,
} from '@/engine';
import { lessonStatuses } from '@/progress/gamification';
import { selectCourse, selectTask, useProgress, type SolveReward } from '@/progress/store';
import { toggleSelection } from '@/ui/OptionList';
import { useToasts } from '@/ui/toasts';
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
  reward: SolveReward | null;
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
  /** An API task is being checked (FastAPI checks take seconds): a second check would count as another attempt. */
  checking: boolean;

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
  /** Forgets the open task; the next visit to the lesson view opens a task afresh. */
  closeTask: () => void;
  revealSolution: () => void;
  /** Resets the sandbox to a task outside the lesson player (onboarding, placement). */
  prepare: (task: Task) => Promise<void>;
  /** Checks an answer to such a task through the same sandbox queue. */
  verify: (task: Task, answer: Answer) => Promise<CheckResult>;
}

const LOG_LIMIT = 300;
let nextLogId = 1;

let enginePromise: Promise<{ engine: SandboxEngine; checker: Checker }> | null = null;

export const lessonOf = (task: Task): Lesson =>
  courseById(task.courseId).worlds.flatMap((w) => w.lessons).find((l) => l.id === task.lessonId)!;

const isSqlTask = (task: Task | null) => task !== null && 'solution' in task;

/** The Git sandbox of lessons (the free playground has its own). */
export const lessonSandbox = createGitSandboxStore();
/** Request composer and network log of API lessons. */
export const lessonApi = createApiSandboxStore();
/** Simulator lab of broker lessons; the simulators load lazily on the first reset. */
export const lessonBroker = createBrokerStore();
const gitChecker = createGitChecker();

/** Starts the lab of a broker task: its scenario with the patch, the setup script, the starting properties. */
function prepareBroker(task: BrokerTask): Promise<void> | string {
  let scenario: Scenario | null = null;
  try {
    const base = task.scenario ? courseById(task.courseId).scenarios[task.scenario] : undefined;
    if (task.scenario && !base) return `Ошибка в самом задании: нет сценария «${task.scenario}»`;
    scenario = base ? parseScenario({ ...base, ...(task.scenarioPatch ?? {}) }) : null;
  } catch (e) {
    return `Ошибка в самом задании: ${e instanceof Error ? e.message : String(e)}`;
  }
  return lessonBroker.getState().reset({
    sim: task.sim,
    setup: task.brokerSetup,
    scenario,
    props: task.propsStarter,
    starter: task.brokerStarter,
    ...(task.type === 'client' ? { client: { source: task.pythonStarter } } : {}),
  });
}

/** Client tasks: runs the learner's Python on a fresh simulator, then lets the lab show what it did. */
async function runClientProgram(): Promise<void> {
  const lab = lessonBroker.getState();
  const setup = lab.clientSetup();
  const spec = lab.spec;
  if (!setup || !lab.client || lab.client.running || lab.status !== 'ready') return;
  lab.setClientRunning(true);
  let run: ClientRun;
  try {
    run = await pythonClient().client(lab.client.source, setup);
  } catch (e) {
    run = { ops: [], output: '', stopped: false, ms: 0, error: { kind: 'load', type: 'Error', message: e instanceof Error ? e.message : String(e), line: null } };
  }
  if (lessonBroker.getState().spec !== spec) return; // another task opened meanwhile
  lessonBroker.getState().playClient(run);
}

/** Fresh server (with the task's setup requests) and, for CORS tasks, the starting settings. */
function prepareApi(task: Extract<Task, { httpSolution: string }>): string | null {
  try {
    const server = task.server ? freshServer(task, courseById(task.courseId).servers) : null;
    const cors = task.type === 'cors' ? { config: readCorsConfig(task.jsonStarter), call: task.fetch } : null;
    const def = task.server ? courseById(task.courseId).servers[task.server] : undefined;
    const graphql = task.type === 'graphql' ? { query: task.graphqlStarter, variables: task.variables, sdl: def?.graphql ?? '', collections: def?.collections ?? {} } : undefined;
    const proto = task.type === 'proto' ? { source: task.protoStarter, collections: def?.collections ?? {} } : undefined;
    const python = task.type === 'fastapi' ? { source: task.pythonStarter } : undefined;
    lessonApi.getState().reset(task.httpStarter, { server: python ? null : server, cors, graphql, proto, python });
    return null;
  } catch (e) {
    return `Ошибка в самом задании: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function prepareGit(task: Extract<Task, { shellSolution: string }>): string | null {
  const sandbox = lessonSandbox.getState();
  sandbox.setHints(courseById(task.courseId).terminalHints);
  try {
    sandbox.reset(task.shellSetup);
    return null;
  } catch (e) {
    return e instanceof SetupError ? `Ошибка в самом задании: ${e.message}` : String(e);
  }
}

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const print = (kind: LogKind, text: string) => get().print(kind, text);

  const sandbox = () => {
    if (!enginePromise) {
      set({ status: 'starting' });
      const started = performance.now();
      // This workspace drives SQL lessons, so its sandbox is always PostgreSQL.
      const engine = createEngine('postgres');
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
    const hint = errorHint(courseById(get().task?.courseId ?? ''), error.code);
    if (hint) print('hint', hint);
  };

  const saveDraft = () => {
    const { task, code } = get();
    if (task && 'solution' in task && code !== (selectTask(task)(useProgress.getState()).draft ?? task.starter)) {
      useProgress.getState().saveDraft(task, code);
    }
  };

  return {
    status: 'off',
    checking: false,
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
      if (task.type === 'drill') return; // drill tasks live in the trainer, not in the lesson player
      saveDraft();
      const lesson = lessonOf(task);
      const progress = selectTask(task)(useProgress.getState());
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
      if ('shellSolution' in task) {
        const failure = prepareGit(task);
        if (failure) print('error', failure);
        return;
      }
      if ('httpSolution' in task) {
        const failure = prepareApi(task);
        if (failure) print('error', failure);
        return;
      }
      if ('brokerSolution' in task) {
        const started = prepareBroker(task as BrokerTask);
        if (typeof started === 'string') print('error', started);
        else await started;
        return;
      }
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
      const course = courseById(task.courseId);
      const tasks = allTasks(course);
      const next = tasks[tasks.findIndex((t) => t.id === task.id) + delta];
      if (!next) return;
      if (lessonStatuses(course, selectCourse(course.id)(useProgress.getState())).get(next.lessonId) === 'locked') {
        useToasts.getState().push({ tone: 'info', title: 'Следующий урок пока закрыт', body: 'Решите задания текущего урока' });
        return;
      }
      void get().openTask(next);
    },

    toggleOption: (index) => {
      const { task, selected, verdict } = get();
      if (!task || (task.type !== 'choice' && task.type !== 'review') || verdict?.passed) return;
      set({ selected: toggleSelection(selected, index, task.answer.length > 1), verdict: null });
    },

    resetDatabase: () => {
      const current = get().task;
      if (current && 'shellSolution' in current) {
        const failure = prepareGit(current);
        if (failure) print('error', failure);
        return Promise.resolve();
      }
      if (current && 'httpSolution' in current) {
        const failure = prepareApi(current);
        if (failure) print('error', failure);
        return Promise.resolve();
      }
      if (current && 'brokerSolution' in current) {
        const started = prepareBroker(current as BrokerTask);
        if (typeof started === 'string') {
          print('error', started);
          return Promise.resolve();
        }
        return started;
      }
      return withSandbox(async ({ engine }) => {
        await engine.reset(get().task?.setupSql ?? '');
        await refreshSchema(engine);
        set({ result: null, plan: null, error: null });
        print('info', 'База возвращена к исходному состоянию задания');
      });
    },

    run: () => {
      const task = get().task;
      if (task && 'brokerSolution' in task) {
        if (task.type === 'client') return runClientProgram();
        lessonBroker.getState().runScenario();
        return Promise.resolve();
      }
      if (task && 'httpSolution' in task) {
        const api = lessonApi.getState();
        return task.type === 'graphql' ? api.runGraphql() : task.type === 'cors' ? Promise.resolve(api.runFrontend()) : task.type === 'proto' ? Promise.resolve() : api.send();
      }
      return withSandbox(async ({ engine }) => {
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
      });
    },

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
        const reward = progress.recordAttempt(task, verdict.passed);
        set({ verdict: { ...verdict, at: Date.now(), reward } });
        announce(reward);
        return;
      }

      if ('httpSolution' in task) {
        if (get().checking) return;
        set({ checking: true });
        let verdict: CheckResult;
        try {
          const { draft, cors, graphql, proto } = lessonApi.getState();
          const servers = courseById(task.courseId).servers;
          if (task.type === 'graphql') {
            verdict = await schemaClient().checkGraphql(task, task.server ? servers[task.server] : undefined, {
              query: graphql?.query ?? '',
              variables: readJsonObject(graphql?.variables ?? '', 'Переменные'),
            });
          } else if (task.type === 'proto') verdict = await schemaClient().checkProto(task, proto?.source ?? '');
          else if (task.type === 'fastapi') {
            const { checkFastapi } = await import('@/checker/fastapi');
            verdict = await checkFastapi(task, lessonApi.getState().python?.source ?? '', (source, requests) => pythonClient().run(source, requests));
          }
          else verdict = checkApiTask(task, servers, { draft, cors: cors?.config ?? null });
        } catch (e) {
          verdict = { passed: false, problems: [e instanceof SolutionError ? `Ошибка в самом задании: ${e.message}` : e instanceof Error ? e.message : String(e)] };
        } finally {
          set({ checking: false });
        }
        if (get().task?.id !== task.id) return;
        const reward = progress.recordAttempt(task, verdict.passed);
        set({ verdict: { ...verdict, at: Date.now(), reward }, taskTab: 'task' });
        announce(reward);
        return;
      }

      if ('brokerSolution' in task) {
        if (get().checking) return;
        set({ checking: true });
        let verdict: CheckResult;
        try {
          const broker = await import('@/checker/broker');
          const scenarios = courseById(task.courseId).scenarios;
          verdict =
            task.type === 'client'
              ? await broker.checkClientTask(task as BrokerTask, scenarios, lessonBroker.getState().client?.source ?? '', (source, setup, options) => pythonClient().client(source, setup, options))
              : broker.checkBrokerTask(task as BrokerTask, scenarios, lessonBroker.getState().input());
        } catch (e) {
          verdict = { passed: false, problems: [e instanceof SolutionError ? `Ошибка в самом задании: ${e.message}` : e instanceof Error ? e.message : String(e)] };
        } finally {
          set({ checking: false });
        }
        if (get().task?.id !== task.id) return;
        const reward = progress.recordAttempt(task, verdict.passed);
        set({ verdict: { ...verdict, at: Date.now(), reward }, taskTab: 'task' });
        announce(reward);
        return;
      }

      if ('shellSolution' in task) {
        let verdict: CheckResult;
        try {
          const { engine, commands } = lessonSandbox.getState();
          verdict = gitChecker.check(task, engine.world, commands);
        } catch (e) {
          verdict = { passed: false, problems: [e instanceof SolutionError ? `Ошибка в самом задании: ${e.message}` : String(e)] };
        }
        const reward = progress.recordAttempt(task, verdict.passed);
        set({ verdict: { ...verdict, at: Date.now(), reward }, taskTab: 'task' });
        announce(reward);
        return;
      }

      await withSandbox(async ({ engine, checker }) => {
        if (get().task?.id !== task.id) return;
        print('cmd', 'Проверка решения…');
        const verdict = await checker.check(task, { kind: 'sql', code });
        const reward = progress.recordAttempt(task, verdict.passed);
        progress.saveDraft(task, code);
        await refreshSchema(engine);
        set({
          verdict: { ...verdict, at: Date.now(), reward },
          error: verdict.error ?? null,
          result: verdict.actual ?? get().result,
          plan: verdict.plan ?? get().plan,
          taskTab: 'task',
          ...(verdict.plan ? { tab: 'plan' as const } : verdict.actual ? { tab: 'result' as const } : {}),
        });
        if (verdict.error) printError(verdict.error);
        verdict.problems.forEach((p) => print('error', p));
        if (verdict.passed) print('ok', reward ? `Решение принято: +${reward.xp} XP` : 'Решение принято');
        announce(reward);
      });
    },

    revealHint: () => {
      const { task } = get();
      if (!task || selectTask(task)(useProgress.getState()).hintsUsed >= task.hints.length) return;
      useProgress.getState().useHint(task);
      set({ taskTab: 'task' });
    },

    revealSolution: () => {
      const { task } = get();
      if (task) useProgress.getState().revealSolution(task);
    },

    closeTask: () => {
      saveDraft();
      set({ task: null, lesson: null, verdict: null, result: null, plan: null, error: null, schema: null });
    },

    prepare: (task) => {
      // The sandbox is about to hold another database, so the lesson task (if any) must be reopened later.
      get().closeTask();
      return withSandbox(async ({ engine }) => {
        await engine.reset(task.setupSql);
        await refreshSchema(engine);
      });
    },

    verify: async (task, answer) => {
      get().closeTask();
      let result: CheckResult = { passed: false, problems: ['Песочница недоступна'] };
      await withSandbox(async ({ engine, checker }) => {
        result = await checker.check(task, answer);
        await refreshSchema(engine);
      });
      return result;
    },
  };
});

function announce(reward: SolveReward | null): void {
  if (!reward) return;
  const { push } = useToasts.getState();
  push({ tone: 'xp', title: `+${reward.xp} XP`, body: 'Задание решено' });
  if (reward.levelUp) push({ tone: 'level', title: `Новый уровень: ${reward.levelUp}` });
  reward.badges.forEach((b) => push({ tone: 'badge', title: `Бейдж «${b.title}»`, body: b.description, glyph: b.glyph }));
}

function firstLine(code: string): string {
  const line = code.trim().split('\n')[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}
