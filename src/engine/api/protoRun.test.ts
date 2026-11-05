import { describe, expect, it } from 'vitest';
import { callRpc, encodeMessage, parseProto } from './protoRun';

const PROTO = `syntax = "proto3";
package shop;

enum Status { NEW = 0; PAID = 1; }

message Order {
  int32 id = 1;
  string status = 2;
  repeated string items = 3;
  optional string note = 4;
}

message OrderRequest { int32 id = 1; }
message OrdersRequest { string status = 1; }
message OrderList { repeated Order orders = 1; }

service OrderService {
  rpc GetOrder (OrderRequest) returns (Order);
  rpc ListOrders (OrdersRequest) returns (OrderList);
  rpc WatchOrders (OrdersRequest) returns (stream Order);
}`;

const DATA = { orders: [{ id: 1, status: 'new', items: ['Чай'] }, { id: 2, status: 'paid', items: ['Кофе', 'Печенье'] }, { id: 3, status: 'paid', items: [] }] };

describe('protobuf', () => {
  it('parses messages, fields, enums and services', () => {
    const p = parseProto(PROTO);
    if (!p.ok) throw new Error(p.error);
    expect(p.summary.package).toBe('shop');
    expect(p.summary.messages.find((m) => m.name === 'Order')!.fields).toEqual([
      { name: 'id', type: 'int32', number: 1, repeated: false, optional: false },
      { name: 'status', type: 'string', number: 2, repeated: false, optional: false },
      { name: 'items', type: 'string', number: 3, repeated: true, optional: false },
      { name: 'note', type: 'string', number: 4, repeated: false, optional: true },
    ]);
    expect(p.summary.enums).toEqual([{ name: 'Status', values: { NEW: 0, PAID: 1 } }]);
    expect(p.summary.services[0].methods.map((m) => [m.name, m.serverStream])).toEqual([
      ['GetOrder', false],
      ['ListOrders', false],
      ['WatchOrders', true],
    ]);
  });

  it('explains syntax errors and duplicate numbers in Russian', () => {
    const missing = parseProto('syntax = "proto3";\nmessage A {\n  int32 x = 1\n  string y = 2;\n}');
    expect(missing.ok ? '' : missing.error).toMatch(/строка 4/);
    const dup = parseProto('syntax = "proto3";\nmessage A { int32 x = 1; string y = 1; }');
    expect(dup.ok ? '' : dup.error).toMatch(/Номер поля 1 повторяется/);
  });

  it('encodes smaller than JSON', () => {
    const p = parseProto(PROTO);
    if (!p.ok) throw new Error(p.error);
    const e = encodeMessage(p.root, 'shop.Order', { id: 150, status: 'paid', items: ['Чай'] });
    if ('error' in e) throw new Error(e.error);
    expect(e.bytes).toBeLessThan(e.jsonBytes);
    expect(e.hex.startsWith('08 96 01')).toBe(true);
    expect(encodeMessage(p.root, 'shop.Order', { id: 'много' })).toEqual({ error: 'Значение не подходит под shop.Order: id: integer expected' });
  });

  it('models unary and streaming calls', () => {
    const p = parseProto(PROTO);
    if (!p.ok) throw new Error(p.error);
    const data = structuredClone(DATA);
    expect(callRpc(p.root, data, 'shop.OrderService', 'GetOrder', { id: 2 })).toMatchObject({ status: 'OK', messages: [{ id: 2, status: 'paid', items: ['Кофе', 'Печенье'] }] });
    expect(callRpc(p.root, data, 'shop.OrderService', 'GetOrder', { id: 9 }).status).toBe('NOT_FOUND');
    expect(callRpc(p.root, data, 'shop.OrderService', 'ListOrders', { status: 'paid' }).messages[0]).toMatchObject({ orders: [{ id: 2 }, { id: 3 }] });
    const stream = callRpc(p.root, data, 'shop.OrderService', 'WatchOrders', { status: 'paid' });
    expect(stream.messages.map((m) => m.id)).toEqual([2, 3]);
    expect(stream.bytes).toHaveLength(2);
  });
});
