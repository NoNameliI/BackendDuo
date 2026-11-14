import type { PythonTask } from '@/content/loadCourse';
import type { ApiRequest } from '@/engine/api/http';
import { explainPythonError, explainPytest } from '@/engine/python/explain';
import type { AnalyzeResult, AppRun, Project, ProjectFiles, PytestCase, PytestRun, StaticRule } from '@/engine/python/runtime';
import { checkFastapi, learnerProject, pythonGroups, shadowProblems, solutionProject, type FastapiTask } from './fastapi';
import { SolutionError, type CheckResult } from './index';
import { compareOpenapi, routeSet } from './openapiCompare';

/** What the checks need from Python: the app's worker client in the UI, the Node runtime in validate:content. */
export interface CourseRuntime {
  run(project: Project, requests: ApiRequest[], options?: { keep?: boolean; reference?: boolean; groups?: string[] }): Promise<AppRun>;
  test(project: Project, options?: { reference?: boolean; groups?: string[] }): Promise<PytestRun>;
  analyze(project: Project, rules: StaticRule[], options?: { reference?: boolean }): Promise<AnalyzeResult>;
}

const verdict = (problems: string[]): CheckResult => ({ passed: problems.length === 0, problems });
const OPENAPI: ApiRequest = { method: 'GET', url: '/openapi.json', headers: [], body: '' };
const underTests = (path: string) => path.startsWith('tests/');
const pick = (files: ProjectFiles, keep: (path: string) => boolean): ProjectFiles => Object.fromEntries(Object.entries(files).filter(([path]) => keep(path)));

/** The reference's /openapi.json, computed once per task and solution. */
const specs = new Map<string, Promise<unknown>>();

type Spec = { spec: unknown } | { problems: string[] };

async function readSpec(project: Project, runtime: CourseRuntime, groups: string[], reference: boolean): Promise<Spec> {
  const run = await runtime.run(project, [OPENAPI], { reference, groups });
  if (!run.load.ok) return { problems: [explainPythonError(run.load.error)] };
  const res = run.responses[0];
  if (res.error) return { problems: [`Приложение упало при запросе /openapi.json: ${explainPythonError(res.error)}`] };
  if (res.status !== 200) return { problems: [`Приложение ответило на /openapi.json кодом ${res.status}: документация недоступна`] };
  try {
    return { spec: JSON.parse(res.body) };
  } catch {
    return { problems: ['Приложение вернуло на /openapi.json не JSON'] };
  }
}

async function referenceSpec(task: PythonTask, runtime: CourseRuntime, groups: string[]): Promise<unknown> {
  const project = solutionProject(task);
  const key = `${task.id}\n${JSON.stringify(project.files)}`;
  if (!specs.has(key)) {
    specs.set(
      key,
      readSpec(project, runtime, groups, true).then((out) => {
        if ('problems' in out) throw new SolutionError(`${task.id}: эталон не отдаёт документацию: ${out.problems.join(' ')}`);
        return out.spec;
      }),
    );
  }
  try {
    return await specs.get(key)!;
  } catch (e) {
    specs.delete(key);
    throw e;
  }
}

const firstLine = (text: string) => text.split('\n').map((l) => l.replace(/^E\s{0,3}/, '').trim()).find(Boolean) ?? '';

