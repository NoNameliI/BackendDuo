// Deterministic data for the FastAPI audit suite: the OpenAPI document a rich app would serve, projects, test runs, logs.
import type { Exchange } from '@/engine/api/http';
import type { PytestCase, PytestRun } from '@/engine/python/runtime';

type Json = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (schema: Json, required = true) => ({ required, content: { 'application/json': { schema } } });
const jsonReply = (description: string, schema?: Json) => ({ description, ...(schema ? { content: { 'application/json': { schema } } } : {}) });
const invalid = { description: 'Validation Error', content: { 'application/json': { schema: ref('HTTPValidationError') } } };

const RESOURCES = [
  { name: 'organizations', item: 'Organization', parent: '' },
  { name: 'projects', item: 'Project', parent: 'organizations/{organization_id}/' },
  { name: 'deployments', item: 'Deployment', parent: 'organizations/{organization_id}/projects/{project_id}/' },
  { name: 'artifacts', item: 'Artifact', parent: 'organizations/{organization_id}/projects/{project_id}/deployments/{deployment_id}/' },
  { name: 'customers', item: 'Customer', parent: '' },
  { name: 'orders', item: 'Order', parent: 'customers/{customer_id}/' },
  { name: 'invoices', item: 'Invoice', parent: '' },
  { name: 'warehouses', item: 'Warehouse', parent: '' },
];

function pathParams(path: string): Json[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'integer', title: m[1].replace(/_/g, ' ') } }));
}

/** The /openapi.json of a rich app: 8 resource families (up to 5 operations each), long nested paths, nested schemas. */
export function richOpenapi(): Json {
  const paths: Record<string, Json> = {};
  for (const r of RESOURCES) {
    const base = `/api/v1/${r.parent}${r.name}`;
    const one = `${base}/{${r.item.toLowerCase()}_id}`;
    const tag = r.name;
    paths[base] = {
      get: {
        tags: [tag],
        summary: `Список: ${r.name}`,
        description: `Возвращает страницу записей «${r.name}» с фильтром и сортировкой.\nПорядок по умолчанию: от новых к старым.`,
        operationId: `list_${r.name}_api_v1_${r.parent.replace(/[^\w]/g, '_')}${r.name}_get`,
        parameters: [
          ...pathParams(base),
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 20, title: 'Limit' }, description: 'Сколько записей вернуть за один раз' },
          { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0, default: 0, title: 'Offset' } },
          { name: 'status', in: 'query', required: false, schema: ref('Status') },
          { name: 'search', in: 'query', required: false, schema: { anyOf: [{ type: 'string', maxLength: 80 }, { type: 'null' }], title: 'Search' } },
        ],
        responses: { '200': jsonReply('Successful Response', { type: 'array', items: ref(r.item) }), '422': invalid },
      },
      post: {
        tags: [tag],
        summary: `Создать: ${r.item}`,
        operationId: `create_${r.name}_api_v1_${r.parent.replace(/[^\w]/g, '_')}${r.name}_post`,
        parameters: pathParams(base),
        requestBody: jsonBody(ref(`${r.item}Create`)),
        responses: { '201': jsonReply('Successful Response', ref(r.item)), '409': jsonReply('Запись с таким именем уже есть'), '422': invalid },
      },
    };
    paths[one] = {
      get: {
        tags: [tag],
        summary: `Одна запись: ${r.item}`,
        operationId: `read_${r.item.toLowerCase()}_${r.name}_get`,
        parameters: pathParams(one),
        responses: { '200': jsonReply('Successful Response', ref(r.item)), '404': jsonReply('Запись не найдена'), '422': invalid },
      },
      patch: {
        tags: [tag],
        summary: `Изменить: ${r.item}`,
        operationId: `update_${r.item.toLowerCase()}_${r.name}_patch`,
        parameters: pathParams(one),
        requestBody: jsonBody(ref(`${r.item}Update`)),
        responses: { '200': jsonReply('Successful Response', ref(r.item)), '404': jsonReply('Запись не найдена'), '422': invalid },
      },
      delete: {
        tags: [tag],
        summary: `Удалить: ${r.item}`,
        operationId: `delete_${r.item.toLowerCase()}_${r.name}_delete`,
        deprecated: r.name === 'invoices',
        parameters: pathParams(one),
        responses: { '204': jsonReply('Successful Response'), '404': jsonReply('Запись не найдена'), '422': invalid },
      },
    };
  }
  paths['/health'] = { get: { summary: 'Проверка работы', operationId: 'health_health_get', responses: { '200': jsonReply('Successful Response', { type: 'object', additionalProperties: { type: 'string' }, title: 'Response Health Health Get' }) } } };

  const schemas: Record<string, Json> = {
    Status: { type: 'string', enum: ['draft', 'active', 'suspended', 'archived'], title: 'Status' },
    Geo: { type: 'object', title: 'Geo', required: ['lat', 'lon'], properties: { lat: { type: 'number', minimum: -90, maximum: 90, title: 'Lat' }, lon: { type: 'number', minimum: -180, maximum: 180, title: 'Lon' } } },
    Address: {
      type: 'object',
      title: 'Address',
      required: ['street', 'city'],
      properties: {
        street: { type: 'string', maxLength: 120, title: 'Street', description: 'Улица и дом, например «Красный проспект, 25, офис 304, вход со двора»' },
        city: { type: 'string', title: 'City' },
        geo: { anyOf: [ref('Geo'), { type: 'null' }] },
      },
    },
    Money: { type: 'object', title: 'Money', required: ['amount', 'currency'], properties: { amount: { type: 'string', pattern: '^[0-9]+\\.[0-9]{2}$', title: 'Amount' }, currency: { type: 'string', minLength: 3, maxLength: 3, title: 'Currency' } } },
    HTTPValidationError: { type: 'object', title: 'HTTPValidationError', properties: { detail: { type: 'array', items: ref('ValidationError'), title: 'Detail' } } },
    ValidationError: {
      type: 'object',
      title: 'ValidationError',
      required: ['loc', 'msg', 'type'],
      properties: { loc: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'integer' }] }, title: 'Location' }, msg: { type: 'string', title: 'Message' }, type: { type: 'string', title: 'Error Type' } },
    },
    Contact: { type: 'object', title: 'Contact', required: ['email'], properties: { email: { type: 'string', format: 'email', title: 'Email' }, phone: { anyOf: [{ type: 'string', pattern: '^\\+?[0-9 ()-]{7,20}$' }, { type: 'null' }], title: 'Phone' }, address: ref('Address') } },
    LineItem: { type: 'object', title: 'LineItem', required: ['sku', 'quantity', 'price'], properties: { sku: { type: 'string', maxLength: 40, title: 'Sku' }, quantity: { type: 'integer', minimum: 1, title: 'Quantity' }, price: ref('Money') } },
  };
  for (const r of RESOURCES) {
    const common = {
      name: { type: 'string', minLength: 1, maxLength: 80, title: 'Name', description: `Название: «${r.item}», уникальное в пределах родителя` },
      status: ref('Status'),
      contact: ref('Contact'),
      tags: { type: 'array', items: { type: 'string', maxLength: 24 }, title: 'Tags', default: [] },
    };
    schemas[`${r.item}Create`] = { type: 'object', title: `${r.item}Create`, required: ['name'], properties: { ...common, ...(r.item === 'Order' ? { items: { type: 'array', items: ref('LineItem'), minItems: 1, title: 'Items' } } : {}) } };
    schemas[`${r.item}Update`] = { type: 'object', title: `${r.item}Update`, properties: { name: { anyOf: [{ type: 'string', maxLength: 80 }, { type: 'null' }], title: 'Name' }, status: { anyOf: [ref('Status'), { type: 'null' }] }, tags: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }], title: 'Tags' } } };
    schemas[r.item] = { type: 'object', title: r.item, required: ['id', 'name', 'status', 'created_at'], properties: { id: { type: 'integer', title: 'Id' }, created_at: { type: 'string', format: 'date-time', title: 'Created At' }, ...common, ...(r.item === 'Order' ? { items: { type: 'array', items: ref('LineItem'), title: 'Items' }, total: ref('Money') } : {}) } };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Платформа поставок с очень длинным названием для проверки переноса', version: '2.14.0-rc.3' },
    tags: RESOURCES.map((r) => ({ name: r.name })),
    paths,
    components: { schemas },
  };
}

