import { describe, expect, it } from 'vitest';
import { findHeader, formatRequest, parseRequest, RequestFormatError, splitUrl, withQuery } from './http';

describe('request text', () => {
  it('parses method, URL, headers and body', () => {
    const req = parseRequest('post /orders?notify=true\nContent-Type: application/json\nAuthorization: Bearer demo-token\n\n{"product": "Чай"}\n');
    expect(req).toEqual({
      method: 'POST',
      url: '/orders?notify=true',
      headers: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Authorization', value: 'Bearer demo-token' },
      ],
      body: '{"product": "Чай"}',
    });
    expect(findHeader(req.headers, 'content-type')).toBe('application/json');
    expect(parseRequest(formatRequest(req))).toEqual(req);
  });

  it('explains malformed text', () => {
    expect(() => parseRequest('/orders')).toThrow(RequestFormatError);
    expect(() => parseRequest('GET /orders\nAccept application/json')).toThrow('без двоеточия');
  });

  it('splits and rebuilds URLs', () => {
    expect(splitUrl('https://api.shop.local/orders?status=new&page=2')).toEqual({
      origin: 'https://api.shop.local',
      path: '/orders',
      query: [
        ['status', 'new'],
        ['page', '2'],
      ],
    });
    expect(splitUrl('/products/7')).toEqual({ origin: '', path: '/products/7', query: [] });
    expect(withQuery('/products?x=1', [['category', 'чай'], ['', 'skip']])).toBe('/products?category=%D1%87%D0%B0%D0%B9');
  });
});
