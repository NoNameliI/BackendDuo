/** Comparison of two OpenAPI documents (the course's reference against the learner's app), in Russian. */

export type OpenapiAspect = 'operationId' | 'tags' | 'summary' | 'responses' | 'params' | 'schemas';

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'];
const MAX_PROBLEMS = 3;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const paths = (spec: unknown): Obj => (isObj(spec) && isObj(spec.paths) ? spec.paths : {});

/** 'GET /items' for every operation of the spec, sorted. */
export function routeSet(spec: unknown): string[] {
  const out: string[] = [];
  for (const [path, item] of Object.entries(paths(spec))) {
    if (!isObj(item)) continue;
    for (const m of METHODS) if (isObj(item[m])) out.push(`${m.toUpperCase()} ${path}`);
  }
  return out.sort();
}

function operations(spec: unknown): Map<string, Obj> {
  const out = new Map<string, Obj>();
  for (const [path, item] of Object.entries(paths(spec))) {
    if (!isObj(item)) continue;
    for (const m of METHODS) {
      const op = item[m];
      if (isObj(op)) out.set(`${m.toUpperCase()} ${path}`, { ...op, __shared: item.parameters });
    }
  }
  return out;
}

const components = (spec: unknown): Obj => (isObj(spec) && isObj(spec.components) && isObj(spec.components.schemas) ? spec.components.schemas : {});

function lookup(spec: unknown, ref: string): Obj | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let cur: unknown = spec;
  for (const part of ref.slice(2).split('/')) cur = isObj(cur) ? cur[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined;
  return isObj(cur) ? cur : undefined;
}

/** name|in|required of every parameter of the operation (path-level ones included, references followed). */
function paramKeys(spec: unknown, op: Obj): string[] {
  const byKey = new Map<string, string>();
  for (const raw of [...arr(op.__shared), ...arr(op.parameters)]) {
    const p = isObj(raw) && typeof raw.$ref === 'string' ? lookup(spec, raw.$ref) : raw;
    if (!isObj(p)) continue;
    const where = str(p.in);
    byKey.set(`${where}:${str(p.name)}`, `${str(p.name)} (${where}${where === 'path' || p.required === true ? ', обязательный' : ''})`);
  }
  return [...byKey.values()].sort();
}

const codes = (op: Obj): string[] => (isObj(op.responses) ? Object.keys(op.responses).sort() : []);
const tagsOf = (op: Obj): string[] => arr(op.tags).map(String).sort();

const list = (items: string[]) => items.map((s) => `«${s}»`).join(', ');
const diff = (want: string[], got: string[]) => ({
  missing: want.filter((x) => !got.includes(x)),
  extra: got.filter((x) => !want.includes(x)),
});

function compareOperation(route: string, want: Obj, got: Obj, wantSpec: unknown, gotSpec: unknown, aspects: Set<OpenapiAspect>, out: string[]) {
  if (aspects.has('operationId') && str(want.operationId) !== str(got.operationId)) {
    out.push(`${route}: operationId должен быть «${str(want.operationId)}», сейчас «${str(got.operationId)}».`);
  }
  if (aspects.has('tags')) {
    const { missing, extra } = diff(tagsOf(want), tagsOf(got));
    if (missing.length || extra.length) {
      out.push(`${route}: теги должны быть ${list(tagsOf(want)) || '(пусто)'}, сейчас ${list(tagsOf(got)) || '(пусто)'}.`);
    }
  }
  if (aspects.has('summary') && str(want.summary) !== str(got.summary)) {
    out.push(`${route}: summary должен быть «${str(want.summary)}», сейчас «${str(got.summary)}».`);
  }
  if (aspects.has('responses')) {
    const { missing, extra } = diff(codes(want), codes(got));
    if (missing.length) out.push(`${route}: не описан ответ ${missing.join(', ')}.`);
    if (extra.length) out.push(`${route}: лишний описанный ответ ${extra.join(', ')}.`);
  }
  if (aspects.has('params')) {
    const { missing, extra } = diff(paramKeys(wantSpec, want), paramKeys(gotSpec, got));
    if (missing.length) out.push(`${route}: не хватает параметра ${list(missing)}.`);
    if (extra.length) out.push(`${route}: лишний или иной параметр ${list(extra)}.`);
  }
}

function compareSchemas(want: unknown, got: unknown, out: string[]) {
  const w = components(want);
  const g = components(got);
  const { missing, extra } = diff(Object.keys(w).sort(), Object.keys(g).sort());
  if (missing.length) out.push(`Нет модели ${list(missing)} в схемах.`);
  if (extra.length) out.push(`Лишняя модель ${list(extra)} в схемах.`);
  for (const name of Object.keys(w).sort()) {
    const a = w[name];
    const b = g[name];
    if (!isObj(a) || !isObj(b)) continue;
    const props = diff(Object.keys(isObj(a.properties) ? a.properties : {}).sort(), Object.keys(isObj(b.properties) ? b.properties : {}).sort());
    if (props.missing.length) out.push(`Модель ${name}: нет полей ${list(props.missing)}.`);
    if (props.extra.length) out.push(`Модель ${name}: лишние поля ${list(props.extra)}.`);
    const reqA = arr(a.required).map(String).sort();
    const reqB = arr(b.required).map(String).sort();
    const req = diff(reqA, reqB);
    if (req.missing.length) out.push(`Модель ${name}: поля ${list(req.missing)} должны быть обязательными.`);
    if (req.extra.length) out.push(`Модель ${name}: поля ${list(req.extra)} не должны быть обязательными.`);
  }
}

/**
 * Differences between the reference spec `want` and the learner's `got`, Russian, at most 3. Routes (method + path)
 * are always compared; `compare` adds the aspects. Messages name the operation as «GET /items».
 */
export function compareOpenapi(want: unknown, got: unknown, compare: OpenapiAspect[]): string[] {
  const out: string[] = [];
  const wantRoutes = routeSet(want);
  const gotRoutes = routeSet(got);
  const { missing, extra } = diff(wantRoutes, gotRoutes);
  for (const r of missing) out.push(`Маршрут ${r} пропал из документации.`);
  for (const r of extra) out.push(`Появился лишний маршрут ${r}.`);

  const aspects = new Set(compare);
  const wantOps = operations(want);
  const gotOps = operations(got);
  for (const route of wantRoutes) {
    const w = wantOps.get(route);
    const g = gotOps.get(route);
    if (w && g) compareOperation(route, w, g, want, got, aspects, out);
  }
  if (aspects.has('schemas')) compareSchemas(want, got, out);
  return out.slice(0, MAX_PROBLEMS);
}