// --- projects -----------------------------------------------------------------------------------------------------

const APP = 'from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get("/ping")\ndef ping():\n    return {"status": "ok"}\n';

export const SINGLE_FILE: Record<string, string> = { 'main.py': APP };

/** A tree project with read-only files, a deep package and long names. */
export const TREE_FILES: Record<string, string> = {
  'main.py': 'from app.routers import items\nfrom fastapi import FastAPI\n\napp = FastAPI()\napp.include_router(items.router)\n',
  'app/__init__.py': '',
  'app/config.py': 'SECRET_KEY = "dev"\n',
  'app/routers/__init__.py': '',
  'app/routers/items.py': 'from fastapi import APIRouter\n\nrouter = APIRouter(prefix="/items")\n\n\n@router.get("")\ndef items():\n    return []\n',
  'app/routers/very_long_module_name_for_organization_project_deployments.py': 'router = None\n',
  'app/services/inventory_reservation_and_fulfilment_service.py': 'def reserve(sku: str) -> bool:\n    return True\n',
  'tests/test_items.py': 'def test_items(client):\n    assert client.get("/items").status_code == 200\n',
  'tests/conftest.py': 'import pytest\n',
  '.env': 'SECRET_KEY=dev\n',
};

export const TREE_READONLY = ['app/config.py', 'tests/conftest.py', 'app/routers/very_long_module_name_for_organization_project_deployments.py'];

/** 30 files with long names across several folders. */
export function manyFiles(): Record<string, string> {
  const files: Record<string, string> = { 'main.py': APP };
  for (let i = 1; i <= 29; i++) {
    const dir = ['app/routers', 'app/services', 'app/schemas', 'tests/api'][i % 4];
    files[`${dir}/module_number_${String(i).padStart(2, '0')}_with_a_long_descriptive_name.py`] = `# module ${i}\n`;
  }
  return files;
}

