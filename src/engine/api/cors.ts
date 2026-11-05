import { findHeader, mediaType, splitUrl, type ApiRequest, type ApiResponse, type Exchange, type HttpHeader } from './http';
import type { CorsConfig, HttpSimServer } from './server';

/**
 * CORS on both sides. The server side follows Starlette's CORSMiddleware (what FastAPI uses); the browser
 * side follows the Fetch standard as Chromium reports it. Everything is computed, nothing is sent.
 */
const SAFELISTED = ['accept', 'accept-language', 'content-language', 'content-type'];
const SIMPLE_METHODS = ['GET', 'HEAD', 'POST'];
const SIMPLE_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
const ALL_METHODS = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'];

const lower = (v: string[]) => v.map((s) => s.toLowerCase());

function originAllowed(cfg: CorsConfig, origin: string): boolean {
  return cfg.allowOrigins.includes('*') || cfg.allowOrigins.includes(origin);
}

/** Server side: wraps a server answer the way CORSMiddleware(allow_origins=…, …) does. */
export function serveWithCors(cfg: CorsConfig | undefined, req: ApiRequest, next: (req: ApiRequest) => ApiResponse): ApiResponse {
  const origin = findHeader(req.headers, 'Origin');
  if (!cfg || !origin) return next(req);
  const allowAll = cfg.allowOrigins.includes('*');
  const credentials = Boolean(cfg.allowCredentials);
  const methods = cfg.allowMethods.includes('*') ? ALL_METHODS : cfg.allowMethods.map((m) => m.toUpperCase());
  const allowAllHeaders = cfg.allowHeaders.includes('*');
  const allowedHeaders = [...new Set([...SAFELISTED, ...lower(cfg.allowHeaders)])].sort();
  const requestedMethod = findHeader(req.headers, 'Access-Control-Request-Method');

  if (req.method.toUpperCase() === 'OPTIONS' && requestedMethod) {
    const headers: HttpHeader[] = [];
    const failures: string[] = [];
    if (originAllowed(cfg, origin)) headers.push({ name: 'access-control-allow-origin', value: allowAll && !credentials ? '*' : origin });
    else failures.push('origin');
    if (!methods.includes(requestedMethod.toUpperCase())) failures.push('method');
    const requested = (findHeader(req.headers, 'Access-Control-Request-Headers') ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    if (!allowAllHeaders && requested.some((h) => !allowedHeaders.includes(h))) failures.push('headers');
    headers.push({ name: 'access-control-allow-methods', value: methods.join(', ') });
    headers.push({ name: 'access-control-max-age', value: String(cfg.maxAge ?? 600) });
    headers.push({ name: 'access-control-allow-headers', value: allowAllHeaders ? requested.join(', ') : allowedHeaders.map((h) => h.replace(/(^|-)([a-z])/g, (_, s: string, c: string) => s + c.toUpperCase())).join(', ') });
    if (credentials) headers.push({ name: 'access-control-allow-credentials', value: 'true' });
    headers.push({ name: 'vary', value: 'Origin' });
    if (failures.length) {
      return { status: 400, headers: [{ name: 'content-type', value: 'text/plain; charset=utf-8' }, ...headers], body: `Disallowed CORS ${failures.join(', ')}`, timeMs: 3 };
    }
    return { status: 200, headers: [{ name: 'content-type', value: 'text/plain; charset=utf-8' }, ...headers], body: 'OK', timeMs: 3 };
  }

  const res = next(req);
  if (!originAllowed(cfg, origin)) return res;
  const extra: HttpHeader[] = [{ name: 'access-control-allow-origin', value: allowAll && !credentials ? '*' : origin }];
  if (!(allowAll && !credentials)) extra.push({ name: 'vary', value: 'Origin' });
  if (credentials) extra.push({ name: 'access-control-allow-credentials', value: 'true' });
  if (cfg.exposeHeaders?.length) extra.push({ name: 'access-control-expose-headers', value: cfg.exposeHeaders.join(', ') });
  return { ...res, headers: [...res.headers, ...extra] };
}

/** Is it a "simple" request that the browser sends without asking first? */
export function isSimpleRequest(req: ApiRequest): boolean {
  if (!SIMPLE_METHODS.includes(req.method.toUpperCase())) return false;
  return req.headers.every((h) => {
    const name = h.name.toLowerCase();
    if (!SAFELISTED.includes(name)) return false;
    return name !== 'content-type' || SIMPLE_TYPES.includes(mediaType(h.value));
  });
}

/** Russian explanations of Chromium's CORS messages (the original text stays in the log). */
const EXPLAIN: [RegExp, string][] = [
  [/No 'Access-Control-Allow-Origin' header/, 'Сервер не разрешил этот origin: в ответе нет заголовка Access-Control-Allow-Origin. Добавьте origin фронтенда в allow_origins.'],
  [/is not equal to the supplied origin/, 'Сервер разрешил другой origin, не этот. Проверьте allow_origins: схема, домен и порт должны совпадать точно.'],
  [/must not be the wildcard/, 'С учётными данными (cookie) нельзя разрешать всех через «*»: перечислите конкретные origin в allow_origins.'],
  [/Access-Control-Allow-Credentials/, 'Запрос с cookie: сервер должен ответить Access-Control-Allow-Credentials: true (allow_credentials=True).'],
  [/Method .* is not allowed/, 'Метод не разрешён в preflight-ответе: добавьте его в allow_methods.'],
  [/Request header field .* is not allowed/, 'Заголовок не разрешён в preflight-ответе: добавьте его в allow_headers.'],
  [/HTTP ok status/, 'Сервер ответил на preflight (OPTIONS) ошибкой — браузер не стал отправлять сам запрос.'],
];

export const explainCors = (message: string) => EXPLAIN.find(([re]) => re.test(message))?.[1];

const DISALLOWED: Record<string, string> = {
  origin: 'origin страницы нет в allow_origins',
  method: 'метода нет в allow_methods',
  headers: 'заголовков запроса нет в allow_headers',
};

/** Why CORSMiddleware refused a preflight: it lists the reasons in the body ("Disallowed CORS origin, method"). */
function explainPreflight(res: ApiResponse): string | undefined {
  const m = /^Disallowed CORS (.+)$/.exec(res.body.trim());
  if (!m) return undefined;
  const reasons = m[1].split(',').map((r) => DISALLOWED[r.trim()] ?? r.trim());
  return `Сервер отклонил preflight-запрос: ${reasons.join(', ')}. Браузер не стал отправлять сам запрос.`;
}

function checkAllowOrigin(res: ApiResponse, origin: string, credentials: boolean): string | null {
  const acao = findHeader(res.headers, 'Access-Control-Allow-Origin');
  if (!acao) return "No 'Access-Control-Allow-Origin' header is present on the requested resource.";
  if (acao === '*' && credentials) {
    return "The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'.";
  }
  if (acao !== '*' && acao !== origin) return `The 'Access-Control-Allow-Origin' header has a value '${acao}' that is not equal to the supplied origin.`;
  if (credentials && findHeader(res.headers, 'Access-Control-Allow-Credentials') !== 'true') {
    return `The value of the 'Access-Control-Allow-Credentials' header in the response is '${findHeader(res.headers, 'Access-Control-Allow-Credentials') ?? ''}' which must be 'true' when the request's credentials mode is 'include'.`;
  }
  return null;
}

export interface BrowserFetch {
  /** Origin of the page that calls fetch, e.g. https://shop.local:3000. */
  origin: string;
  request: ApiRequest;
  /** credentials: 'include' — send cookies. */
  credentials?: boolean;
}

/**
 * The page at `origin` calls fetch(request): the browser adds Origin, sends a preflight when needed and
 * decides whether the page may read the answer. Returns the exchanges the network log shows.
 */
export function browserFetch(server: HttpSimServer, cfg: CorsConfig | undefined, call: BrowserFetch): Omit<Exchange, 'id'>[] {
  const { origin, request, credentials = false } = call;
  const target = splitUrl(request.url).origin || server.def.baseUrl;
  const url = splitUrl(request.url).origin ? request.url : `${target}${request.url}`;
  const handle = (req: ApiRequest) => serveWithCors(cfg, req, (r) => server.handle(r));
  const withOrigin: ApiRequest = { ...request, url, headers: [...request.headers, { name: 'Origin', value: origin }] };
  const blocked = (reason: string) => `Access to fetch at '${url}' from origin '${origin}' has been blocked by CORS policy: ${reason}`;

  if (target === origin) {
    return [{ kind: 'request', origin, request: { ...request, url }, response: server.handle({ ...request, url }) }];
  }

  const exchanges: Omit<Exchange, 'id'>[] = [];
  if (!isSimpleRequest(request)) {
    const asked = request.headers.map((h) => h.name.toLowerCase()).filter((h) => !SAFELISTED.includes(h) || (h === 'content-type' && !SIMPLE_TYPES.includes(mediaType(findHeader(request.headers, h)))));
    const preflight: ApiRequest = {
      method: 'OPTIONS',
      url,
      headers: [
        { name: 'Origin', value: origin },
        { name: 'Access-Control-Request-Method', value: request.method.toUpperCase() },
        ...(asked.length ? [{ name: 'Access-Control-Request-Headers', value: [...new Set(asked)].sort().join(',') }] : []),
      ],
      body: '',
    };
    const res = handle(preflight);
    let reason: string | null = res.status >= 200 && res.status < 300 ? null : 'It does not have HTTP ok status.';
    reason ??= checkAllowOrigin(res, origin, credentials);
    if (!reason) {
      const methods = (findHeader(res.headers, 'Access-Control-Allow-Methods') ?? '').split(',').map((m) => m.trim().toUpperCase());
      const method = request.method.toUpperCase();
      if (!SIMPLE_METHODS.includes(method) && !methods.includes(method) && !(methods.includes('*') && !credentials)) {
        reason = `Method ${method} is not allowed by Access-Control-Allow-Methods in preflight response.`;
      }
    }
    if (!reason) {
      const allowed = lower((findHeader(res.headers, 'Access-Control-Allow-Headers') ?? '').split(',').map((h) => h.trim()));
      const missing = asked.find((h) => !allowed.includes(h) && !(allowed.includes('*') && !credentials && h !== 'authorization'));
      if (missing) reason = `Request header field ${missing} is not allowed by Access-Control-Allow-Headers in preflight response.`;
    }
    if (reason && !reason.startsWith('Method') && !reason.startsWith('Request header')) reason = `Response to preflight request doesn't pass access control check: ${reason}`;
    const explain = reason ? (explainPreflight(res) ?? explainCors(reason)) : undefined;
    exchanges.push({ kind: 'preflight', origin, request: preflight, response: res, ...(reason ? { error: blocked(reason), explain } : {}) });
    if (reason) {
      exchanges.push({ kind: 'request', origin, request: withOrigin, response: null, error: blocked(reason), explain });
      return exchanges;
    }
  }
  const res = handle(withOrigin);
  const reason = checkAllowOrigin(res, origin, credentials);
  exchanges.push({ kind: 'request', origin, request: withOrigin, response: res, ...(reason ? { error: blocked(reason), explain: explainCors(reason) } : {}) });
  return exchanges;
}

/** Did the page get a readable answer? */
export const fetchSucceeded = (exchanges: Omit<Exchange, 'id'>[]) => {
  const last = exchanges.at(-1);
  return Boolean(last?.response && !last.error);
};
