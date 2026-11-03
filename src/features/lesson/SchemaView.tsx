import type { SchemaInfo, TableInfo } from '@/engine';
import { EmptyState } from '@/ui/Panel';

export function SchemaView({ schema }: { schema: SchemaInfo | null }) {
  if (!schema || schema.tables.length === 0) return <EmptyState>В базе пока нет таблиц.</EmptyState>;
  return (
    <div className="grid h-full auto-rows-min grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2 overflow-auto p-2">
      {schema.tables.map((t) => (
        <TableCard key={`${t.schema}.${t.name}`} table={t} />
      ))}
    </div>
  );
}

function TableCard({ table }: { table: TableInfo }) {
  const fkByColumn = new Map(table.foreignKeys.flatMap((fk) => fk.columns.map((c, i) => [c, `${fk.refTable}.${fk.refColumns[i]}`])));
  const uniqueColumns = new Set(table.uniques.filter((u) => u.columns.length === 1).map((u) => u.columns[0]));
  const extraIndexes = table.indexes.filter((i) => !i.primary && !table.uniques.some((u) => u.name === i.name));

  return (
    <article className="overflow-hidden rounded border border-line bg-well font-mono text-[12px]">
      <header className="flex items-baseline gap-2 border-b border-line bg-raised/50 px-2.5 py-1.5">
        <h3 className="font-semibold text-fg">{table.name}</h3>
        {table.schema !== 'public' && <span className="text-faint">{table.schema}</span>}
        {table.kind === 'view' && <span className="ml-auto text-[10px] uppercase tracking-wider text-amber">view</span>}
      </header>
      <ul>
        {table.columns.map((col) => {
          const pk = table.primaryKey.includes(col.name);
          const fk = fkByColumn.get(col.name);
          return (
            <li key={col.name} className="flex items-baseline gap-2 px-2.5 py-0.5">
              <span className="w-5 shrink-0 text-[10px] font-semibold">
                {pk ? <span className="text-amber">PK</span> : fk ? <span className="text-nav">FK</span> : null}
              </span>
              <span className={pk ? 'text-fg' : 'text-dim'}>{col.name}</span>
              <span className="ml-auto truncate text-faint">
                {col.type}
                {col.notNull && !pk && ' ·NN'}
                {uniqueColumns.has(col.name) && ' ·U'}
              </span>
              {fk && <span className="sr-only">ссылается на {fk}</span>}
            </li>
          );
        })}
      </ul>
      {(table.foreignKeys.length > 0 || extraIndexes.length > 0 || table.checks.length > 0) && (
        <footer className="space-y-0.5 border-t border-line px-2.5 py-1.5 text-[11px] text-faint">
          {table.foreignKeys.map((fk) => (
            <p key={fk.name}>
              <span className="text-nav">→</span> {fk.columns.join(', ')} → {fk.refTable}({fk.refColumns.join(', ')})
              {fk.onDelete !== 'no action' && ` · on delete ${fk.onDelete}`}
            </p>
          ))}
          {table.checks.map((c) => (
            <p key={c.name}>{c.definition}</p>
          ))}
          {extraIndexes.map((i) => (
            <p key={i.name}>
              idx {i.name} · {i.method}({i.columns.join(', ')})
            </p>
          ))}
        </footer>
      )}
    </article>
  );
}
