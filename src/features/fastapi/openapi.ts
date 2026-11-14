import type { ApiRequest, HttpHeader } from '@/engine/api/http';

/** Offline reading of the OpenAPI document a FastAPI app serves at /openapi.json (3.1, JSON Schema 2020-12). */

export interface SchemaView {
  /** 'string | null', 'array of Item', 'Item', 'object'. */
  label: string;
  type?: string;
  format?: string;
  title?: string;
  description?: string;
  /** Short Russian strings: '≥ 1', 'до 50 символов', 'pattern: ^a'. */
  constraints: string[];
  enum?: unknown[];
  properties?: { name: string; required: boolean; view: SchemaView }[];
  items?: SchemaView;
  /** Name of the component this view was reached through. */
  ref?: string;
  /** From `example`, `examples[0]` or `const`. */
  example?: unknown;
  default?: unknown;
}

export interface ParamView {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  description: string;
  view: SchemaView;
  example?: unknown;
}

export interface Operation {
  method: string;
  path: string;
  operationId: string;
  summary: string;
  description: string;
  deprecated: boolean;
  params: ParamView[];
  body?: { mediaType: string; view: SchemaView; example: unknown; required: boolean };
  responses: { code: string; description: string; view?: SchemaView }[];
}

export interface Spec {
  title: string;
  version: string;
  groups: { tag: string; operations: Operation[] }[];
  schemas: { name: string; view: SchemaView }[];
}

export const NO_TAG = 'Без тега';
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const json = (v: unknown): string => JSON.stringify(v) ?? String(v);

interface Ctx {
  root: Obj;
}

function lookup(ctx: Ctx, ref: string): Obj | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let cur: unknown = ctx.root;
  for (const part of ref.slice(2).split('/')) {
    cur = isObj(cur) ? cur[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined;
  }
  return isObj(cur) ? cur : undefined;
}

function constraintsOf(s: Obj): string[] {
  const out: string[] = [];
  const num = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : undefined);
  const set = (text: string, v: number | undefined) => v !== undefined && out.push(`${text} ${v}`);
  set('≥', num('minimum'));
  set('>', num('exclusiveMinimum'));
  set('≤', num('maximum'));
  set('<', num('exclusiveMaximum'));
  set('кратно', num('multipleOf'));
  const minL = num('minLength');
  const maxL = num('maxLength');
  if (minL !== undefined) out.push(`от ${minL} символов`);
  if (maxL !== undefined) out.push(`до ${maxL} символов`);
  const minI = num('minItems');
  const maxI = num('maxItems');
  if (minI !== undefined) out.push(`от ${minI} элементов`);
  if (maxI !== undefined) out.push(`до ${maxI} элементов`);
  if (typeof s.pattern === 'string') out.push(`pattern: ${s.pattern}`);
  if (s.uniqueItems === true) out.push('без повторов');
  return out;
}

function typeLabel(s: Obj, items?: SchemaView, hasProps = false): string {
  if ('const' in s) return json(s.const);
  const t = s.type;
  const types = Array.isArray(t) ? t.map(String) : typeof t === 'string' ? [t] : [];
  if (types.length === 0) return hasProps ? 'object' : 'any';
  return types
    .map((x) => (x === 'array' ? (items ? `array of ${items.label}` : 'array') : x))
    .join(' | ');
}

