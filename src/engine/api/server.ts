import { findHeader, mediaType, splitUrl, type ApiRequest, type ApiResponse, type HttpHeader } from './http';

/**
 * HttpSimEngine: virtual servers described as data (routes over in-memory collections, validation,
 * authorization, CORS). Behaviour follows what a FastAPI backend answers, so the world about FastAPI
 * meets the same statuses and error bodies. Nothing here touches the network.
 */
export type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';

export interface FieldSpec {
  type: FieldType;
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  enum?: (string | number)[];
}

export interface RouteDef {
  method: string;
  /** `/orders/{id}`: `{id}` is an integer path parameter. */
  path: string;
  action: 'list' | 'get' | 'create' | 'replace' | 'update' | 'delete' | 'static';
  collection?: string;
  /** Query parameters that filter a list by equality. */
  filters?: string[];
  /** `sort=field` / `sort=-field` on lists. */
  sort?: boolean;
  /** `page` and `limit` on lists (limit ≤ 100). */
  paginate?: boolean;
  /** Body fields of create/replace/update. */
  body?: Record<string, FieldSpec>;
  /** Query parameters with validation (list routes). */
  query?: Record<string, FieldSpec>;
  /** A field whose value must be unique in the collection (409 otherwise). */
  unique?: string;
  auth?: boolean;
  /** For `static`: the fixed answer. */
  respond?: { status: number; body?: unknown; headers?: Record<string, string> };
  /** Simulated server time, ms. */
  delay?: number;
}

export interface CorsConfig {
  allowOrigins: string[];
  allowMethods: string[];
  allowHeaders: string[];
  allowCredentials?: boolean;
  exposeHeaders?: string[];
  maxAge?: number;
}

export interface ServerDef {
  baseUrl: string;
  collections: Record<string, Record<string, unknown>[]>;
  routes: RouteDef[];
  auth?: { tokens?: string[]; apiKeys?: string[] };
  cors?: CorsConfig;
  /** Requests allowed before answers become 429 (per server instance). */
  rateLimit?: number;
}

export interface ValidationIssue {
  type: string;
  loc: (string | number)[];
  msg: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
}

const json = (status: number, body: unknown, headers: HttpHeader[] = []): ApiResponse => ({
  status,
  headers: [{ name: 'content-type', value: 'application/json' }, ...headers],
  body: JSON.stringify(body),
  timeMs: 0,
});

const empty = (status: number, headers: HttpHeader[] = []): ApiResponse => ({ status, headers, body: '', timeMs: 0 });

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.replace(/\/$/, '').split('/');
  const b = path.replace(/\/$/, '').split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const m = /^\{(\w+)\}$/.exec(a[i]);
    if (m) params[m[1]] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

const quoteList = (values: (string | number)[]) => values.map((v) => (typeof v === 'string' ? `'${v}'` : String(v))).join(', ').replace(/, ([^,]*)$/, ' or $1');

/** Pydantic-style validation of one value; returns the coerced value or issues. */
export function validateValue(spec: FieldSpec, value: unknown, loc: (string | number)[]): { value?: unknown; issues: ValidationIssue[] } {
  const issue = (type: string, msg: string, ctx?: Record<string, unknown>): { issues: ValidationIssue[] } => ({ issues: [{ type, loc, msg, input: value, ...(ctx ? { ctx } : {}) }] });
  let v = value;
  switch (spec.type) {
    case 'integer':
      if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) v = Number(v);
      if (typeof v === 'number' && !Number.isInteger(v)) return issue('int_from_float', 'Input should be a valid integer, got a number with a fractional part');
      if (typeof v !== 'number') {
        return typeof v === 'string' ? issue('int_parsing', 'Input should be a valid integer, unable to parse string as an integer') : issue('int_type', 'Input should be a valid integer');
      }
      break;
    case 'number':
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) v = Number(v);
      if (typeof v !== 'number') return typeof v === 'string' ? issue('float_parsing', 'Input should be a valid number, unable to parse string as a number') : issue('float_type', 'Input should be a valid number');
      break;
    case 'boolean':
      if (v === 'true' || v === '1' || v === 1) v = true;
      else if (v === 'false' || v === '0' || v === 0) v = false;
      if (typeof v !== 'boolean') return issue('bool_parsing', 'Input should be a valid boolean, unable to interpret input');
      break;
    case 'string':
      if (typeof v !== 'string') return issue('string_type', 'Input should be a valid string');
      break;
    case 'array':
      if (!Array.isArray(v)) return issue('list_type', 'Input should be a valid list');
      break;
    case 'object':
      if (!v || typeof v !== 'object' || Array.isArray(v)) return issue('dict_type', 'Input should be a valid dictionary');
      break;
  }
  if (spec.enum && !spec.enum.includes(v as string | number)) return issue('literal_error', `Input should be ${quoteList(spec.enum)}`, { expected: quoteList(spec.enum) });
  if (typeof v === 'number') {
    if (spec.min !== undefined && v < spec.min) return issue('greater_than_equal', `Input should be greater than or equal to ${spec.min}`, { ge: spec.min });
    if (spec.max !== undefined && v > spec.max) return issue('less_than_equal', `Input should be less than or equal to ${spec.max}`, { le: spec.max });
  }
  if (typeof v === 'string') {
    if (spec.minLength !== undefined && v.length < spec.minLength) {
      return issue('string_too_short', `String should have at least ${spec.minLength} character${spec.minLength === 1 ? '' : 's'}`, { min_length: spec.minLength });
    }
    if (spec.maxLength !== undefined && v.length > spec.maxLength) {
      return issue('string_too_long', `String should have at most ${spec.maxLength} character${spec.maxLength === 1 ? '' : 's'}`, { max_length: spec.maxLength });
    }
  }
  return { value: v, issues: [] };
}

