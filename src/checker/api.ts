import type { ApiTask } from '@/content/loadCourse';
import { findHeader, mediaType, parseRequest, RequestFormatError, splitUrl, type ApiRequest } from '@/engine/api/http';
import { SolutionError, type CheckResult } from './index';

const verdict = (problems: string[]): CheckResult => ({ passed: problems.length === 0, problems });
const show = (v: unknown) => (typeof v === 'string' ? `«${v}»` : JSON.stringify(v));

/** The reference request of a task; a malformed one is a content bug. */
export function referenceRequest(task: ApiTask): ApiRequest {
  try {
    return parseRequest(task.httpSolution);
  } catch (e) {
    throw new SolutionError(`${task.id}: эталонный запрос не читается: ${(e as Error).message}`);
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.join() === kb.join() && ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

/** Differences between two JSON bodies, field by field at the top level. */
function compareJson(want: unknown, got: unknown): string[] {
  if (sameJson(want, got)) return [];
  const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(want) || !isObject(got)) return [`Тело запроса: ожидается ${JSON.stringify(want)}, у вас ${JSON.stringify(got)}`];
  const problems: string[] = [];
  for (const key of Object.keys(want)) {
    if (!(key in got)) problems.push(`В теле запроса нет поля ${show(key)}`);
    else if (!sameJson(want[key], got[key])) problems.push(`Поле ${show(key)}: ожидается ${JSON.stringify(want[key])}, у вас ${JSON.stringify(got[key])}`);
  }
  for (const key of Object.keys(got)) if (!(key in want)) problems.push(`В теле запроса лишнее поле ${show(key)}`);
  return problems;
}

/** `request` task: the request built in the composer matches the reference request. */
export function checkRequest(task: Extract<ApiTask, { type: 'request' }>, sent: ApiRequest): CheckResult {
  const want = referenceRequest(task);
  const problems: string[] = [];
  if (sent.method.toUpperCase() !== want.method) problems.push(`Метод: ожидается ${want.method}, у вас ${sent.method.toUpperCase()}`);

  const w = splitUrl(want.url);
  const g = splitUrl(sent.url);
  if (w.origin && g.origin && w.origin !== g.origin) problems.push(`Адрес сервера: ожидается ${w.origin}, у вас ${g.origin}`);
  if (w.path !== g.path) problems.push(`Путь: ожидается ${w.path}, у вас ${g.path || '(пусто)'}`);
  if (task.check.query === 'exact') {
    const key = ([k, v]: [string, string]) => `${k}=${v}`;
    const wantQ = w.query.map(key).sort();
    const gotQ = g.query.map(key).sort();
    for (const [k, v] of w.query) {
      const mine = g.query.filter(([gk]) => gk === k);
      if (!mine.length) problems.push(`В адресе нет параметра ${k}=${v}`);
      else if (!mine.some(([, gv]) => gv === v)) problems.push(`Параметр ${k}: ожидается ${show(v)}, у вас ${mine.map(([, gv]) => show(gv)).join(', ')}`);
    }
    for (const [k] of g.query) if (!w.query.some(([wk]) => wk === k)) problems.push(`Лишний параметр в адресе: ${k}`);
    if (!problems.length && wantQ.join('&') !== gotQ.join('&')) problems.push('Параметры адреса отличаются от ожидаемых');
  }

  for (const name of task.check.headers) {
    const wantValue = findHeader(want.headers, name);
    const gotValue = findHeader(sent.headers, name);
    if (gotValue === undefined) {
      problems.push(`Нет заголовка ${name}`);
      continue;
    }
    const same = name.toLowerCase() === 'content-type' ? mediaType(wantValue) === mediaType(gotValue) : wantValue?.trim() === gotValue.trim();
    if (!same) problems.push(`Заголовок ${name}: ожидается ${show(wantValue)}, у вас ${show(gotValue)}`);
  }

  if (task.check.body === 'json') {
    if (!want.body.trim()) {
      if (sent.body.trim()) problems.push('У этого запроса не должно быть тела');
    } else if (!sent.body.trim()) problems.push('Нужно тело запроса в формате JSON');
    else {
      let got: unknown;
      try {
        got = JSON.parse(sent.body);
      } catch (e) {
        problems.push(`Тело запроса — некорректный JSON: ${(e as Error).message}. Проверьте кавычки вокруг ключей и строк и запятые между полями`);
        return verdict(problems);
      }
      problems.push(...compareJson(JSON.parse(want.body), got));
    }
  } else if (task.check.body === 'text' && want.body.trim() !== sent.body.trim()) {
    problems.push('Тело запроса отличается от ожидаемого');
  }
  return verdict(problems);
}

/** Reads the request text a learner (or the validation) submits; format errors become a readable problem. */
export function readRequest(text: string): ApiRequest | CheckResult {
  try {
    return parseRequest(text);
  } catch (e) {
    if (e instanceof RequestFormatError) return verdict([`Запрос не читается: ${e.message}`]);
    throw e;
  }
}