/** One failed case of a pytest run, in a sentence with the hint when there is one. */
function describeCase(c: PytestCase): string {
  const name = c.nodeid.replace(/^tests\//, '');
  const hint = explainPytest(c);
  const what = c.outcome === 'error' ? 'не запустился' : 'не прошёл';
  return `Тест ${name} ${what}: ${firstLine(c.message) || 'без сообщения'}${hint ? `. ${hint}` : ''}`;
}

/** Why a run of the learner's tests is not a pass, or [] when it is one. */
function testProblems(run: PytestRun, minTests: number): string[] {
  const failing = run.tests.filter((c) => c.outcome === 'failed' || c.outcome === 'error');
  if (failing.length) return failing.slice(0, 3).map(describeCase);
  if (run.exit === 5) return [explainPytest(run) ?? 'pytest не нашёл тестов'];
  if (run.exit !== 0) return [`pytest завершился с кодом ${run.exit}: ${firstLine(run.output.split('\n').filter((l) => /error/i.test(l)).at(-1) ?? '') || 'проверьте файлы с тестами'}`];
  if (run.counts.passed < minTests) return [`Нужно не меньше ${minTests} ${minTests === 1 ? 'теста' : 'тестов'}, прошло ${run.counts.passed}`];
  return [];
}

/**
 * `pytest` task: the learner's tests (files under tests/) run against the reference app (the solution's files outside
 * tests/); they must pass, and fail on every mutant of the app.
 */
async function checkPytest(task: Extract<PythonTask, { type: 'pytest' }>, learner: Project, runtime: CourseRuntime): Promise<CheckResult> {
  const groups = pythonGroups(task);
  const reference = solutionProject(task);
  const app = pick(reference.files, (p) => !underTests(p));
  const tests = pick(learner.files, underTests);
  const entry = reference.entry;
  // Tests may only talk to the app through its API (not read its source): such tests would "catch" every mutant.
  const api = await runtime.analyze({ files: { ...app, ...tests }, entry }, [{ rule: 'tests-api-only' } as unknown as StaticRule], { reference: true });
  if (api.problems.length) return verdict(api.problems);
  const base = await runtime.test({ files: { ...app, ...tests }, entry }, { groups });
  const problems = testProblems(base, task.check.minTests);
  if (problems.length) return verdict(problems);

  // After every mutant the reference runs again: state that survives between runs (a counter in builtins, a file)
  // would let the first run pass and make every later one "catch" a mutant.
  const order = 'Тесты зависят от порядка запуска или прошлых запусков: после запуска на мутанте они перестали проходить на исходном приложении';
  const missed: string[] = [];
  for (const [id, overlay] of Object.entries(task.pythonMutants)) {
    const run = await runtime.test({ files: { ...app, ...overlay, ...tests }, entry }, { groups });
    if (run.exit === 0) missed.push(task.mutants[id] ?? id);
    const again = await runtime.test({ files: { ...app, ...tests }, entry }, { groups });
    if (testProblems(again, task.check.minTests).length) return verdict([order]);
  }
  return verdict(missed.slice(0, 2).map((what) => `Тесты не заметили ошибку: ${what}`));
}

/**
 * Checks a learner's project against a Python project task. Static rules run first and stop the check; then the
 * type's own check. Every run of the course's own code (reference app, analysis) uses `reference: true`.
 */
export async function checkPythonTask(task: PythonTask, input: Project | string, runtime: CourseRuntime): Promise<CheckResult> {
  const learner = learnerProject(task, input);
  const shadow = shadowProblems(task, learner.files);
  if (shadow.length) return verdict(shadow);
  const rules = task.check.static as StaticRule[];
  if (rules.length) {
    const found = await runtime.analyze(learner, rules, { reference: true });
    if (found.problems.length) return verdict(found.problems);
  }
  const groups = pythonGroups(task);
  switch (task.type) {
    case 'static': {
      const code = Object.entries(learner.files).filter(([path]) => !underTests(path)).map(([, text]) => text).join('\n');
      const problems = task.check.code.flatMap((r) => (new RegExp(r.pattern, 'm').test(code) === r.forbid ? [r.message] : []));
      return verdict(problems);
    }
    case 'pytest':
      return checkPytest(task, learner, runtime);
    case 'openapi': {
      const want = await referenceSpec(task, runtime, groups);
      const got = await readSpec(learner, runtime, groups, false);
      if ('problems' in got) return verdict(got.problems);
      return verdict(compareOpenapi(want, got.spec, task.check.compare));
    }
    case 'refactor': {
      const want = await referenceSpec(task, runtime, groups);
      const got = await readSpec(learner, runtime, groups, false);
      if ('problems' in got) return verdict(got.problems);
      const wantRoutes = routeSet(want);
      const gotRoutes = routeSet(got.spec);
      const problems = [
        ...wantRoutes.filter((r) => !gotRoutes.includes(r)).map((r) => `Маршрут ${r} пропал: после рефакторинга набор маршрутов должен остаться прежним`),
        ...gotRoutes.filter((r) => !wantRoutes.includes(r)).map((r) => `Появился лишний маршрут ${r}`),
      ];
      if (problems.length) return verdict(problems.slice(0, 3));
      return checkFastapi(task as FastapiTask, learner, (project, requests, options) => runtime.run(asProjectOnly(project), requests, options));
    }
    default:
      return checkFastapi(task as FastapiTask, learner, (project, requests, options) => runtime.run(asProjectOnly(project), requests, options));
  }
}

const asProjectOnly = (p: Project | string): Project => (typeof p === 'string' ? { files: { 'main.py': p } } : p);
