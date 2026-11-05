import type { ApiTask } from '@/content/loadCourse';
import { corsConfigSchema } from '@/content/schema';
import { browserFetch, explainCors, fetchSucceeded } from '@/engine/api/cors';
import { findHeader, mediaType, parseRequest, RequestFormatError, splitUrl, statusText, type ApiRequest } from '@/engine/api/http';
import { HttpSimServer, sendTo, splitRequests, type CorsConfig, type ServerDef } from '@/engine/api/server';
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
export function checkRequest(task: ApiTask, sent: ApiRequest): CheckResult {
  const want = referenceRequest(task);
  const problems: string[] = [];
  if (sent.method.toUpperCase() !== want.method) problems.push(`Метод: ожидается ${want.method}, у вас ${sent.method.toUpperCase()}`);

  const w = splitUrl(want.url);
  const g = splitUrl(sent.url);
  if (w.origin && g.origin && w.origin !== g.origin) problems.push(`Адрес сервера: ожидается ${w.origin}, у вас ${g.origin}`);
  if (w.path !== g.path) problems.push(`Путь: ожидается ${w.path}, у вас ${g.path || '(пусто)'}`);
  const check = task.type === 'request' ? task.check : { query: 'exact', headers: [], body: 'json' };
  if (check.query === 'exact') {
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

  for (const name of check.headers) {
    const wantValue = findHeader(want.headers, name);
    const gotValue = findHeader(sent.headers, name);
    if (gotValue === undefined) {
      problems.push(`Нет заголовка ${name}`);
      continue;
    }
    const same = name.toLowerCase() === 'content-type' ? mediaType(wantValue) === mediaType(gotValue) : wantValue?.trim() === gotValue.trim();
    if (!same) problems.push(`Заголовок ${name}: ожидается ${show(wantValue)}, у вас ${show(gotValue)}`);
  }

  if (check.body === 'json') {
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
  } else if (check.body === 'text' && want.body.trim() !== sent.body.trim()) {
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

/** A fresh copy of the task's server with the task's setup requests applied. */
export function freshServer(task: ApiTask, servers: Record<string, ServerDef>): HttpSimServer {
  const def = task.server ? servers[task.server] : undefined;
  if (!def) throw new SolutionError(`${task.id}: у задания нет учебного сервера`);
  const server = new HttpSimServer(def);
  if ('httpSetup' in task) for (const text of splitRequests(task.httpSetup)) server.handle(parseRequest(text));
  return server;
}

const describeBody = (body: string) => {
  try {
    const v = JSON.parse(body);
    return Array.isArray(v) ? `список из ${v.length} ${v.length === 1 ? 'записи' : 'записей'}` : JSON.stringify(v).slice(0, 120);
  } catch {
    return body ? `«${body.slice(0, 80)}»` : 'пустое тело';
  }
};

/** `response` task: the learner's request makes the server answer what the reference request makes it answer. */
export function checkResponse(task: Extract<ApiTask, { type: 'response' }>, servers: Record<string, ServerDef>, sent: ApiRequest): CheckResult {
  const wantServer = freshServer(task, servers);
  const want = sendTo(wantServer, referenceRequest(task));
  if (typeof want === 'string') throw new SolutionError(`${task.id}: ${want}`);
  const gotServer = freshServer(task, servers);
  const got = sendTo(gotServer, sent);
  if (typeof got === 'string') return verdict([got]);
  const problems: string[] = [];
  if (task.check.status && got.status !== want.status) {
    problems.push(`Сервер ответил ${got.status} ${statusText(got.status)}, а нужен ответ ${want.status} ${statusText(want.status)}`);
  }
  for (const name of task.check.headers) {
    const w = findHeader(want.headers, name);
    const g = findHeader(got.headers, name);
    if (w !== g) problems.push(`Заголовок ответа ${name}: ожидается ${show(w ?? '(нет)')}, у вас ${show(g ?? '(нет)')}`);
  }
  if (task.check.body === 'json' && !problems.length) {
    let same = want.body === got.body;
    try {
      same ||= sameJson(JSON.parse(want.body), JSON.parse(got.body));
    } catch {
      /* not JSON: text comparison above */
    }
    if (!same) problems.push(`Тело ответа не то: ожидается ${describeBody(want.body)}, а пришло ${describeBody(got.body)}`);
  }
  for (const name of task.check.state) {
    if (!sameJson(wantServer.data[name] ?? [], gotServer.data[name] ?? [])) problems.push(`Данные «${name}» на сервере после запроса отличаются от ожидаемых`);
  }
  return verdict(problems);
}

/** Reads a CORS configuration written as JSON (the task's starter/solution or the learner's form). */
export function readCorsConfig(text: string): CorsConfig {
  return corsConfigSchema.parse(JSON.parse(text)) as CorsConfig;
}

/** `cors` task: with the learner's settings the frontend works (or is blocked) and other pages stay blocked. */
export function checkCors(task: Extract<ApiTask, { type: 'cors' }>, servers: Record<string, ServerDef>, cfg: CorsConfig): CheckResult {
  const problems: string[] = [];
  const run = (origin: string, request: string, credentials: boolean) => browserFetch(freshServer(task, servers), cfg, { origin, request: parseRequest(request), credentials });
  const main = run(task.fetch.origin, task.fetch.request, task.fetch.credentials);
  const ok = fetchSucceeded(main);
  if (task.check.expect === 'allowed' && !ok) {
    const last = main.at(-1);
    problems.push(`Фронтенд ${task.fetch.origin} не получил ответ. ${last?.explain ?? explainCors(last?.error ?? '') ?? last?.error ?? ''}`);
  }
  if (task.check.expect === 'blocked' && ok) problems.push(`Страница ${task.fetch.origin} не должна получить ответ, а браузер её пропустил`);
  for (const other of task.check.mustBlock) {
    if (fetchSucceeded(run(other.origin, other.request ?? task.fetch.request, other.credentials))) {
      problems.push(`Слишком широко: страница ${other.origin} тоже получила ответ. Разрешайте только нужные origin, методы и заголовки`);
    }
  }
  return verdict(problems);
}

/** Every API task type in one place: the learner's composer draft or CORS form against the reference. */
export function checkApiTask(task: ApiTask, servers: Record<string, ServerDef>, input: { draft: ApiRequest; cors: CorsConfig | null }): CheckResult {
  switch (task.type) {
    case 'request':
      return checkRequest(task, input.draft);
    case 'response':
      return checkResponse(task, servers, input.draft);
    case 'cors':
      return input.cors ? checkCors(task, servers, input.cors) : verdict(['Настройте CORS в форме справа']);
  }
}
