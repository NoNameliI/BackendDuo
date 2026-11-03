import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planNodes } from './plan';
import { PostgresEngine } from './PostgresEngine';

const engine = new PostgresEngine();

beforeAll(() => engine.init(), 30_000);
afterAll(() => engine.dispose());

const SHOP = `
CREATE TABLE customers (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  city text DEFAULT 'Москва'
);
CREATE TABLE orders (
  id serial PRIMARY KEY,
  customer_id int NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  total numeric(10, 2) CHECK (total >= 0),
  paid boolean NOT NULL DEFAULT false,
  created_on date NOT NULL
);
CREATE INDEX orders_created_on_idx ON orders (created_on);
INSERT INTO customers (email, city) VALUES ('a@shop.ru', 'Казань'), ('b@shop.ru', NULL);
INSERT INTO orders (customer_id, total, paid, created_on) VALUES (1, 10.5, true, '2024-03-01'), (1, 99, false, '2024-03-02');
`;

describe('PostgresEngine.execute', () => {
  it('returns per-statement results with PostgreSQL text values', async () => {
    await engine.reset(SHOP);
    const out = await engine.execute(
      `UPDATE orders SET paid = true WHERE id = 2;\nSELECT o.id, c.id, o.total, o.paid, o.created_on, c.city FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id`,
    );
    expect(out.error).toBeUndefined();
    expect(out.results.map((r) => [r.command, r.rowCount])).toEqual([
      ['UPDATE', 1],
      ['SELECT', 2],
    ]);
    const select = out.results[1];
    expect(select.columns.map((c) => `${c.name}:${c.type}`)).toEqual([
      'id:integer',
      'id:integer',
      'total:numeric',
      'paid:boolean',
      'created_on:date',
      'city:text',
    ]);
    expect(select.rows).toEqual([
      ['1', '1', '10.50', 't', '2024-03-01', 'Казань'],
      ['2', '1', '99.00', 't', '2024-03-02', 'Казань'],
    ]);
  });

  it('stops at the first error, keeps earlier statements and reports an absolute position', async () => {
    await engine.reset(SHOP);
    const out = await engine.execute(`DELETE FROM orders WHERE id = 1;\nSELECT nope\n  FROM orders;\nSELECT 1`);
    expect(out.results).toHaveLength(1);
    expect(out.error).toMatchObject({ code: '42703', line: 2, column: 8, statementIndex: 1 });
    const count = await engine.execute('SELECT count(*) FROM orders');
    expect(count.results[0].rows).toEqual([['1']]);
  });

  it('rolls back an aborted transaction so the session stays usable', async () => {
    await engine.reset(SHOP);
    const failed = await engine.execute(`BEGIN; INSERT INTO orders (customer_id, total, created_on) VALUES (1, -5, '2024-01-01')`);
    expect(failed.error?.code).toBe('23514');
    const after = await engine.execute('SELECT count(*) FROM orders');
    expect(after.error).toBeUndefined();
    expect(after.results[0].rows).toEqual([['2']]);
  });

  it('collects notices', async () => {
    await engine.reset('');
    const out = await engine.execute(`DO $$ BEGIN RAISE NOTICE 'привет %', 42; END $$`);
    expect(out.notices).toEqual(['привет 42']);
  });

  it('handles user-defined types', async () => {
    await engine.reset(`CREATE TYPE mood AS ENUM ('ok', 'sad'); CREATE TABLE m (v mood); INSERT INTO m VALUES ('sad');`);
    const out = await engine.execute('SELECT v FROM m');
    expect(out.results[0].columns[0].type).toBe('mood');
    expect(out.results[0].rows).toEqual([['sad']]);
  });
});

describe('PostgresEngine.reset', () => {
  it('drops user objects, schemas and session settings', async () => {
    await engine.reset(SHOP);
    await engine.execute(`CREATE SCHEMA extra; CREATE TABLE extra.t (id int); SET enable_seqscan = off; CREATE TEMP TABLE tmp (x int)`);
    await engine.reset('');
    expect((await engine.introspect()).tables).toEqual([]);
    const setting = await engine.execute('SHOW enable_seqscan');
    expect(setting.results[0].rows).toEqual([['on']]);
  });
});

describe('PostgresEngine.explain', () => {
  it('switches from Seq Scan to Index Scan once an index exists', async () => {
    await engine.reset(`CREATE TABLE big AS SELECT g AS id, md5(g::text) AS note FROM generate_series(1, 50000) g;`);
    const before = await engine.explain('SELECT * FROM big WHERE id = 42');
    const types = (outcome: typeof before) => {
      return outcome.plan ? planNodes(outcome.plan.root).map((n) => n.type) : [];
    };
    expect(types(before)).toContain('Seq Scan');

    await engine.execute('CREATE INDEX big_id_idx ON big (id); ANALYZE big');
    const after = await engine.explain('SELECT * FROM big WHERE id = 42');
    expect(types(after).some((t) => t.startsWith('Index'))).toBe(true);
    expect(after.plan!.root.totalCost).toBeLessThan(before.plan!.root.totalCost);
  });

  it('analyzes only read-only statements and maps error positions', async () => {
    await engine.reset(SHOP);
    const analyzed = await engine.explain('SELECT * FROM orders', { analyze: true });
    expect(analyzed.plan?.analyzed).toBe(true);
    expect(analyzed.plan?.root.actualRows).toBe(2);

    const dml = await engine.explain('DELETE FROM orders', { analyze: true });
    expect(dml.plan?.analyzed).toBe(false);
    expect((await engine.execute('SELECT count(*) FROM orders')).results[0].rows).toEqual([['2']]);

    const bad = await engine.explain('SELECT 1;\nSELECT nope FROM orders');
    expect(bad.error).toMatchObject({ code: '42703', line: 2, column: 8 });
  });
});

describe('PostgresEngine.introspect', () => {
  it('describes tables, keys, constraints and indexes', async () => {
    await engine.reset(SHOP);
    const { tables } = await engine.introspect();
    expect(tables.map((t) => t.name)).toEqual(['customers', 'orders']);

    const [customers, orders] = tables;
    expect(customers.primaryKey).toEqual(['id']);
    expect(customers.uniques).toEqual([{ name: 'customers_email_key', columns: ['email'] }]);
    expect(customers.columns.find((c) => c.name === 'city')).toMatchObject({ type: 'text', notNull: false });
    expect(customers.columns.find((c) => c.name === 'id')?.default).toMatch(/^nextval/);

    expect(orders.foreignKeys).toEqual([
      { name: 'orders_customer_id_fkey', columns: ['customer_id'], refTable: 'customers', refColumns: ['id'], onDelete: 'cascade' },
    ]);
    expect(orders.columns.find((c) => c.name === 'total')?.type).toBe('numeric(10,2)');
    expect(orders.checks[0].definition).toBe('CHECK ((total >= (0)::numeric))');
    expect(orders.indexes.map((i) => [i.name, i.method, i.primary, i.columns.join()])).toEqual([
      ['orders_created_on_idx', 'btree', false, 'created_on'],
      ['orders_pkey', 'btree', true, 'id'],
    ]);
  });
});
