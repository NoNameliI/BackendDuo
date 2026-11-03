import { describe, expect, it } from 'vitest';
import { fromSchema, toDdl, validateModel, type ErdColumn, type ErdModel, type ErdTable } from './model';

const col = (id: string, name: string, type: string, extra: Partial<ErdColumn> = {}): ErdColumn => ({
  id,
  name,
  type,
  pk: false,
  notNull: false,
  unique: false,
  ...extra,
});

const table = (id: string, name: string, columns: ErdColumn[], locked = false): ErdTable => ({ id, name, x: 0, y: 0, locked, columns });

describe('toDdl', () => {
  it('orders referenced tables first and renders constraints', () => {
    const model: ErdModel = {
      tables: [
        table('o', 'orders', [
          col('o1', 'id', 'serial', { pk: true }),
          col('o2', 'customer_id', 'integer', { notNull: true, ref: { table: 'c', column: 'c1' } }),
        ]),
        table('c', 'customers', [col('c1', 'id', 'serial', { pk: true }), col('c2', 'email', 'text', { notNull: true, unique: true })]),
      ],
    };
    expect(toDdl(model)).toBe(
      [
        'CREATE TABLE customers (\n  id serial PRIMARY KEY,\n  email text NOT NULL UNIQUE\n);',
        'CREATE TABLE orders (\n  id serial PRIMARY KEY,\n  customer_id integer NOT NULL REFERENCES customers (id)\n);',
      ].join('\n\n'),
    );
  });

  it('uses a composite primary key and skips locked tables', () => {
    const model: ErdModel = {
      tables: [
        table('p', 'products', [col('p1', 'id', 'integer', { pk: true })], true),
        table('t', 'tags', [col('t1', 'id', 'serial', { pk: true })]),
        table('pt', 'product_tags', [
          col('a', 'product_id', 'integer', { pk: true, ref: { table: 'p', column: 'p1' } }),
          col('b', 'tag_id', 'integer', { pk: true, ref: { table: 't', column: 't1' } }),
        ]),
      ],
    };
    const ddl = toDdl(model);
    expect(ddl).not.toContain('CREATE TABLE products');
    expect(ddl).toContain(
      'CREATE TABLE product_tags (\n  product_id integer REFERENCES products (id),\n  tag_id integer REFERENCES tags (id),\n  PRIMARY KEY (product_id, tag_id)\n);',
    );
    expect(ddl.indexOf('CREATE TABLE tags')).toBeLessThan(ddl.indexOf('CREATE TABLE product_tags'));
  });

  it('breaks reference cycles with ALTER TABLE', () => {
    const model: ErdModel = {
      tables: [
        table('a', 'a', [col('a1', 'id', 'serial', { pk: true }), col('a2', 'b_id', 'integer', { ref: { table: 'b', column: 'b1' } })]),
        table('b', 'b', [col('b1', 'id', 'serial', { pk: true }), col('b2', 'a_id', 'integer', { ref: { table: 'a', column: 'a1' } })]),
      ],
    };
    const ddl = toDdl(model);
    expect(ddl).toContain('ALTER TABLE b\n  ADD FOREIGN KEY (a_id) REFERENCES a (id);');
    expect(ddl).toContain('  b_id integer REFERENCES b (id)');
  });
});

describe('validateModel', () => {
  it('reports names, keys and invalid references', () => {
    const model: ErdModel = {
      tables: [
        table('x', 'Bad Name', [col('x1', 'id', 'serial')]),
        table('y', 'y', [col('y1', 'id', 'serial', { pk: true }), col('y2', 'ref', 'integer', { ref: { table: 'y', column: 'y3' } }), col('y3', 'note', 'text')]),
      ],
    };
    expect(validateModel(model)).toEqual([
      'Имя таблицы «Bad Name»: только латиница в нижнем регистре, цифры и _',
      'У таблицы Bad Name нет первичного ключа',
      'y.ref: ссылаться можно только на PRIMARY KEY или UNIQUE (y.note)',
    ]);
  });
});

describe('fromSchema', () => {
  it('turns existing tables into locked nodes', () => {
    const model = fromSchema({
      tables: [
        {
          schema: 'public',
          name: 'customers',
          kind: 'table',
          columns: [{ name: 'id', type: 'integer', notNull: true, default: null, identity: false }],
          primaryKey: ['id'],
          foreignKeys: [],
          uniques: [],
          checks: [],
          indexes: [],
        },
      ],
    });
    expect(model.tables[0]).toMatchObject({ name: 'customers', locked: true, columns: [{ name: 'id', pk: true }] });
  });
});
