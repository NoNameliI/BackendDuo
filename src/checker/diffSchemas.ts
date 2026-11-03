import type { ColumnInfo, SchemaInfo, TableInfo } from '@/engine';

export interface SchemaCheckOptions {
  tables?: string[];
  types: 'exact' | 'family' | 'ignore';
  defaults: boolean;
  checks: boolean;
  indexes: boolean;
}

const FAMILIES: Record<string, string> = {
  smallint: 'integer',
  integer: 'integer',
  bigint: 'integer',
  numeric: 'number',
  real: 'number',
  'double precision': 'number',
  text: 'text',
  'character varying': 'text',
  character: 'text',
  'timestamp without time zone': 'timestamp',
  'timestamp with time zone': 'timestamp',
  'time without time zone': 'time',
  'time with time zone': 'time',
  json: 'json',
  jsonb: 'json',
};

/** Groups interchangeable types: varchar(100) ~ text, integer ~ bigint, timestamp ~ timestamptz. */
export function typeFamily(type: string): string {
  const array = type.endsWith('[]');
  const base = type.replace(/\[\]$/, '').replace(/\(\d+(?:,\s*\d+)?\)/g, '').replace(/\s+/g, ' ').trim();
  return (FAMILIES[base] ?? base) + (array ? '[]' : '');
}

const isAutoIncrement = (c: ColumnInfo) => c.identity || /^nextval\(/.test(c.default ?? '');

const DEFAULT_SYNONYMS: Record<string, string> = {
  current_timestamp: 'now()',
  'transaction_timestamp()': 'now()',
};

function normalizeDefault(c: ColumnInfo): string | null {
  if (isAutoIncrement(c) || c.default === null) return null;
  const text = c.default.replace(/::[a-z_ ]+(?:\(\d+(?:,\s*\d+)?\))?(?:\[\])?/gi, '').trim().toLowerCase();
  return DEFAULT_SYNONYMS[text] ?? text;
}

const cols = (list: string[]) => list.join(', ');
const setKey = (list: string[]) => [...list].sort().join(',');

function uniqueSets(t: TableInfo): Map<string, string[]> {
  const sets = new Map<string, string[]>();
  t.uniques.forEach((u) => sets.set(setKey(u.columns), u.columns));
  t.indexes.filter((i) => i.unique && !i.primary).forEach((i) => sets.set(setKey(i.columns), i.columns));
  return sets;
}

function plainIndexes(t: TableInfo): Map<string, string> {
  const map = new Map<string, string>();
  t.indexes
    .filter((i) => !i.primary && !i.unique)
    .forEach((i) => map.set(`${i.method}:${i.columns.join(',')}`, `${i.method} (${cols(i.columns)})`));
  return map;
}

function diffTable(e: TableInfo, a: TableInfo, o: SchemaCheckOptions): string[] {
  const p: string[] = [];
  const name = e.name;

  if (e.kind !== a.kind) p.push(`${name}: ожидалось ${e.kind === 'view' ? 'представление (VIEW)' : 'таблица'}`);

  const actualCols = new Map(a.columns.map((c) => [c.name, c]));
  for (const ec of e.columns) {
    const ac = actualCols.get(ec.name);
    if (!ac) {
      p.push(`${name}: нет колонки ${ec.name}`);
      continue;
    }
    if (e.kind === 'view') continue;
    const where = `${name}.${ec.name}`;
    if (o.types === 'exact' ? ec.type !== ac.type : o.types === 'family' && typeFamily(ec.type) !== typeFamily(ac.type)) {
      p.push(`${where}: тип ${ac.type}, а ожидался ${ec.type}`);
    }
    if (ec.notNull !== ac.notNull && !e.primaryKey.includes(ec.name)) {
      p.push(ec.notNull ? `${where}: должна быть NOT NULL` : `${where}: не должна быть NOT NULL`);
    }
    if (isAutoIncrement(ec) !== isAutoIncrement(ac)) {
      p.push(
        isAutoIncrement(ec)
          ? `${where}: значение должно генерироваться автоматически (serial или GENERATED … AS IDENTITY)`
          : `${where}: значение не должно генерироваться автоматически`,
      );
    } else if (o.defaults && normalizeDefault(ec) !== normalizeDefault(ac)) {
      p.push(`${where}: значение по умолчанию ${ac.default ?? 'не задано'}, ожидалось ${ec.default ?? 'без значения по умолчанию'}`);
    }
  }
  const expectedNames = new Set(e.columns.map((c) => c.name));
  a.columns.filter((c) => !expectedNames.has(c.name)).forEach((c) => p.push(`${name}: лишняя колонка ${c.name}`));
  if (e.kind === 'view') return p;

  if (setKey(e.primaryKey) !== setKey(a.primaryKey)) {
    p.push(
      e.primaryKey.length === 0
        ? `${name}: первичного ключа быть не должно`
        : `${name}: первичный ключ ${a.primaryKey.length ? `(${cols(a.primaryKey)})` : 'не задан'}, ожидался (${cols(e.primaryKey)})`,
    );
  }

  const fkKey = (fk: TableInfo['foreignKeys'][number]) => `${fk.columns.join(',')}>${fk.refTable}(${fk.refColumns.join(',')})`;
  const actualFks = new Map(a.foreignKeys.map((fk) => [fkKey(fk), fk]));
  for (const fk of e.foreignKeys) {
    const match = actualFks.get(fkKey(fk));
    const label = `(${cols(fk.columns)}) → ${fk.refTable}(${cols(fk.refColumns)})`;
    if (!match) p.push(`${name}: нет внешнего ключа ${label}`);
    else if (match.onDelete !== fk.onDelete) {
      p.push(`${name}: внешний ключ ${label} — ON DELETE ${match.onDelete.toUpperCase()}, ожидалось ${fk.onDelete.toUpperCase()}`);
    }
    actualFks.delete(fkKey(fk));
  }
  actualFks.forEach((fk) => p.push(`${name}: лишний внешний ключ (${cols(fk.columns)}) → ${fk.refTable}`));

  const eu = uniqueSets(e);
  const au = uniqueSets(a);
  eu.forEach((c, k) => !au.has(k) && p.push(`${name}: нет ограничения UNIQUE (${cols(c)})`));
  au.forEach((c, k) => !eu.has(k) && p.push(`${name}: лишнее ограничение UNIQUE (${cols(c)})`));

  if (o.checks && e.checks.length !== a.checks.length) {
    p.push(`${name}: ограничений CHECK ${a.checks.length}, ожидалось ${e.checks.length}`);
  }

  if (o.indexes) {
    const actualIndexes = plainIndexes(a);
    plainIndexes(e).forEach((label, k) => !actualIndexes.has(k) && p.push(`${name}: нет индекса ${label}`));
  }
  return p;
}

/** Compares the learner's schema with the reference one; extra unrelated tables are ignored. */
export function diffSchemas(expected: SchemaInfo, actual: SchemaInfo, options: SchemaCheckOptions): string[] {
  const names = options.tables ?? expected.tables.map((t) => t.name);
  const problems: string[] = [];
  for (const name of names) {
    const e = expected.tables.find((t) => t.name === name);
    if (!e) throw new Error(`schema check: table ${name} is missing in the reference solution`);
    const a = actual.tables.find((t) => t.name === name);
    if (!a) problems.push(`Нет ${e.kind === 'view' ? 'представления' : 'таблицы'} ${name}`);
    else problems.push(...diffTable(e, a, options));
  }
  return problems;
}
