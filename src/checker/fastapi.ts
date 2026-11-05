import type { ApiTask } from '@/content/loadCourse';
import { explain422 } from '@/engine/api/explain';
import { findHeader, parseRequest, splitUrl, type ApiRequest } from '@/engine/api/http';
import { splitRequests } from '@/engine/api/server';
import { explainPythonError } from '@/engine/python/explain';
import type { AppRun, AppRunner, PyResponse } from '@/engine/python/runtime';
import { SolutionError, type CheckResult } from './index';

export type FastapiTask = Extract<ApiTask, { type: 'fastapi' }>;

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

const json = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
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
  if (task.check.body === 'json' && JSON.stringify(json(want.body)) !== JSON.stringify(json(got.body))) {
    return `${at}: ответ ${short(json(got.body))}, а ожидается ${short(json(want.body))}`;
  }
  for (const name of task.check.headers) {
    const w = findHeader(want.headers, name);
    const g = findHeader(got.headers, name);
    if (w !== g) return `${at}: заголовок ${name} ${g === undefined ? 'не передан' : `«${g}»`}, а ожидается «${w}»`;
  }
  return null;
}

// The reference app's answers do not change: computed once per task and solution text.
const expected = new Map<string, Promise<AppRun>>();

/**
 * `fastapi` task: the learner's main.py answers the hidden test requests exactly like the reference app
 * (status, JSON body, listed headers); code rules come first, so a forbidden shortcut is named as such.
 */
export async function checkFastapi(task: FastapiTask, source: string, run: AppRunner): Promise<CheckResult> {
  const problems: string[] = [];
  for (const rule of task.check.code) {
    const found = new RegExp(rule.pattern, 'm').test(source);
    if (found === rule.forbid) problems.push(rule.message);
  }
  if (problems.length) return verdict(problems);

  const requests = testRequests(task);
  const key = `${task.id}\n${task.pythonSolution}`;
  if (!expected.has(key)) expected.set(key, run(task.pythonSolution, requests));
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

  if (!source.trim()) return verdict(['main.py пуст: напишите приложение FastAPI']);
  const got = await run(source, requests);
  if (!got.load.ok) return verdict([explainPythonError(got.load.error)]);
  requests.forEach((req, i) => {
    const diff = difference(req, want.responses[i], got.responses[i], task);
    if (diff && problems.length < 3) problems.push(diff);
  });
  return verdict(problems);
}