function build(ctx: Ctx, schema: unknown, seen: readonly string[]): SchemaView {
  if (!isObj(schema)) return { label: 'any', constraints: [] };
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.split('/').at(-1) ?? schema.$ref;
    const target = lookup(ctx, schema.$ref);
    // A model that contains itself: stop at the name.
    if (!target || seen.includes(name)) return { label: name, ref: name, constraints: [] };
    const inner = build(ctx, target, [...seen, name]);
    return { ...inner, label: name, ref: name, title: inner.title ?? name };
  }
  const view: SchemaView = { label: '', constraints: [] };
  if (typeof schema.title === 'string') view.title = schema.title;
  if (typeof schema.description === 'string') view.description = schema.description;
  if (typeof schema.format === 'string') view.format = schema.format;
  if ('default' in schema) view.default = schema.default;
  if ('const' in schema) view.example = schema.const;
  else if (Array.isArray(schema.examples) && schema.examples.length) view.example = schema.examples[0];
  else if ('example' in schema) view.example = schema.example;
  if (Array.isArray(schema.enum)) view.enum = schema.enum;

  const variants = arr(schema.anyOf).length ? arr(schema.anyOf) : arr(schema.oneOf);
  if (variants.length) {
    const views = variants.map((v) => build(ctx, v, seen));
    const real = views.filter((v) => v.type !== 'null');
    if (real.length === 1) {
      // Optional[X]: keep X's details, mark null in the label.
      const one = real[0]!;
      const merged: SchemaView = { ...one, ...pick(view), constraints: [...one.constraints, ...constraintsOf(schema)] };
      if (views.length > real.length) merged.label = `${one.label} | null`;
      return merged;
    }
    view.label = views.map((v) => v.label).join(' | ');
    view.constraints = constraintsOf(schema);
    return view;
  }
  const all = arr(schema.allOf);
  if (all.length) {
    // FastAPI wraps a single $ref with description / default into allOf.
    const merged = all.map((v) => build(ctx, v, seen));
    const first = merged[0]!;
    const props = merged.flatMap((m) => m.properties ?? []);
    return {
      ...first,
      ...pick(view),
      constraints: [...merged.flatMap((m) => m.constraints), ...constraintsOf(schema)],
      ...(props.length ? { properties: props } : {}),
    };
  }

  const t = schema.type;
  const types = Array.isArray(t) ? t.map(String) : typeof t === 'string' ? [t] : [];
  const nonNull = types.filter((x) => x !== 'null');
  if (nonNull.length === 1) view.type = nonNull[0];
  else if (nonNull.length === 0 && types.length) view.type = 'null';
  if (isObj(schema.properties)) {
    const required = new Set(arr(schema.required).map(String));
    view.properties = Object.entries(schema.properties).map(([name, p]) => ({ name, required: required.has(name), view: build(ctx, p, seen) }));
    view.type ??= 'object';
  }
  if (schema.items !== undefined) {
    view.items = build(ctx, schema.items, seen);
    view.type ??= 'array';
  }
  view.label = typeLabel(schema, view.items, Boolean(view.properties));
  view.constraints = constraintsOf(schema);
  return view;
}

/** Keeps only the fields the wrapper itself defines (so they win over the wrapped schema). */
function pick(v: SchemaView): Partial<SchemaView> {
  const out: Partial<SchemaView> = {};
  if (v.title !== undefined) out.title = v.title;
  if (v.description !== undefined) out.description = v.description;
  if (v.default !== undefined) out.default = v.default;
  if (v.example !== undefined) out.example = v.example;
  if (v.enum !== undefined) out.enum = v.enum;
  if (v.format !== undefined) out.format = v.format;
  return out;
}

/** A plausible value for a schema: explicit example, default, const, first enum member, then by type. */
export function exampleFor(view: SchemaView): unknown {
  if (view.example !== undefined) return view.example;
  if (view.default !== undefined) return view.default;
  if (view.enum?.length) return view.enum[0];
  if (view.properties) {
    const out: Record<string, unknown> = {};
    for (const p of view.properties) {
      // A cut-off recursive reference has no properties: leave it out instead of nesting forever.
      if (p.view.ref && !p.view.properties && p.view.type === undefined) continue;
      out[p.name] = exampleFor(p.view);
    }
    return out;
  }
  switch (view.type) {
    case 'string':
      return view.format === 'email'
        ? 'user@example.com'
        : view.format === 'date'
          ? '2025-01-01'
          : view.format === 'date-time'
            ? '2025-01-01T12:00:00Z'
            : view.format === 'uuid'
              ? '3fa85f64-5717-4562-b3fc-2c963f66afa6'
              : 'string';
    case 'integer':
    case 'number': {
      const min = /^[≥>] (-?[\d.]+)$/.exec(view.constraints.find((c) => c.startsWith('≥') || c.startsWith('>')) ?? '');
      return min ? Number(min[1]) + (view.constraints.some((c) => c.startsWith('>')) ? 1 : 0) : view.type === 'integer' ? 0 : 0.5;
    }
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'array':
      return view.items ? [exampleFor(view.items)] : [];
    case 'object':
      return {};
    default:
      return view.label === 'any' ? {} : null;
  }
}

function mediaOf(ctx: Ctx, content: unknown): { mediaType: string; view: SchemaView; example: unknown } | undefined {
  if (!isObj(content)) return undefined;
  const keys = Object.keys(content);
  const mediaType = keys.find((k) => k === 'application/json') ?? keys.find((k) => k === 'application/x-www-form-urlencoded') ?? keys.find((k) => k === 'multipart/form-data') ?? keys[0];
  if (!mediaType) return undefined;
  const media = content[mediaType];
  if (!isObj(media)) return undefined;
  const view = build(ctx, media.schema, []);
  let example: unknown;
  if ('example' in media) example = media.example;
  else if (isObj(media.examples)) {
    const first = Object.values(media.examples)[0];
    if (isObj(first)) example = first.value;
  }
  return { mediaType, view, example: example !== undefined ? example : exampleFor(view) };
}