function validateObject(fields: Record<string, FieldSpec>, input: Record<string, unknown>, where: string, partial: boolean) {
  const issues: ValidationIssue[] = [];
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(fields)) {
    if (!(name in input) || input[name] === undefined) {
      if (spec.required && !partial) issues.push({ type: 'missing', loc: [where, name], msg: 'Field required', input });
      continue;
    }
    const r = validateValue(spec, input[name], [where, name]);
    issues.push(...r.issues);
    if (!r.issues.length) out[name] = r.value;
  }
  return { issues, value: out };
}

/** A running virtual server: state lives as long as the instance (reset = new instance). */
export class HttpSimServer {
  private readonly collections: Record<string, Record<string, unknown>[]>;
  private requests = 0;

  constructor(readonly def: ServerDef) {
    this.collections = structuredClone(def.collections);
  }

  /** Data of the server right now (tests and response checks read it). */
  get data(): Readonly<Record<string, Record<string, unknown>[]>> {
    return this.collections;
  }

  handle(req: ApiRequest): ApiResponse {
    const response = this.route(req);
    const route = this.findRoute(req)?.route;
    const body = response.body.length;
    return { ...response, timeMs: route?.delay ?? 8 + Math.round(body / 200) };
  }

  private findRoute(req: ApiRequest) {
    const { path } = splitUrl(req.url);
    for (const route of this.def.routes) {
      const params = matchPath(route.path, path);
      if (params && route.method === req.method.toUpperCase()) return { route, params };
    }
    return null;
  }

  private authorized(req: ApiRequest): boolean {
    const auth = findHeader(req.headers, 'Authorization');
    const bearer = auth && /^Bearer\s+(.+)$/i.exec(auth)?.[1].trim();
    if (bearer && this.def.auth?.tokens?.includes(bearer)) return true;
    const key = findHeader(req.headers, 'X-API-Key');
    return Boolean(key && this.def.auth?.apiKeys?.includes(key.trim()));
  }

