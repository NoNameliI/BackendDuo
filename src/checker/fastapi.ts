import type { PythonTask } from '@/content/loadCourse';
import { explain422 } from '@/engine/api/explain';
import { sameJson } from './api';
import { bodyValue as json, differentHeaders, parseRequest, splitUrl, type ApiRequest } from '@/engine/api/http';
import { splitRequests } from '@/engine/api/server';
import { explainPythonError } from '@/engine/python/explain';
import { asProject, type AppRun, type Project, type ProjectFiles, type PyResponse } from '@/engine/python/runtime';
import { SolutionError, type CheckResult } from './index';

/** Tasks whose check sends the hidden requests to the learner's project and to the reference. */
export type FastapiTask = Extract<PythonTask, { type: 'fastapi' | 'fix-bug' | 'refactor' }>;

/** Runs a project with the lazy package groups it needs; `reference` = the course's own code (a clean worker). */
export type ProjectRunner = (project: Project | string, requests: ApiRequest[], options?: { keep?: boolean; reference?: boolean; groups?: string[] }) => Promise<AppRun>;

/** The files of the task's project as the content gives them (tests built by hand may only have `pythonSolution`). */
const specOf = (task: PythonTask) => task.project ?? { entry: 'main.py', starter: { 'main.py': task.pythonStarter ?? '' }, solution: { 'main.py': task.pythonSolution } };

/** Paths the learner cannot edit take the solution's text, whatever the submitted project says. */
export function lockReadonly(task: PythonTask, files: ProjectFiles): ProjectFiles {
  const out = { ...files };
  const { solution } = specOf(task);
  for (const path of task.readonly ?? []) {
    if (path in solution) out[path] = solution[path];
    else delete out[path];
  }
  return out;
}

/** Modules the learner's files would shadow: a package next to a read-only module, or a module next to a read-only package. */
export function shadowProblems(task: PythonTask, files: ProjectFiles): string[] {
  const locked = task.readonly ?? [];
  const out: string[] = [];
  for (const own of Object.keys(files)) {
    if (locked.includes(own)) continue;
    for (const ro of locked) {
      const dirs = ro.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'));
      const asModule = ro.endsWith('.py') && !ro.endsWith('/__init__.py') ? ro.slice(0, -3) : null;
      const clash = (asModule !== null && own.startsWith(`${asModule}/`)) || (own.endsWith('.py') && dirs.includes(own.slice(0, -3)));
      if (clash) out.push(`Файл «${own}» перекрывает модуль «${ro}», который менять нельзя: переименуйте или удалите «${own}»`);
    }
  }
  return out.slice(0, 3);
}

/** The reference project. */
export const solutionProject = (task: PythonTask): Project => ({ files: specOf(task).solution, entry: specOf(task).entry });

/** What the learner starts with (the read-only files as in the solution). */
export const starterProject = (task: PythonTask): Project => ({ files: lockReadonly(task, specOf(task).starter), entry: specOf(task).entry });

/** The solution with the files of a wrong variant replaced or added. */
export const wrongProject = (task: PythonTask, id: string): Project => ({ files: { ...specOf(task).solution, ...task.pythonWrong[id] }, entry: specOf(task).entry });

/** Package groups a task needs: its `packages`, plus pytest and TestClient for pytest tasks and projects with tests/. */
export function pythonGroups(task: PythonTask): string[] {
  const { starter, solution } = specOf(task);
  const tests = task.type === 'pytest' || [...Object.keys(starter), ...Object.keys(solution)].some((p) => p.startsWith('tests/'));
  return [...new Set([...(task.packages ?? []), ...(tests ? ['client', 'pytest'] : [])])];
}

/** Package groups for a lesson's theory examples: everything its python tasks use. */
export function lessonGroups(tasks: readonly object[]): string[] {
  return [...new Set(tasks.flatMap((t) => ('project' in t ? pythonGroups(t as PythonTask) : [])))];
}

/** The learner's project as the check sees it: read-only files restored, the entry kept. */
export function learnerProject(task: PythonTask, input: Project | string): Project {
  const project = asProject(input);
  return { files: lockReadonly(task, project.files), entry: project.entry ?? specOf(task).entry };
}

const verdict = (problems: string[]): CheckResult => ({ passed: problems.length === 0, problems });

/** The test requests of a task; a malformed one is a content bug. */
export function testRequests(task: FastapiTask): ApiRequest[] {
  try {
    return splitRequests(task.httpTests).map(parseRequest);
  } catch (e) {
    throw new SolutionError(`${task.id}: тестовый запрос не читается: ${(e as Error).message}`);
  }
}

const label = (req: ApiRequest) => {
  const { path, query } = splitUrl(req.url);
  return `${req.method} ${path}${query.length ? `?${query.map(([k, v]) => `${k}=${v}`).join('&')}` : ''}`;
};

