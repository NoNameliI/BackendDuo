import type { ForeignKeyInfo, SchemaInfo, TableInfo } from '../types';

/** One round trip: every user table/view with columns, constraints and indexes as a JSON document. */
export const INTROSPECT_SQL = `
SELECT coalesce(json_agg(t ORDER BY t.schema, t.name), '[]'::json) AS doc FROM (
  SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
    (SELECT coalesce(json_agg(json_build_object(
        'name', a.attname,
        'type', format_type(a.atttypid, a.atttypmod),
        'notNull', a.attnotnull,
        'default', pg_get_expr(d.adbin, d.adrelid),
        'identity', a.attidentity <> '') ORDER BY a.attnum), '[]'::json)
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
    (SELECT coalesce(json_agg(json_build_object(
        'name', con.conname,
        'type', con.contype,
        'columns', (SELECT json_agg(a.attname ORDER BY k.ord)
                    FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum),
        'refTable', CASE WHEN con.contype = 'f' THEN con.confrelid::regclass::text END,
        'refColumns', (SELECT json_agg(a.attname ORDER BY k.ord)
                       FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
                       JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum),
        'onDelete', con.confdeltype,
        'definition', pg_get_constraintdef(con.oid)) ORDER BY con.conname), '[]'::json)
      FROM pg_constraint con WHERE con.conrelid = c.oid) AS constraints,
    (SELECT coalesce(json_agg(json_build_object(
        'name', ic.relname,
        'method', am.amname,
        'unique', i.indisunique,
        'primary', i.indisprimary,
        'columns', (SELECT json_agg(pg_get_indexdef(i.indexrelid, k + 1, true) ORDER BY k)
                    FROM generate_series(0, i.indnatts - 1) k),
        'definition', pg_get_indexdef(i.indexrelid)) ORDER BY ic.relname), '[]'::json)
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_am am ON am.oid = ic.relam
      WHERE i.indrelid = c.oid) AS indexes
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg\\_%'
) t`;

interface RawConstraint {
  name: string;
  type: 'p' | 'f' | 'u' | 'c' | 'x' | 'n' | 't';
  columns: string[] | null;
  refTable: string | null;
  refColumns: string[] | null;
  onDelete: string;
  definition: string;
}

interface RawTable extends Omit<TableInfo, 'kind' | 'primaryKey' | 'foreignKeys' | 'uniques' | 'checks'> {
  kind: string;
  constraints: RawConstraint[];
}

const ON_DELETE: Record<string, ForeignKeyInfo['onDelete']> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
};

export function toSchemaInfo(raw: RawTable[]): SchemaInfo {
  return {
    tables: raw.map(({ constraints, kind, ...table }) => ({
      ...table,
      kind: kind === 'v' || kind === 'm' ? 'view' : 'table',
      primaryKey: constraints.find((c) => c.type === 'p')?.columns ?? [],
      foreignKeys: constraints
        .filter((c) => c.type === 'f')
        .map((c) => ({
          name: c.name,
          columns: c.columns ?? [],
          refTable: c.refTable ?? '',
          refColumns: c.refColumns ?? [],
          onDelete: ON_DELETE[c.onDelete] ?? 'no action',
        })),
      uniques: constraints.filter((c) => c.type === 'u').map((c) => ({ name: c.name, columns: c.columns ?? [] })),
      checks: constraints.filter((c) => c.type === 'c').map((c) => ({ name: c.name, definition: c.definition })),
    })),
  };
}
