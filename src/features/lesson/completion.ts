import type { SchemaInfo, TableInfo } from '@/engine';

export interface CompletionItem {
  label: string;
  kind: 'table' | 'column' | 'keyword' | 'function';
  detail?: string;
}

const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET', 'DISTINCT', 'AS',
  'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'ON', 'USING',
  'AND', 'OR', 'NOT', 'IN', 'IS NULL', 'IS NOT NULL', 'BETWEEN', 'LIKE', 'ILIKE', 'EXISTS',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT', 'WITH', 'RECURSIVE',
  'INSERT INTO', 'VALUES', 'RETURNING', 'UPDATE', 'SET', 'DELETE FROM', 'ON CONFLICT', 'DO NOTHING',
  'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'ADD COLUMN', 'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES',
  'UNIQUE', 'CHECK', 'DEFAULT', 'NOT NULL', 'CONSTRAINT', 'CASCADE', 'CREATE INDEX', 'CREATE VIEW',
  'EXPLAIN', 'ANALYZE', 'OVER', 'PARTITION BY', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT',
  'ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST',
];

const FUNCTIONS = [
  'count', 'sum', 'avg', 'min', 'max', 'coalesce', 'nullif', 'round', 'abs', 'lower', 'upper', 'length',
  'trim', 'concat', 'string_agg', 'array_agg', 'now', 'current_date', 'date_trunc', 'extract', 'age',
  'row_number', 'rank', 'dense_rank', 'lag', 'lead', 'first_value', 'last_value', 'ntile',
];

const NOT_ALIAS = new Set([
  'on', 'using', 'where', 'join', 'inner', 'left', 'right', 'full', 'cross', 'natural', 'group', 'order',
  'limit', 'offset', 'having', 'union', 'set', 'values', 'returning', 'window', 'lateral',
]);

const TABLE_REF = /\b(?:from|join|update|into)\s+(?:"?\w+"?\.)?"?(\w+)"?(?:\s+(?:as\s+)?"?(\w+)"?)?/gi;

/** Maps aliases and table names used in the query to tables of the schema. */
export function tableAliases(sql: string, schema: SchemaInfo): Map<string, TableInfo> {
  const byName = new Map(schema.tables.map((t) => [t.name.toLowerCase(), t]));
  const aliases = new Map<string, TableInfo>(byName);
  for (const match of sql.matchAll(TABLE_REF)) {
    const table = byName.get(match[1].toLowerCase());
    const alias = match[2]?.toLowerCase();
    if (table && alias && !NOT_ALIAS.has(alias)) aliases.set(alias, table);
  }
  return aliases;
}

export function completionsAt(textBefore: string, fullText: string, schema: SchemaInfo | null): CompletionItem[] {
  const tables = schema?.tables ?? [];
  const qualifier = /"?(\w+)"?\.\w*$/.exec(textBefore);
  if (qualifier && schema) {
    const table = tableAliases(fullText, schema).get(qualifier[1].toLowerCase());
    return table ? table.columns.map((c) => ({ label: c.name, kind: 'column', detail: c.type })) : [];
  }

  const items: CompletionItem[] = tables.map((t) => ({ label: t.name, kind: 'table', detail: t.kind === 'view' ? 'view' : 'table' }));
  const seen = new Set<string>();
  for (const t of tables) {
    for (const c of t.columns) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      const owners = tables.filter((o) => o.columns.some((oc) => oc.name === c.name)).map((o) => o.name);
      items.push({ label: c.name, kind: 'column', detail: `${owners.join(', ')} · ${c.type}` });
    }
  }
  items.push(...FUNCTIONS.map((f) => ({ label: f, kind: 'function' as const })));
  items.push(...KEYWORDS.map((k) => ({ label: k, kind: 'keyword' as const })));
  return items;
}