  private route(req: ApiRequest): ApiResponse {
    const { path, query } = splitUrl(req.url);
    const method = req.method.toUpperCase();
    this.requests++;
    if (this.def.rateLimit !== undefined && this.requests > this.def.rateLimit) {
      return json(429, { detail: 'Too Many Requests' }, [{ name: 'retry-after', value: '60' }]);
    }
    const found = this.findRoute(req);
    if (!found) {
      const allowed = this.def.routes.filter((r) => matchPath(r.path, path)).map((r) => r.method);
      if (method === 'OPTIONS' && allowed.length) return empty(204, [{ name: 'allow', value: [...new Set([...allowed, 'OPTIONS'])].join(', ') }]);
      if (allowed.length) return json(405, { detail: 'Method Not Allowed' }, [{ name: 'allow', value: [...new Set(allowed)].join(', ') }]);
      return json(404, { detail: 'Not Found' });
    }
    const { route, params } = found;
    if (route.auth && !this.authorized(req)) {
      const sent = findHeader(req.headers, 'Authorization') ?? findHeader(req.headers, 'X-API-Key');
      return json(401, { detail: sent ? 'Invalid authentication credentials' : 'Not authenticated' }, [{ name: 'www-authenticate', value: 'Bearer' }]);
    }
    if (route.action === 'static') {
      const r = route.respond ?? { status: 200 };
      const headers = Object.entries(r.headers ?? {}).map(([name, value]) => ({ name, value }));
      return r.body === undefined ? empty(r.status, headers) : json(r.status, r.body, headers);
    }

    const items = this.collections[route.collection ?? ''] ?? [];
    let id: number | undefined;
    if ('id' in params) {
      const r = validateValue({ type: 'integer' }, params.id, ['path', 'id']);
      if (r.issues.length) return json(422, { detail: r.issues });
      id = r.value as number;
    }
    const index = id === undefined ? -1 : items.findIndex((it) => it.id === id);

    // Query validation of list routes.
    const q = Object.fromEntries(query);
    if (route.query) {
      const r = validateObject(route.query, q, 'query', false);
      if (r.issues.length) return json(422, { detail: r.issues });
    }

    let body: Record<string, unknown> = {};
    if (route.action === 'create' || route.action === 'replace' || route.action === 'update') {
      const type = mediaType(findHeader(req.headers, 'Content-Type'));
      if (!req.body.trim()) return json(422, { detail: [{ type: 'missing', loc: ['body'], msg: 'Field required', input: null }] });
      // Like FastAPI: no Content-Type still means JSON; another media type means "not an object".
      if (type !== '' && type !== 'application/json' && !type.endsWith('+json')) {
        return json(422, { detail: [{ type: 'model_attributes_type', loc: ['body'], msg: 'Input should be a valid dictionary or object to extract fields from', input: req.body }] });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(req.body);
      } catch (e) {
        return json(422, { detail: [{ type: 'json_invalid', loc: ['body', 0], msg: 'JSON decode error', input: {}, ctx: { error: (e as Error).message } }] });
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return json(422, { detail: [{ type: 'model_attributes_type', loc: ['body'], msg: 'Input should be a valid dictionary or object to extract fields from', input: parsed }] });
      }
      const r = validateObject(route.body ?? {}, parsed as Record<string, unknown>, 'body', route.action === 'update');
      if (r.issues.length) return json(422, { detail: r.issues });
      body = r.value;
    }

    switch (route.action) {
      case 'list': {
        let list = items.filter((it) => (route.filters ?? []).every((f) => q[f] === undefined || String(it[f]) === q[f]));
        if (route.sort && q.sort) {
          const desc = q.sort.startsWith('-');
          const field = q.sort.replace(/^-/, '');
          list = [...list].sort((a, b) => {
            const x = a[field] as string | number;
            const y = b[field] as string | number;
            return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
          });
        }
        const headers: HttpHeader[] = [];
        if (route.paginate) {
          const page = Math.max(1, Number(q.page ?? 1) || 1);
          const limit = Math.min(100, Math.max(1, Number(q.limit ?? 10) || 10));
          headers.push({ name: 'x-total-count', value: String(list.length) });
          list = list.slice((page - 1) * limit, page * limit);
        }
        return json(200, list, headers);
      }
      case 'get':
        return index === -1 ? json(404, { detail: 'Not found' }) : json(200, items[index]);
      case 'create': {
        if (route.unique && items.some((it) => it[route.unique!] === body[route.unique!])) {
          return json(409, { detail: `${route.unique} already exists` });
        }
        const next = Math.max(0, ...items.map((it) => Number(it.id) || 0)) + 1;
        const item = { id: next, ...body };
        items.push(item);
        return json(201, item, [{ name: 'location', value: `${route.path.replace(/\/$/, '')}/${next}` }]);
      }
      case 'replace':
      case 'update': {
        if (index === -1) return json(404, { detail: 'Not found' });
        const item = route.action === 'replace' ? { id, ...body } : { ...items[index], ...body };
        items[index] = item;
        return json(200, item);
      }
      case 'delete':
        if (index === -1) return json(404, { detail: 'Not found' });
        items.splice(index, 1);
        return empty(204);
    }
  }
}

/** Several requests in one text block are separated by a line `###` (as in REST client files). */
export function splitRequests(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/^###.*$/m)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Sends a request to a virtual server; a URL of another host is reported instead of being sent anywhere. */
export function sendTo(server: HttpSimServer, req: ApiRequest): ApiResponse | string {
  const origin = splitUrl(req.url).origin;
  if (origin && origin !== server.def.baseUrl) return `Запрос ушёл на ${origin}, а учебный сервер этого задания — ${server.def.baseUrl}`;
  return server.handle(req);
}