// --- tests ---------------------------------------------------------------------------------------------------------

const LONG_ASSERT =
  "E   AssertionError: assert {'id': 7, 'name': 'Организация с очень длинным названием «Северо-Западная логистическая компания»', 'status': 'draft', 'tags': ['a', 'b', 'c']} == {'id': 7, 'name': 'Организация', 'status': 'active', 'tags': []}\nE     Differing items:\nE     {'status': 'draft'} != {'status': 'active'}";

function pytestCase(nodeid: string, outcome: PytestCase['outcome'], message = ''): PytestCase {
  return { nodeid, outcome, message, file: nodeid.split('::')[0], line: null };
}

export function testRun(kind: 'passed' | 'mixed' | 'long' | 'many'): PytestRun {
  const tests: PytestCase[] =
    kind === 'passed'
      ? ['test_ping', 'test_list_items', 'test_create_item'].map((n) => pytestCase(`tests/test_items.py::${n}`, 'passed'))
      : kind === 'mixed'
        ? [
            pytestCase('tests/test_items.py::test_ping', 'passed'),
            pytestCase('tests/test_items.py::test_create_item', 'failed', 'E   assert 404 == 201\nE    +  where 404 = <Response [404 Not Found]>.status_code'),
            pytestCase('tests/test_items.py::test_fixture_missing', 'error', "E   fixture 'client' not found"),
            pytestCase('tests/test_items.py::test_slow', 'skipped'),
          ]
        : kind === 'long'
          ? [
              pytestCase('tests/api/test_organizations_projects_deployments_artifacts.py::test_artifact_listing_respects_the_deployment_scope_and_pagination', 'failed', LONG_ASSERT),
              pytestCase('tests/api/test_organizations_projects_deployments_artifacts.py::test_ok', 'passed'),
            ]
          : Array.from({ length: 40 }, (_, i) => pytestCase(`tests/api/test_module_${i}.py::test_case_${i}`, i % 7 === 3 ? 'failed' : 'passed', i % 7 === 3 ? 'E   assert 1 == 2' : ''));
  const counts = { passed: 0, failed: 0, error: 0, skipped: 0 };
  for (const t of tests) counts[t.outcome]++;
  const exit = counts.failed + counts.error > 0 ? 1 : 0;
  return { exit, counts, tests, output: tests.map((t) => `${t.nodeid} ${t.outcome.toUpperCase()}`).join('\n'), ms: 420 };
}

// --- log and exchanges ---------------------------------------------------------------------------------------------

const LONG_PATH = '/api/v1/organizations/1048576/projects/2097152/deployments/4194304/artifacts?limit=200&offset=1000&status=active&search=release-candidate-with-a-long-name';

export function logLines(kind: 'long' | 'many'): { id: number; kind: 'load' | 'access' | 'output' | 'error'; text: string }[] {
  if (kind === 'many') {
    return Array.from({ length: 120 }, (_, i) => ({ id: i + 1, kind: (['access', 'output', 'load', 'error'] as const)[i % 4], text: `INFO:     127.0.0.1:50000 - "GET /items/${i} HTTP/1.1" ${i % 4 === 3 ? 500 : 200}` }));
  }
  return [
    { id: 1, kind: 'load', text: 'Загружаю приложение: модуль main, 7 файлов' },
    { id: 2, kind: 'access', text: `INFO:     127.0.0.1:50000 - "GET ${LONG_PATH} HTTP/1.1" 200` },
    { id: 3, kind: 'output', text: `debug: ${'очень_длинная_строка_без_пробелов_'.repeat(6)}` },
    { id: 4, kind: 'output', text: `{"items": [${Array.from({ length: 30 }, (_, i) => `{"id": ${i}, "name": "Название ${i}"}`).join(', ')}]}` },
    { id: 5, kind: 'error', text: 'Traceback (most recent call last):\n  File "/project/app/routers/very_long_module_name_for_organization_project_deployments.py", line 112, in list_artifacts\n    return await repository.fetch_all_artifacts_for_deployment(deployment_id, limit=limit, offset=offset)\nKeyError: \'artifact_storage_bucket_name_for_the_deployment\'' },
  ];
}

export function streamExchange(): Exchange {
  return {
    id: 1,
    kind: 'request',
    request: { method: 'GET', url: 'http://127.0.0.1:8000/events', headers: [{ name: 'accept', value: 'text/event-stream' }], body: '' },
    response: {
      status: 200,
      headers: [{ name: 'content-type', value: 'text/event-stream; charset=utf-8' }, { name: 'cache-control', value: 'no-cache' }],
      body: Array.from({ length: 12 }, (_, i) => `data: {"tick": ${i}, "message": "событие номер ${i}"}\n\n`).join(''),
      timeMs: 1210,
    },
    notes: [{ text: 'Потоковый ответ: показан целиком после завершения', warn: false }, { text: 'Вывод print: connected to the broker with a very long diagnostic line that must wrap', warn: false }],
  };
}
