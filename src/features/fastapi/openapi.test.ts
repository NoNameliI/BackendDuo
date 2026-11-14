import { beforeAll, describe, expect, it } from 'vitest';
import { nodePython } from '../../../scripts/pyodide/node';
import { exampleFor, NO_TAG, readSpec, tryRequest, type Operation, type Spec } from './openapi';

const APP = `
from typing import Optional
from fastapi import FastAPI, Header, Query
from pydantic import BaseModel, Field

app = FastAPI(title="Магазин", version="1.2.3")

class Tag(BaseModel):
    name: str

class Item(BaseModel):
    name: str = Field(min_length=1, max_length=50, examples=["Хлеб"])
    price: float = Field(gt=0, le=1000)
    note: Optional[str] = None
    code: str = Field(default="A1", pattern="^[A-Z][0-9]$")
    tags: list[Tag] = []

class Node(BaseModel):
    value: int
    children: list["Node"] = []

@app.get("/items", response_model=list[Item], tags=["items"])
def list_items(page: int = Query(1, ge=1), limit: int = Query(10, ge=1, le=100)):
    return []

@app.get("/items/{item_id}", response_model=Item, tags=["items"], summary="Один товар")
def get_item(item_id: int, q: str = Query(description="Поиск")):
    return {}

@app.post("/items", status_code=201, response_model=Item, tags=["items"])
def create_item(item: Item, x_token: str = Header()):
    return item

@app.delete("/items/{item_id}", status_code=204, tags=["items"])
def delete_item(item_id: int):
    return None

@app.get("/tree", response_model=Node)
def tree():
    return {"value": 1}

@app.get("/old", deprecated=True, tags=["legacy"])
def old():
    return {}
`;

let spec: Spec;
const op = (method: string, path: string): Operation => {
  const found = spec.groups.flatMap((g) => g.operations).find((o) => o.method === method && o.path === path);
  if (!found) throw new Error(`no ${method} ${path}`);
  return found;
};

beforeAll(async () => {
  const { run } = await nodePython();
  const out = await run(APP, [{ method: 'GET', url: '/openapi.json', headers: [], body: '' }]);
  spec = readSpec(JSON.parse(out.responses[0]!.body));
}, 60_000);

describe('readSpec on real FastAPI output', () => {
  it('reads title, version, tags and the untagged group last', () => {
    expect(spec.title).toBe('Магазин');
    expect(spec.version).toBe('1.2.3');
    expect(spec.groups.map((g) => g.tag)).toEqual(['items', 'legacy', NO_TAG]);
    expect(op('GET', '/old').deprecated).toBe(true);
    expect(op('GET', '/items/{item_id}').summary).toBe('Один товар');
  });

  it('describes parameters with constraints and locations', () => {
    const list = op('GET', '/items');
    const page = list.params.find((p) => p.name === 'page')!;
    expect(page.in).toBe('query');
    expect(page.required).toBe(false);
    expect(page.view.label).toBe('integer');
    expect(page.view.constraints).toEqual(['≥ 1']);
    expect(list.params.find((p) => p.name === 'limit')!.view.constraints).toEqual(['≥ 1', '≤ 100']);
    const get = op('GET', '/items/{item_id}');
    expect(get.params.find((p) => p.name === 'item_id')).toMatchObject({ in: 'path', required: true });
    expect(get.params.find((p) => p.name === 'q')).toMatchObject({ required: true, description: 'Поиск' });
    expect(op('POST', '/items').params.find((p) => p.in === 'header')).toMatchObject({ name: 'x-token', required: true });
  });

  it('resolves $ref models: constraints, optional, nested, examples', () => {
    const body = op('POST', '/items').body!;
    expect(body.mediaType).toBe('application/json');
    expect(body.view.label).toBe('Item');
    expect(body.view.ref).toBe('Item');
    const props = Object.fromEntries(body.view.properties!.map((p) => [p.name, p]));
    expect(props.name!.required).toBe(true);
    expect(props.name!.view.constraints).toEqual(['от 1 символов', 'до 50 символов']);
    expect(props.name!.view.example).toBe('Хлеб');
    expect(props.price!.view.constraints).toEqual(['> 0', '≤ 1000']);
    expect(props.note!.required).toBe(false);
    expect(props.note!.view.label).toBe('string | null');
    expect(props.code!.view.constraints).toEqual(['pattern: ^[A-Z][0-9]$']);
    expect(props.tags!.view.label).toBe('array of Tag');
    expect(props.tags!.view.items!.properties![0]!.name).toBe('name');
    expect(body.example).toMatchObject({ name: 'Хлеб', code: 'A1' });
    expect(['string', null]).toContain((body.example as { note: unknown }).note);
  });

  it('reads responses with and without content, lists and 201/204', () => {
    const list = op('GET', '/items').responses.find((r) => r.code === '200')!;
    expect(list.view!.label).toBe('array of Item');
    expect(op('POST', '/items').responses.map((r) => r.code)).toEqual(['201', '422']);
    expect(op('POST', '/items').responses[1]!.view!.label).toBe('HTTPValidationError');
    const del = op('DELETE', '/items/{item_id}').responses.find((r) => r.code === '204')!;
    expect(del.view).toBeUndefined();
  });

  it('stops at recursive models', () => {
    const node = spec.schemas.find((s) => s.name === 'Node')!.view;
    const children = node.properties!.find((p) => p.name === 'children')!.view;
    expect(children.label).toBe('array of Node');
    expect(children.items!.properties).toBeUndefined();
    expect(exampleFor(node)).toEqual({ value: 0, children: [] });
    expect(spec.schemas.map((s) => s.name)).toEqual(expect.arrayContaining(['Item', 'Node', 'Tag', 'HTTPValidationError']));
  });
});

