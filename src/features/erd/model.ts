import type { SchemaInfo } from '@/engine';

export const ERD_TYPES = [
  'serial',
  'integer',
  'bigint',
  'text',
  'varchar(100)',
  'numeric(10, 2)',
  'boolean',
  'date',
  'timestamp',
] as const;

export interface ErdColumn {
  id: string;
  name: string;
  type: string;
  pk: boolean;
  notNull: boolean;
  unique: boolean;
  ref?: { table: string; column: string };
}

export interface ErdTable {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Tables that already exist in the task database: shown and referenceable, never recreated. */
  locked: boolean;
  columns: ErdColumn[];
}

export interface ErdModel {
  tables: ErdTable[];
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

let seq = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newColumn(name = '', type = 'integer'): ErdColumn {
  return { id: newId('c'), name, type, pk: false, notNull: false, unique: false };
}

export function newTable(name: string, x: number, y: number): ErdTable {
  return { id: newId('t'), name, x, y, locked: false, columns: [{ ...newColumn('id', 'serial'), pk: true }] };
}

/** Existing tables of the task database become locked nodes laid out on a grid. */
export function fromSchema(schema: SchemaInfo | null): ErdModel {
  const tables = (schema?.tables ?? [])
    .filter((t) => t.kind === 'table')
    .map((t, i) => ({
      id: `db_${t.name}`,
      name: t.name,
      x: 24 + (i % 3) * 260,
      y: 24 + Math.floor(i / 3) * 220,
      locked: true,
      columns: t.columns.map((c) => ({
        id: `db_${t.name}_${c.name}`,
        name: c.name,
        type: c.type,
        pk: t.primaryKey.includes(c.name),
        notNull: c.notNull,
        unique: t.uniques.some((u) => u.columns.length === 1 && u.columns[0] === c.name),
      })),
    }));
  return { tables };
}

const columnOf = (model: ErdModel, ref: { table: string; column: string }) => {
  const table = model.tables.find((t) => t.id === ref.table);
  return { table, column: table?.columns.find((c) => c.id === ref.column) };
};

/** Problems that make the resulting DDL meaningless; shown next to the canvas. */
export function validateModel(model: ErdModel): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const t of model.tables) {
    if (!IDENT.test(t.name)) problems.push(`Имя таблицы «${t.name || '(пусто)'}»: только латиница в нижнем регистре, цифры и _`);
    if (names.has(t.name)) problems.push(`Таблица ${t.name} встречается дважды`);
    names.add(t.name);
    if (t.locked) continue;
    if (t.columns.length === 0) problems.push(`В таблице ${t.name} нет колонок`);
    if (!t.columns.some((c) => c.pk)) problems.push(`У таблицы ${t.name} нет первичного ключа`);
    const columnNames = new Set<string>();
    for (const c of t.columns) {
      if (!IDENT.test(c.name)) problems.push(`${t.name}: имя колонки «${c.name || '(пусто)'}» недопустимо`);
      if (columnNames.has(c.name)) problems.push(`${t.name}: колонка ${c.name} встречается дважды`);
      columnNames.add(c.name);
      if (c.ref) {
        const target = columnOf(model, c.ref);
        if (!target.column) problems.push(`${t.name}.${c.name}: связь ведёт к удалённой колонке`);
        else if (!target.column.pk && !target.column.unique) {
          problems.push(`${t.name}.${c.name}: ссылаться можно только на PRIMARY KEY или UNIQUE (${target.table!.name}.${target.column.name})`);
        }
      }
    }
  }
  return problems;
}


/**
 * Builds CREATE TABLE statements for the new (unlocked) tables. Tables are ordered so that referenced
 * tables come first; references that close a cycle are added afterwards with ALTER TABLE.
 */
export function toDdl(model: ErdModel): string {
  const fresh = model.tables.filter((t) => !t.locked);
  const byId = new Map(model.tables.map((t) => [t.id, t]));
  const ordered: ErdTable[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const deferred: { table: ErdTable; column: ErdColumn }[] = [];
  const inline = new Set<string>();

  const visit = (table: ErdTable) => {
    state.set(table.id, 'visiting');
    for (const column of table.columns) {
      const target = column.ref ? byId.get(column.ref.table) : undefined;
      if (!target || target.locked || target.id === table.id) {
        if (target) inline.add(column.id);
        continue;
      }
      const s = state.get(target.id);
      if (s === 'visiting') deferred.push({ table, column });
      else {
        if (s !== 'done') visit(target);
        inline.add(column.id);
      }
    }
    state.set(table.id, 'done');
    ordered.push(table);
  };
  fresh.forEach((t) => state.get(t.id) || visit(t));

  const refClause = (column: ErdColumn) => {
    const { table, column: target } = columnOf(model, column.ref!);
    return table && target ? ` REFERENCES ${table.name} (${target.name})` : '';
  };

  const statements = ordered.map((table) => {
    const pk = table.columns.filter((c) => c.pk);
    const lines = table.columns.map((c) => {
      let line = `  ${c.name} ${c.type}`;
      if (c.pk && pk.length === 1) line += ' PRIMARY KEY';
      else if (c.notNull) line += ' NOT NULL';
      if (c.unique && !c.pk) line += ' UNIQUE';
      if (c.ref && inline.has(c.id)) line += refClause(c);
      return line;
    });
    if (pk.length > 1) lines.push(`  PRIMARY KEY (${pk.map((c) => c.name).join(', ')})`);
    return `CREATE TABLE ${table.name} (\n${lines.join(',\n')}\n);`;
  });

  for (const { table, column } of deferred) {
    const { table: target, column: targetColumn } = columnOf(model, column.ref!);
    if (target && targetColumn) {
      statements.push(`ALTER TABLE ${table.name}\n  ADD FOREIGN KEY (${column.name}) REFERENCES ${target.name} (${targetColumn.name});`);
    }
  }
  return statements.join('\n\n');
}

/** Column type for a foreign key pointing at a column of `targetType`: serial is an integer with a sequence. */
export function foreignKeyType(targetType: string): string {
  return targetType === 'serial' ? 'integer' : targetType === 'bigserial' ? 'bigint' : targetType;
}
