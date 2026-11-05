import { describe, expect, it } from 'vitest';
import type { ApiTask } from '@/content/loadCourse';
import { taskSchema } from '@/content/schema';
import { parseRequest } from '@/engine/api/http';
import { checkApiTask, checkRequest, readCorsConfig } from './api';

function task(raw: Record<string, unknown>) {
  const parsed = taskSchema.parse({ id: 't', title: 'T', prompt: 'P', hints: ['h'], type: 'request', ...raw });
  return { ...parsed, courseId: 'api', lessonId: 'l', worldId: 'w', setupSql: '' } as Extract<ApiTask, { type: 'request' }>;
}

const ORDER = 'POST /orders?notify=true\nContent-Type: application/json\n\n{"product": "Чай", "quantity": 2}';

describe('request check', () => {
  const t = task({ httpSolution: ORDER, check: { headers: ['Content-Type'] } });

  it('accepts an equivalent request: other key order, header case, charset', () => {
    const sent = parseRequest('post /orders?notify=true\ncontent-type: application/json; charset=utf-8\n\n{"quantity":2,"product":"Чай"}');
    expect(checkRequest(t, sent)).toEqual({ passed: true, problems: [] });
  });

  it('explains every difference', () => {
    const sent = parseRequest('PUT /order?notify=false&debug=1\n\n{"product": "Кофе", "qty": 2}');
    expect(checkRequest(t, sent).problems).toEqual([
      'Метод: ожидается POST, у вас PUT',
      'Путь: ожидается /orders, у вас /order',
      'Параметр notify: ожидается «true», у вас «false»',
      'Лишний параметр в адресе: debug',
      'Нет заголовка Content-Type',
      'Поле «product»: ожидается "Чай", у вас "Кофе"',
      'В теле запроса нет поля «quantity»',
      'В теле запроса лишнее поле «qty»',
    ]);
  });

  it('reports broken JSON in plain words', () => {
    const sent = parseRequest("POST /orders?notify=true\nContent-Type: application/json\n\n{product: 'Чай'}");
    expect(checkRequest(t, sent).problems[0]).toMatch(/^Тело запроса — некорректный JSON/);
  });
});

describe('response and cors checks', () => {
  const servers = {
    shop: {
      baseUrl: 'https://api.shop.local',
      collections: { products: [{ id: 1, name: 'Чай', category: 'drinks' }, { id: 2, name: 'Печенье', category: 'snacks' }] },
      routes: [
        { method: 'GET' as const, path: '/products', action: 'list' as const, collection: 'products', filters: ['category'] },
        { method: 'POST' as const, path: '/products', action: 'create' as const, collection: 'products', body: { name: { type: 'string' as const, required: true } } },
      ],
      cors: { allowOrigins: ['https://shop.local'], allowMethods: ['GET'], allowHeaders: [] },
    },
  };
  const make = (raw: Record<string, unknown>) => {
    const parsed = taskSchema.parse({ id: 'r', title: 'T', prompt: 'P', hints: ['h'], server: 'shop', ...raw });
    return { ...parsed, courseId: 'api', lessonId: 'l', worldId: 'w', setupSql: '' } as ApiTask;
  };

  it('compares what the server answers', () => {
    const t = make({ type: 'response', httpSolution: 'GET /products?category=snacks' });
    expect(checkApiTask(t, servers, { draft: parseRequest('GET https://api.shop.local/products?category=snacks'), cors: null }).passed).toBe(true);
    expect(checkApiTask(t, servers, { draft: parseRequest('GET /products'), cors: null }).problems).toEqual([
      'Тело ответа не то: ожидается список из 1 записи, а пришло список из 2 записей',
    ]);
    expect(checkApiTask(t, servers, { draft: parseRequest('GET /product'), cors: null }).problems[0]).toBe('Сервер ответил 404 Not Found, а нужен ответ 200 OK');
    expect(checkApiTask(t, servers, { draft: parseRequest('GET https://evil.example/products'), cors: null }).problems[0]).toMatch(/^Запрос ушёл на https:\/\/evil\.example/);
  });

  it('checks CORS settings from the frontend side and refuses too wide ones', () => {
    const t = make({
      type: 'cors',
      jsonSolution: '{"allowOrigins": ["https://admin.shop.local"], "allowMethods": ["GET", "POST"], "allowHeaders": ["Content-Type"]}',
      fetch: { origin: 'https://admin.shop.local', request: 'POST /products\nContent-Type: application/json\n\n{"name": "Сок"}' },
      check: { mustBlock: [{ origin: 'https://evil.example' }] },
    });
    const run = (cfg: string) => checkApiTask(t, servers, { draft: parseRequest('GET /'), cors: readCorsConfig(cfg) });
    expect(run('{"allowOrigins": ["https://admin.shop.local"], "allowMethods": ["POST"], "allowHeaders": ["content-type"]}').passed).toBe(true);
    expect(run('{"allowOrigins": ["https://admin.shop.local"], "allowMethods": ["GET"]}').problems[0]).toBe(
      'Фронтенд https://admin.shop.local не получил ответ. Сервер отклонил preflight-запрос: метода нет в allow_methods. Браузер не стал отправлять сам запрос.',
    );
    expect(run('{"allowOrigins": ["*"], "allowMethods": ["*"], "allowHeaders": ["*"]}').problems).toEqual([
      'Слишком широко: страница https://evil.example тоже получила ответ. Разрешайте только нужные origin, методы и заголовки',
    ]);
  });
});