describe('tryRequest', () => {
  it('substitutes path params and adds required query params', () => {
    expect(tryRequest(op('GET', '/items/{item_id}'))).toEqual({ method: 'GET', url: '/items/1?q=string', headers: [], body: '' });
    expect(tryRequest(op('GET', '/items')).url).toBe('/items');
  });

  it('builds a JSON body with content-type and required headers', () => {
    const req = tryRequest(op('POST', '/items'));
    expect(req.method).toBe('POST');
    expect(req.headers).toEqual([
      { name: 'x-token', value: 'string' },
      { name: 'content-type', value: 'application/json' },
    ]);
    expect(JSON.parse(req.body)).toMatchObject({ name: 'Хлеб', price: 1 });
    expect(req.body).toContain('\n  "name"');
  });
});

describe('hand-written spec', () => {
  const doc = {
    openapi: '3.1.0',
    info: { title: 'T', version: '1' },
    paths: {
      '/login': {
        post: {
          requestBody: {
            required: true,
            content: { 'application/x-www-form-urlencoded': { schema: { $ref: '#/components/schemas/Login' } } },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
      '/n/{name}': {
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string', examples: ['bob'] } }],
        get: { responses: {} },
      },
    },
    components: {
      schemas: {
        Login: {
          type: 'object',
          required: ['username'],
          properties: {
            username: { type: 'string', const: 'admin' },
            kind: { enum: ['a', 'b'], type: 'string', default: 'b' },
            age: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
          },
        },
      },
    },
  };

  it('handles forms, const, enum, path-level params', () => {
    const s = readSpec(doc);
    const login = s.groups[0]!.operations.find((o) => o.path === '/login')!;
    expect(login.body!.mediaType).toBe('application/x-www-form-urlencoded');
    const props = Object.fromEntries(login.body!.view.properties!.map((p) => [p.name, p.view]));
    expect(props.username!.label).toBe('"admin"');
    expect(props.kind!.enum).toEqual(['a', 'b']);
    expect(props.age!.label).toBe('integer | null');
    expect(props.age!.constraints).toEqual(['≥ 0']);
    const req = tryRequest(login);
    expect(req.headers).toEqual([{ name: 'content-type', value: 'application/x-www-form-urlencoded' }]);
    expect(req.body).toBe('username=admin&kind=b&age=0');
    expect(tryRequest(s.groups[0]!.operations.find((o) => o.path === '/n/{name}')!).url).toBe('/n/bob');
  });

  it('rejects a document without paths', () => {
    expect(() => readSpec({ foo: 1 })).toThrow(/OpenAPI/);
  });
});