function readParam(ctx: Ctx, raw: unknown): ParamView | undefined {
  const p = isObj(raw) && typeof raw.$ref === 'string' ? lookup(ctx, raw.$ref) : raw;
  if (!isObj(p)) return undefined;
  const where = str(p.in);
  if (where !== 'path' && where !== 'query' && where !== 'header' && where !== 'cookie') return undefined;
  const view = build(ctx, p.schema, []);
  let example: unknown;
  if ('example' in p) example = p.example;
  else if (isObj(p.examples)) {
    const first = Object.values(p.examples)[0];
    if (isObj(first)) example = first.value;
  }
  example ??= view.example ?? view.default;
  return { name: str(p.name), in: where, required: where === 'path' || p.required === true, description: str(p.description), view, ...(example !== undefined ? { example } : {}) };
}

export function readSpec(input: unknown): Spec {
  const root = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  if (!isObj(root) || !isObj(root.paths)) throw new Error('Это не спецификация OpenAPI: нет раздела paths.');
  const ctx: Ctx = { root };
  const info = isObj(root.info) ? root.info : {};
  const byTag = new Map<string, Operation[]>();
  for (const t of arr(root.tags)) if (isObj(t) && typeof t.name === 'string') byTag.set(t.name, []);

  for (const [path, item] of Object.entries(root.paths)) {
    if (!isObj(item)) continue;
    const shared = arr(item.parameters);
    for (const method of METHODS) {
      const op = item[method];
      if (!isObj(op)) continue;
      const own = arr(op.parameters).map((p) => readParam(ctx, p));
      const common = shared.map((p) => readParam(ctx, p));
      const params = [...common, ...own].filter((p): p is ParamView => p !== undefined);
      // An operation parameter overrides a path-level one with the same name and location.
      const unique = params.filter((p, i) => params.findLastIndex((q) => q.name === p.name && q.in === p.in) === i);
      const rb = isObj(op.requestBody) && typeof op.requestBody.$ref === 'string' ? lookup(ctx, op.requestBody.$ref) : op.requestBody;
      const media = isObj(rb) ? mediaOf(ctx, rb.content) : undefined;
      const responses = isObj(op.responses)
        ? Object.entries(op.responses).map(([code, r]) => {
            const resp = isObj(r) && typeof r.$ref === 'string' ? lookup(ctx, r.$ref) : r;
            const m = isObj(resp) ? mediaOf(ctx, resp.content) : undefined;
            return { code, description: isObj(resp) ? str(resp.description) : '', ...(m ? { view: m.view } : {}) };
          })
        : [];
      const operation: Operation = {
        method: method.toUpperCase(),
        path,
        operationId: str(op.operationId),
        summary: str(op.summary),
        description: str(op.description),
        deprecated: op.deprecated === true,
        params: unique,
        ...(media && isObj(rb) ? { body: { ...media, required: rb.required === true } } : {}),
        responses,
      };
      const tag = str(arr(op.tags)[0]) || NO_TAG;
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push(operation);
    }
  }
  const groups = [...byTag.entries()]
    .filter(([, ops]) => ops.length)
    .map(([tag, operations]) => ({ tag, operations }))
    .sort((a, b) => Number(a.tag === NO_TAG) - Number(b.tag === NO_TAG));
  const components = isObj(root.components) && isObj(root.components.schemas) ? root.components.schemas : {};
  const schemas = Object.keys(components).map((name) => ({ name, view: build(ctx, { $ref: `#/components/schemas/${name}` }, []) }));
  return { title: str(info.title) || 'API', version: str(info.version), groups, schemas };
}

const scalar = (v: unknown): string => (typeof v === 'string' ? v : json(v));

/** A ready request for the composer: path params filled, required query params added, example body. */
export function tryRequest(op: Operation): ApiRequest {
  let url = op.path;
  const query: string[] = [];
  const headers: HttpHeader[] = [];
  for (const p of op.params) {
    const numeric = p.view.type === 'integer' || p.view.type === 'number';
    if (p.in === 'path') {
      const value = p.example ?? (numeric ? 1 : p.name);
      url = url.split(`{${p.name}}`).join(encodeURIComponent(scalar(value)));
    } else if (p.in === 'query' && p.required) {
      query.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(scalar(p.example ?? exampleFor(p.view)))}`);
    } else if (p.in === 'header' && p.required) {
      headers.push({ name: p.name, value: scalar(p.example ?? exampleFor(p.view)) });
    }
  }
  if (query.length) url += `?${query.join('&')}`;
  let body = '';
  if (op.body) {
    const form = op.body.mediaType === 'application/x-www-form-urlencoded' || op.body.mediaType === 'multipart/form-data';
    if (form && isObj(op.body.example)) {
      // multipart cannot be written as plain text here; a urlencoded body carries the same fields.
      body = Object.entries(op.body.example).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(scalar(v))}`).join('&');
      headers.push({ name: 'content-type', value: 'application/x-www-form-urlencoded' });
    } else {
      body = JSON.stringify(op.body.example, null, 2) ?? '';
      headers.push({ name: 'content-type', value: 'application/json' });
    }
  }
  return { method: op.method, url, headers, body };
}
