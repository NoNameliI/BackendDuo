import { beforeAll, describe, expect, it } from 'vitest';
import { parseRequest } from '@/engine/api/http';
import { nodePython } from '../../scripts/pyodide/node';
import { compareOpenapi, routeSet } from './openapiCompare';

const A = `
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class Item(BaseModel):
    name: str
    price: float = 0

@app.get("/items", tags=["items"], summary="Список", operation_id="list_items")
def items(limit: int = 10):
    return []

@app.post("/items", status_code=201, response_model=Item, tags=["items"])
def create(item: Item):
    return item
`;

const B = `
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class Item(BaseModel):
    name: str
    price: float
    note: str = ""

@app.get("/items", summary="Все")
def items(limit: int, q: str | None = None):
    return []

@app.post("/items")
def create(item: Item):
    return item

@app.get("/health")
def health():
    return {}
`;

let specA: unknown;
let specB: unknown;

beforeAll(async () => {
  const { run } = await nodePython();
  const spec = async (code: string) => JSON.parse((await run(code, [parseRequest('GET /openapi.json')])).responses[0].body) as unknown;
  specA = await spec(A);
  specB = await spec(B);
}, 60_000);

describe('routeSet', () => {
  it('lists method + path sorted', () => {
    expect(routeSet(specA)).toEqual(['GET /items', 'POST /items']);
    expect(routeSet(specB)).toEqual(['GET /health', 'GET /items', 'POST /items']);
    expect(routeSet(null)).toEqual([]);
    expect(routeSet({ paths: { '/x': { parameters: [], get: {}, post: {} } } })).toEqual(['GET /x', 'POST /x']);
  });
});

describe('compareOpenapi on real specs', () => {
  it('equal specs have no problems', () => {
    expect(compareOpenapi(specA, specA, ['operationId', 'tags', 'summary', 'responses', 'params', 'schemas'])).toEqual([]);
  });

  it('names missing and extra routes', () => {
    expect(compareOpenapi(specA, specB, [])).toEqual(['Появился лишний маршрут GET /health.']);
  });

  it('aspects: operationId, tags, summary, params', () => {
    const only = (a: 'operationId' | 'tags' | 'summary' | 'params') => compareOpenapi(specA, specB, [a]).filter((p) => p.startsWith('GET /items'));
    expect(only('operationId')[0]).toContain('«list_items»');
    expect(only('tags')[0]).toContain('«items»');
    expect(only('summary')[0]).toContain('«Список»');
    expect(only('params').join(' ')).toContain('limit (query, обязательный)');
  });

  it('schemas: properties and required lists', () => {
    const wide = compareOpenapi(specA, specB, ['schemas']);
    expect(wide.join(' ')).toContain('Модель Item: лишние поля «note»');
    expect(wide.join(' ')).toContain('«price» не должны быть обязательными');
  });

  it('is limited to three problems', () => {
    expect(compareOpenapi(specA, specB, ['operationId', 'tags', 'summary', 'params', 'schemas', 'responses']).length).toBeLessThanOrEqual(3);
  });
});

describe('compareOpenapi on hand-made specs', () => {
  const op = (extra: object = {}) => ({ responses: { '200': { description: 'ok' } }, ...extra });
  const want = { paths: { '/a': { get: op({ operationId: 'a', tags: ['t'] }) } } };

  it('responses: status code sets', () => {
    const got = { paths: { '/a': { get: op({ operationId: 'a', tags: ['t'], responses: { '200': {}, '404': {} } }) } } };
    expect(compareOpenapi(want, got, ['responses'])).toEqual(['GET /a: лишний описанный ответ 404.']);
    expect(compareOpenapi(got, want, ['responses'])).toEqual(['GET /a: не описан ответ 404.']);
    expect(compareOpenapi(want, got, [])).toEqual([]);
  });

  it('params: follows references and path-level parameters', () => {
    const w = {
      paths: { '/a/{id}': { parameters: [{ $ref: '#/components/parameters/Id' }], get: op() } },
      components: { parameters: { Id: { name: 'id', in: 'path', required: true } } },
    };
    const g = { paths: { '/a/{id}': { get: op({ parameters: [{ name: 'id', in: 'path', required: true }] }) } } };
    expect(compareOpenapi(w, g, ['params'])).toEqual([]);
    const h = { paths: { '/a/{id}': { get: op() } } };
    expect(compareOpenapi(w, h, ['params'])[0]).toContain('GET /a/{id}: не хватает параметра «id (path, обязательный)»');
  });

  it('tags are compared as sets', () => {
    const got = { paths: { '/a': { get: op({ operationId: 'a', tags: ['u', 't'] }) } } };
    expect(compareOpenapi(want, got, ['tags'])).toHaveLength(1);
    const same = { paths: { '/a': { get: op({ operationId: 'a', tags: ['t'] }) } } };
    expect(compareOpenapi(want, same, ['tags'])).toEqual([]);
  });

  it('schema component names', () => {
    const w = { paths: {}, components: { schemas: { A: {}, B: {} } } };
    const g = { paths: {}, components: { schemas: { A: {}, C: {} } } };
    expect(compareOpenapi(w, g, ['schemas'])).toEqual(['Нет модели «B» в схемах.', 'Лишняя модель «C» в схемах.']);
  });
});