const short = (v: unknown) => {
  const text = typeof v === 'string' ? `«${v}»` : JSON.stringify(v);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
};

/** Why the learner's answer differs, in a sentence or two. */
function difference(req: ApiRequest, want: PyResponse, got: PyResponse, task: FastapiTask): string | null {
  const at = `Запрос ${label(req)}`;
  if (got.error) return `${at}: ${explainPythonError(got.error)}`;
  if (want.status !== got.status) {
    let why = '';
    if (got.status === 422) why = ` ${(explain422(got.body) ?? []).join('; ')}`;
    else if (got.status === 404 && short(json(got.body)) === '{"detail":"Not Found"}') why = ' Такого маршрута нет: проверьте метод в декораторе (@app.get, @app.post…) и путь.';
    else if (got.status === 405) why = ' Путь есть, но с другим методом: проверьте декоратор.';
    return `${at}: ожидается код ${want.status}, приложение ответило ${got.status}.${why}`;
  }
  if (want.status === 422) {
    // Validation rules can be written in several equivalent ways (gt=0 or ge=1): what matters is which inputs failed.
    const where = (body: string) => {
      const detail = (json(body) as { detail?: { loc?: unknown[] }[] } | null)?.detail;
      return Array.isArray(detail) ? [...new Set(detail.map((d) => (d.loc ?? []).join('.')))].sort() : [];
    };
    const w = where(want.body);
    const g = where(got.body);
    if (w.join() !== g.join()) return `${at}: проверка отклонила ${g.length ? g.map((x) => `«${x}»`).join(', ') : 'не те данные'}, а должна отклонить ${w.map((x) => `«${x}»`).join(', ')}`;
    return null;
  }
  if (task.check.body === 'json' && !sameJson(json(want.body), json(got.body))) {
    return `${at}: ответ ${short(json(got.body))}, а ожидается ${short(json(want.body))}`;
  }
  const [header] = differentHeaders(task.check.headers, want.headers, got.headers);
  if (header) return `${at}: заголовок ${header.name} ${header.got === undefined ? 'не передан' : `«${header.got}»`}, а ожидается «${header.want}»`;
  return null;
}

// The reference app's answers do not change: computed once per task and solution text.
const expected = new Map<string, Promise<AppRun>>();

/** Reference answers of the hidden requests (cached); a broken reference is a content bug. */
async function referenceRun(task: FastapiTask, requests: ApiRequest[], run: ProjectRunner, groups: string[]): Promise<AppRun> {
  const project = solutionProject(task);
  const key = `${task.id}\n${JSON.stringify(project.files)}`;
  if (!expected.has(key)) expected.set(key, run(project, requests, { reference: true, groups }));
  let want: AppRun;
  try {
    want = await expected.get(key)!;
  } catch (e) {
    expected.delete(key);
    throw e;
  }
  if (!want.load.ok) throw new SolutionError(`${task.id}: эталонное приложение не запускается: ${want.load.error.type}: ${want.load.error.message}`);
  const broken = want.responses.findIndex((r) => r.error);
  if (broken !== -1) throw new SolutionError(`${task.id}: эталон падает на ${label(requests[broken])}: ${want.responses[broken].error!.message}`);
  return want;
}

/**
 * `fastapi`, `fix-bug` and `refactor` tasks: the learner's project answers the hidden test requests exactly like the
 * reference (status, JSON body, listed headers); code rules come first, so a forbidden shortcut is named as such.
 */
export async function checkFastapi(task: FastapiTask, input: Project | string, run: ProjectRunner, options: { groups?: string[] } = {}): Promise<CheckResult> {
  const groups = options.groups ?? pythonGroups(task);
  const learner = learnerProject(task, input);
  const entry = learner.entry ?? 'main.py';
  const problems: string[] = [];
  const code = Object.entries(learner.files).filter(([path]) => !path.startsWith('tests/')).map(([, text]) => text).join('\n');
  for (const rule of task.check.code) {
    const found = new RegExp(rule.pattern, 'm').test(code);
    if (found === rule.forbid) problems.push(rule.message);
  }
  if (problems.length) return verdict(problems);

  const requests = testRequests(task);
  const want = await referenceRun(task, requests, run, groups);

  if (!learner.files[entry]?.trim()) return verdict([`${entry} пуст: напишите приложение FastAPI`]);
  const got = await run(learner, requests, { groups });
  if (!got.load.ok) return verdict([explainPythonError(got.load.error)]);
  requests.forEach((req, i) => {
    const diff = difference(req, want.responses[i], got.responses[i], task);
    if (diff && problems.length < 3) problems.push(diff);
  });
  return verdict(problems);
}
