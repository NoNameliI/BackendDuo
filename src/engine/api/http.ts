/**
 * HTTP as the API course uses it: plain data, no network. Requests are written in lessons as text
 *
 *   POST /orders?notify=true
 *   Content-Type: application/json
 *
 *   {"product": "Чай"}
 *
 * and edited in the request composer.
 */
export interface HttpHeader {
  name: string;
  value: string;
}

export interface ApiRequest {
  method: string;
  /** Absolute (`https://api.shop.local/orders`) or relative to the task's server (`/orders`). */
  url: string;
  headers: HttpHeader[];
  body: string;
}

export interface ApiResponse {
  status: number;
  headers: HttpHeader[];
  body: string;
  timeMs: number;
}

/** One line of the network log: a request and what came back (a preflight is its own exchange). */
export interface Exchange {
  id: number;
  kind: 'request' | 'preflight';
  /** Origin of the page that sent it, for browser (CORS) requests. */
  origin?: string;
  request: ApiRequest;
  response: ApiResponse | null;
  /** Why there is no response: the browser blocked it, the server is unknown… */
  error?: string;
  /** Exchanges caused by one send (a preflight and its request) share a group. */
  group?: number;
}

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  409: 'Conflict',
  410: 'Gone',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export const statusText = (status: number) => STATUS_TEXT[status] ?? '';

export function findHeader(headers: HttpHeader[], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value;
}

export class RequestFormatError extends Error {}

/** Parses the text form of a request; the first line is `METHOD URL`, headers follow, a blank line opens the body. */
export function parseRequest(text: string): ApiRequest {
  const lines = text.replace(/\r\n?/g, '\n').replace(/^\n+/, '').split('\n');
  const first = (lines.shift() ?? '').trim();
  const match = /^([A-Za-z]+)\s+(\S+)(?:\s+HTTP\/[\d.]+)?$/.exec(first);
  if (!match) throw new RequestFormatError(`первая строка должна быть «МЕТОД адрес», а не «${first}»`);
  const headers: HttpHeader[] = [];
  while (lines.length && lines[0].trim() !== '') {
    const line = lines.shift()!;
    const colon = line.indexOf(':');
    if (colon <= 0) throw new RequestFormatError(`строка заголовка без двоеточия: «${line.trim()}»`);
    headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
  }
  lines.shift();
  return { method: match[1].toUpperCase(), url: match[2], headers, body: lines.join('\n').trim() };
}

export function formatRequest(req: ApiRequest): string {
  const head = [`${req.method} ${req.url}`, ...req.headers.filter((h) => h.name.trim()).map((h) => `${h.name}: ${h.value}`)];
  return req.body.trim() ? `${head.join('\n')}\n\n${req.body.trim()}` : head.join('\n');
}

export interface UrlParts {
  /** `https://api.shop.local`, or '' for a relative URL. */
  origin: string;
  path: string;
  query: [string, string][];
}

export function splitUrl(url: string): UrlParts {
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
    const u = new URL(url, 'http://relative.invalid');
    return {
      origin: absolute ? u.origin : '',
      path: decodeURIComponent(u.pathname),
      query: [...u.searchParams.entries()],
    };
  } catch {
    const [path, query = ''] = url.split('?');
    return { origin: '', path, query: query ? query.split('&').map((p) => p.split('=') as [string, string]) : [] };
  }
}

/** Rebuilds the URL with new query parameters (the Params tab edits them). */
export function withQuery(url: string, query: [string, string][]): string {
  const { origin, path } = splitUrl(url);
  const q = query
    .filter(([k]) => k.trim())
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${origin}${path}${q ? `?${q}` : ''}`;
}

/** Pretty JSON when the body is JSON, the text itself otherwise. */
export function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/** "application/json; charset=utf-8" → "application/json" */
export const mediaType = (value: string | undefined) => value?.split(';')[0].trim().toLowerCase() ?? '';
