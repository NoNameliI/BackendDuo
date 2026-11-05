import { describe, expect, it } from 'vitest';
import { browserFetch, explainCors, fetchSucceeded, isSimpleRequest } from './cors';
import { findHeader, parseRequest } from './http';
import { HttpSimServer, type ServerDef } from './server';

const SHOP: ServerDef = {
  baseUrl: 'https://api.shop.local',
  collections: {
    products: [
      { id: 1, name: 'Чай', category: 'drinks', price: 300 },
      { id: 2, name: 'Кофе', category: 'drinks', price: 450 },
      { id: 3, name: 'Печенье', category: 'snacks', price: 120 },
    ],
    orders: [],
  },
  routes: [
    { method: 'GET', path: '/products', action: 'list', collection: 'products', filters: ['category'], sort: true, paginate: true, query: { limit: { type: 'integer', min: 1, max: 100 } } },
    { method: 'GET', path: '/products/{id}', action: 'get', collection: 'products' },
    {
      method: 'POST',
      path: '/orders',
      action: 'create',
      collection: 'orders',
      auth: true,
      body: { product_id: { type: 'integer', required: true }, quantity: { type: 'integer', required: true, min: 1 } },
    },
    { method: 'PATCH', path: '/orders/{id}', action: 'update', collection: 'orders', auth: true, body: { quantity: { type: 'integer', min: 1 } } },
    { method: 'DELETE', path: '/orders/{id}', action: 'delete', collection: 'orders', auth: true },
  ],
  auth: { tokens: ['demo-token-123'] },
  cors: { allowOrigins: ['https://shop.local'], allowMethods: ['GET', 'POST'], allowHeaders: ['Content-Type'] },
};

const send = (server: HttpSimServer, text: string) => {
  const res = server.handle(parseRequest(text));
  return { ...res, json: res.body ? JSON.parse(res.body) : null };
};
const AUTH = 'Authorization: Bearer demo-token-123\nContent-Type: application/json';

describe('HttpSimServer', () => {
  it('lists with filters, sorting and pagination', () => {
    const s = new HttpSimServer(SHOP);
    expect(send(s, 'GET /products?category=drinks&sort=-price').json.map((p: { name: string }) => p.name)).toEqual(['Кофе', 'Чай']);
    const page = send(s, 'GET /products?page=2&limit=2');
    expect(page.json.map((p: { id: number }) => p.id)).toEqual([3]);
    expect(findHeader(page.headers, 'X-Total-Count')).toBe('3');
    expect(send(s, 'GET /products?limit=500').json.detail[0]).toMatchObject({ type: 'less_than_equal', loc: ['query', 'limit'] });
  });

  it('answers 404, 405 and 422 like FastAPI', () => {
    const s = new HttpSimServer(SHOP);
    expect(send(s, 'GET /products/9')).toMatchObject({ status: 404, json: { detail: 'Not found' } });
    expect(send(s, 'GET /nothing').status).toBe(404);
    const wrong = send(s, 'PUT /products');
    expect(wrong.status).toBe(405);
    expect(findHeader(wrong.headers, 'Allow')).toBe('GET');
    expect(send(s, 'GET /products/abc').json.detail[0]).toMatchObject({ type: 'int_parsing', loc: ['path', 'id'] });
  });

  it('creates, updates and deletes with authorization', () => {
    const s = new HttpSimServer(SHOP);
    expect(send(s, 'POST /orders\nContent-Type: application/json\n\n{"product_id": 1, "quantity": 2}')).toMatchObject({ status: 401, json: { detail: 'Not authenticated' } });
    expect(send(s, 'POST /orders\nAuthorization: Bearer wrong\n\n{}').json.detail).toBe('Invalid authentication credentials');
    const created = send(s, `POST /orders\n${AUTH}\n\n{"product_id": 1, "quantity": "2"}`);
    expect(created).toMatchObject({ status: 201, json: { id: 1, product_id: 1, quantity: 2 } });
    expect(findHeader(created.headers, 'Location')).toBe('/orders/1');
    expect(send(s, `POST /orders\n${AUTH}\n\n{"quantity": 0}`).json.detail.map((d: { type: string }) => d.type)).toEqual(['missing', 'greater_than_equal']);
    expect(send(s, `PATCH /orders/1\n${AUTH}\n\n{"quantity": 5}`).json).toEqual({ id: 1, product_id: 1, quantity: 5 });
    expect(send(s, `DELETE /orders/1\n${AUTH}`)).toMatchObject({ status: 204, body: '' });
    expect(send(s, `DELETE /orders/1\n${AUTH}`).status).toBe(404);
    expect(send(s, `POST /orders\n${AUTH}\n\n{"product_id": 1,}`).json.detail[0].type).toBe('json_invalid');
  });

  it('limits the request rate', () => {
    const s = new HttpSimServer({ ...SHOP, rateLimit: 2 });
    send(s, 'GET /products');
    send(s, 'GET /products');
    const third = send(s, 'GET /products');
    expect(third.status).toBe(429);
    expect(findHeader(third.headers, 'Retry-After')).toBe('60');
  });
});

