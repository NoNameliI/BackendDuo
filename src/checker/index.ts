import type { ChoiceTask, SqlTask, Task } from '@/content/loadCourse';
import type { ExecOutcome, QueryPlan, SandboxEngine, SchemaInfo, SqlError, StatementResult } from '@/engine';
import { compareResults } from './compareResults';
import { diffSchemas } from './diffSchemas';
import { evaluatePlan } from './evaluatePlan';

export type Answer = { kind: 'sql'; code: string } | { kind: 'choice'; selected: number[] };

export interface CheckResult {
  passed: boolean;
  problems: string[];
  /** SQL error raised by the learner's code. */
  error?: SqlError;
  expected?: StatementResult;
  actual?: StatementResult;
  plan?: QueryPlan;
}

/** Raised when the reference solution itself fails: a content bug, not a learner mistake. */
export class SolutionError extends Error {}

const tables = (out: ExecOutcome) => out.results.filter((r) => r.columns.length > 0);
const pass = (extra: Partial<CheckResult> = {}): CheckResult => ({ passed: true, problems: [], ...extra });
const fail = (problems: string[], extra: Partial<CheckResult> = {}): CheckResult => ({ passed: false, problems, ...extra });
const verdict = (problems: string[], extra: Partial<CheckResult> = {}) =>
  problems.length === 0 ? pass(extra) : fail(problems, extra);

const NO_TABLE = 'Код не вернул таблицу результата — нужен запрос SELECT';

interface PlanReference {
  baselineCost: number;
  result: StatementResult;
}

/**
 * Deterministic answer checker. Every SQL check runs on a freshly reset database; expected outcomes are
 * produced by the task's reference solution and cached per task. After a check the sandbox holds the
 * learner's state (setup + their code).
 */
export function createChecker(engine: SandboxEngine) {
  const cache = new Map<string, Promise<unknown>>();

  const reference = <T>(task: Task, compute: () => Promise<T>): Promise<T> => {
    let value = cache.get(task.id) as Promise<T> | undefined;
    if (!value) {
      value = compute();
      cache.set(task.id, value);
      value.catch(() => cache.delete(task.id));
    }
    return value;
  };

  const runSolution = async (task: SqlTask, sql: string): Promise<ExecOutcome> => {
    await engine.reset(task.setupSql);
    const out = await engine.execute(sql);
    if (out.error) throw new SolutionError(`${task.id}: эталонное решение упало: ${out.error.message}`);
    return out;
  };

  const runLearner = async (task: SqlTask, code: string) => {
    await engine.reset(task.setupSql);
    return engine.execute(code);
  };

  async function checkResult(task: Extract<SqlTask, { type: 'result' }>, code: string): Promise<CheckResult> {
    const expected = await reference(task, async () => {
      const table = tables(await runSolution(task, task.solution)).at(-1);
      if (!table) throw new SolutionError(`${task.id}: эталонное решение не возвращает таблицу`);
      return table;
    });
    const out = await runLearner(task, code);
    if (out.error) return fail([], { error: out.error, expected });
    const actual = tables(out).at(-1);
    if (!actual) return fail([NO_TABLE], { expected });
    return verdict(compareResults(expected, actual, task.check), { expected, actual });
  }

  async function checkState(task: Extract<SqlTask, { type: 'state' }>, code: string): Promise<CheckResult> {
    const expected = await reference(task, async () => {
      await runSolution(task, task.solution);
      const out = await engine.execute(task.checkSql);
      if (out.error) throw new SolutionError(`${task.id}: проверочный запрос упал: ${out.error.message}`);
      return tables(out);
    });
    const out = await runLearner(task, code);
    if (out.error) return fail([], { error: out.error });
    const probe = await engine.execute(task.checkSql);
    if (probe.error) return fail([`Не удалось прочитать данные для проверки: ${probe.error.message}`]);
    const actual = tables(probe);
    const problems = expected.flatMap((e, i) =>
      actual[i] ? compareResults(e, actual[i], task.check) : ['Проверочный запрос не вернул таблицу'],
    );
    return verdict(problems, { expected: expected.at(-1), actual: actual.at(-1) });
  }

  async function checkSchema(task: Extract<SqlTask, { type: 'schema' }>, code: string): Promise<CheckResult> {
    const expected = await reference<SchemaInfo>(task, async () => {
      await runSolution(task, task.solution);
      return engine.introspect();
    });
    const out = await runLearner(task, code);
    if (out.error) return fail([], { error: out.error });
    return verdict(diffSchemas(expected, await engine.introspect(), task.check));
  }

  async function checkPlan(task: Extract<SqlTask, { type: 'plan' }>, code: string): Promise<CheckResult> {
    const ref = await reference<PlanReference>(task, async () => {
      await engine.reset(task.setupSql);
      const baseline = await engine.explain(task.query);
      if (baseline.error) throw new SolutionError(`${task.id}: исходный запрос упал: ${baseline.error.message}`);
      const out = await engine.execute(task.query);
      const result = tables(out).at(-1);
      if (out.error || !result) throw new SolutionError(`${task.id}: исходный запрос не вернул таблицу`);
      return { baselineCost: baseline.plan.root.totalCost, result };
    });

    const out = await runLearner(task, code);
    if (out.error) return fail([], { error: out.error });
    const problems: string[] = [];
    let actual: StatementResult | undefined;

    if (task.check.mode === 'query') {
      actual = tables(out).at(-1);
      if (!actual) return fail([NO_TABLE]);
      problems.push(...compareResults(ref.result, actual, { ordered: false, columnNames: true }));
    }
    // Planner settings changed by the learner (e.g. enable_seqscan) must not influence the verdict.
    await engine.execute('RESET ALL; ANALYZE');
    const explained = await engine.explain(task.check.mode === 'query' ? code : task.query);
    if (explained.error) return fail([], { error: explained.error });

    if (task.check.mode === 'ddl') {
      const probe = await engine.execute(task.query);
      actual = tables(probe).at(-1);
      if (!actual || compareResults(ref.result, actual, { ordered: false, columnNames: true }).length > 0) {
        problems.push('Результат запроса изменился — оптимизация не должна менять данные');
      }
    }
    problems.push(...evaluatePlan(explained.plan, ref.baselineCost, task.check));
    return verdict(problems, { plan: explained.plan, expected: ref.result, actual });
  }

  function checkChoice(task: ChoiceTask, selected: number[]): CheckResult {
    const want = [...task.answer].sort().join();
    const got = [...new Set(selected)].sort().join();
    return want === got ? pass() : fail(['Ответ неверный']);
  }

  return {
    async check(task: Task, answer: Answer): Promise<CheckResult> {
      if (task.type === 'choice' || task.type === 'review') {
        if (answer.kind !== 'choice') throw new Error(`${task.id}: ожидался выбор варианта`);
        return checkChoice(task, answer.selected);
      }
      if (answer.kind !== 'sql') throw new Error(`${task.id}: ожидался SQL`);
      switch (task.type) {
        case 'result':
          return checkResult(task, answer.code);
        case 'state':
          return checkState(task, answer.code);
        case 'schema':
          return checkSchema(task, answer.code);
        case 'plan':
          return checkPlan(task, answer.code);
      }
    },
  };
}

export type Checker = ReturnType<typeof createChecker>;
