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
    const marks = testMarks(task.httpTests);
    return splitRequests(task.httpTests).map((text, i) => {
      const req = parseRequest(text);
      const save = marks[i]?.save ?? [];
      // The runtime reads (and never forwards) this header; see _with_saved in studio_runtime.py.
      return save.length ? { ...req, headers: [...req.headers, { name: 'x-studio-save', value: save.map(([n, f]) => `${n}=${f}`).join(',') }] } : req;
    });
  } catch (e) {
    throw new SolutionError(`${task.id}: тестовый запрос не читается: ${(e as Error).message}`);
  }
}

/**
 * What the body comparison skips for each test request, from the `###` line before it: `### ignore` skips the whole
 * body, `### ignore: access_token, expires` drops those top-level keys (values that differ between runs, like tokens).
 */
export function ignoredFields(text: string): ('*' | string[] | null)[] {
  return testMarks(text).map((m) => m.ignore);
}

export interface TestMark {
  ignore: '*' | string[] | null;
  /** `save token = access_token`: the field of this answer is kept as {{token}} for the later requests of the run. */
  save: [name: string, field: string][];
}

/** Marks on the `###` line before each test request; parts are separated by `;`. */
export function testMarks(text: string): TestMark[] {
  const marks: TestMark[] = [];
  let mark: TestMark = { ignore: null, save: [] };
  let body = false;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const sep = /^###(.*)$/.exec(line);
    if (sep) {
      if (body) marks.push(mark);
      body = false;
      mark = { ignore: null, save: [] };
      for (const part of sep[1].split(';')) {
        const ignore = /^\s*ignore\s*(?::\s*(.*))?$/.exec(part);
        if (ignore) mark.ignore = ignore[1] ? ignore[1].split(',').map((k) => k.trim()).filter(Boolean) : '*';
        const save = /^\s*save\s+(\w+)\s*=\s*(\w+)\s*$/.exec(part);
        if (save) mark.save.push([save[1], save[2]]);
      }
    } else if (line.trim()) body = true;
  }
  if (body) marks.push(mark);
  return marks;
}

/** Drops `#` comments (outside string literals) from Python source, so a code rule is not satisfied by a comment. */
export function stripPythonComments(source: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') {
        out += c + (source[i + 1] ?? '');
        i++;
        continue;
      }
      if (source.startsWith(quote, i)) {
        out += quote;
        i += quote.length - 1;
        quote = null;
        continue;
      }
      out += c;
    } else if (c === '#') {
      while (i + 1 < source.length && source[i + 1] !== '\n') i++;
    } else if (c === '"' || c === "'") {
      quote = source.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      out += quote;
      i += quote.length - 1;
    } else out += c;
  }
  return out;
}

/** The app's own code for `check.code` rules: files outside tests/, comments removed. */
export const appCode = (files: Record<string, string>) =>
  Object.entries(files)
    .filter(([path]) => !path.startsWith('tests/'))
    .map(([, text]) => stripPythonComments(text))
    .join('\n');

const dropKeys = (value: unknown, keys: string[]) =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([k]) => !keys.includes(k))) : value;

const label = (req: ApiRequest) => {
  const { path, query } = splitUrl(req.url);
  return `${req.method} ${path}${query.length ? `?${query.map(([k, v]) => `${k}=${v}`).join('&')}` : ''}`;
};

const short = (v: unknown) => {
  const text = typeof v === 'string' ? `«${v}»` : JSON.stringify(v);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
};

/** Why the learner's answer differs, in a sentence or two. */
function difference(req: ApiRequest, want: PyResponse, got: PyResponse, task: FastapiTask, ignore: '*' | string[] | null = null): string | null {
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
  if (task.check.body === 'json' && ignore !== '*') {
    const [w, g] = [json(want.body), json(got.body)].map((v) => (ignore ? dropKeys(v, ignore) : v));
    if (ignore && g && typeof g === 'object' && !Array.isArray(g)) {
      const missing = ignore.find((k) => !(k in (json(got.body) as object)));
      if (missing) return `${at}: в ответе нет поля «${missing}»`;
    }
    if (!sameJson(w, g)) return `${at}: ответ ${short(g)}, а ожидается ${short(w)}`;
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
  const code = appCode(learner.files);
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
  const ignore = ignoredFields(task.httpTests);
  requests.forEach((req, i) => {
    const diff = difference(req, want.responses[i], got.responses[i], task, ignore[i] ?? null);
    if (diff && problems.length < 3) problems.push(diff);
  });
  return verdict(problems);
}