describe('CORS', () => {
  const fetchFrom = (origin: string, text: string, credentials = false, cors = SHOP.cors) =>
    browserFetch(new HttpSimServer(SHOP), cors, { origin, request: parseRequest(text), credentials });

  it('lets a simple GET through from an allowed origin', () => {
    const ex = fetchFrom('https://shop.local', 'GET /products');
    expect(ex.map((e) => e.kind)).toEqual(['request']);
    expect(fetchSucceeded(ex)).toBe(true);
    expect(findHeader(ex[0].response!.headers, 'Access-Control-Allow-Origin')).toBe('https://shop.local');
  });

  it('blocks a foreign origin but the server still answered', () => {
    const ex = fetchFrom('https://evil.example', 'GET /products');
    expect(ex[0].response!.status).toBe(200);
    expect(ex[0].error).toContain("No 'Access-Control-Allow-Origin' header");
    expect(explainCors(ex[0].error!)).toContain('allow_origins');
  });

  it('sends a preflight for JSON and Authorization and checks its answer', () => {
    expect(isSimpleRequest(parseRequest('POST /orders\nContent-Type: text/plain'))).toBe(true);
    const ex = fetchFrom('https://shop.local', `POST /orders\n${AUTH}\n\n{"product_id": 1, "quantity": 1}`);
    expect(ex.map((e) => e.kind)).toEqual(['preflight', 'request']);
    expect(findHeader(ex[0].request.headers, 'Access-Control-Request-Headers')).toBe('authorization,content-type');
    expect(ex[0].response!.status).toBe(400);
    expect(ex[1].response).toBeNull();
    expect(ex[1].error).toContain('HTTP ok status');

    const open = { ...SHOP.cors!, allowHeaders: ['Content-Type', 'Authorization'] };
    const ok = fetchFrom('https://shop.local', `POST /orders\n${AUTH}\n\n{"product_id": 1, "quantity": 1}`, false, open);
    expect(fetchSucceeded(ok)).toBe(true);
    expect(ok[1].response!.status).toBe(201);

    const put = fetchFrom('https://shop.local', `PATCH /orders/1\n${AUTH}\n\n{"quantity": 2}`, false, open);
    expect(put[0].response!.status).toBe(400);
  });

  it('refuses the wildcard with credentials', () => {
    const star = { allowOrigins: ['*'], allowMethods: ['*'], allowHeaders: ['*'] };
    const ex = fetchFrom('https://shop.local', 'GET /products', true, star);
    expect(ex[0].error).toContain('wildcard');
    expect(fetchSucceeded(fetchFrom('https://shop.local', 'GET /products', true, { ...star, allowOrigins: ['https://shop.local'], allowCredentials: true }))).toBe(true);
  });
});

describe('nested resources', () => {
  it('lists and creates children of an existing parent', () => {
    const server = new HttpSimServer({
      baseUrl: 'https://api.shop.local',
      collections: { customers: [{ id: 1 }, { id: 2 }], orders: [{ id: 1, customer_id: 1 }, { id: 2, customer_id: 2 }] },
      routes: [
        { method: 'GET', path: '/customers/{id}/orders', action: 'list', collection: 'orders', parent: { collection: 'customers', field: 'customer_id' } },
        { method: 'POST', path: '/customers/{id}/orders', action: 'create', collection: 'orders', parent: { collection: 'customers', field: 'customer_id' }, body: { total: { type: 'integer' } } },
      ],
    });
    expect(JSON.parse(send(server, 'GET /customers/2/orders').body)).toEqual([{ id: 2, customer_id: 2 }]);
    expect(send(server, 'GET /customers/9/orders').status).toBe(404);
    const created = send(server, 'POST /customers/1/orders\nContent-Type: application/json\n\n{"total": 5}');
    expect(created.status).toBe(201);
    expect(findHeader(created.headers, 'location')).toBe('/customers/1/orders/3');
    expect(JSON.parse(send(server, 'GET /customers/1/orders').body)).toHaveLength(2);
  });
});
