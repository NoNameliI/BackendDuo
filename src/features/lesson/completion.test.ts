import { describe, expect, it } from 'vitest';
import type { SchemaInfo, TableInfo } from '@/engine';
import { completionsAt, tableAliases } from './completion';

const table = (name: string, columns: string[]): TableInfo => ({
  schema: 'public',
  name,
  kind: 'table',
  columns: columns.map((c) => ({ name: c, type: 'integer', notNull: false, default: null, identity: false })),
  primaryKey: [],
  foreignKeys: [],
  uniques: [],
  checks: [],
  indexes: [],
});

const schema: SchemaInfo = {
  tables: [table('customers', ['id', 'email']), table('orders', ['id', 'customer_id', 'total'])],
};

describe('completion', () => {
  it('resolves aliases from FROM and JOIN clauses', () => {
    const aliases = tableAliases('SELECT * FROM orders o JOIN customers AS c ON c.id = o.customer_id', schema);
    expect(aliases.get('o')?.name).toBe('orders');
    expect(aliases.get('c')?.name).toBe('customers');
    expect(aliases.has('on')).toBe(false);
  });

  it('suggests only columns of the qualified table after a dot', () => {
    const sql = 'SELECT o. FROM orders o';
    const items = completionsAt('SELECT o.', sql, schema);
    expect(items.map((i) => i.label)).toEqual(['id', 'customer_id', 'total']);
    expect(completionsAt('SELECT x.', 'SELECT x.', schema)).toEqual([]);
  });

  it('offers tables, unique columns, functions and keywords otherwise', () => {
    const items = completionsAt('SELECT ', 'SELECT ', schema);
    expect(items.filter((i) => i.kind === 'table').map((i) => i.label)).toEqual(['customers', 'orders']);
    const id = items.filter((i) => i.label === 'id');
    expect(id).toHaveLength(1);
    expect(id[0].detail).toBe('customers, orders · integer');
    expect(items.some((i) => i.kind === 'keyword' && i.label === 'GROUP BY')).toBe(true);
  });
});
