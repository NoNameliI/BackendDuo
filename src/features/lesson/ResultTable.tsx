import { useMemo, useState } from 'react';
import type { Cell, StatementResult } from '@/engine';
import { plural } from '@/ui/format';
import { BOOLEAN_TYPE_ID, NUMERIC_TYPE_IDS } from './format';

const MAX_ROWS = 500;

interface Sort {
  column: number;
  dir: 1 | -1;
}

function compareCells(a: Cell, b: Cell, numeric: boolean): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return numeric ? Number(a) - Number(b) : a.localeCompare(b, 'ru');
}

export function ResultTable({ result }: { result: StatementResult }) {
  const [sort, setSort] = useState<Sort | null>(null);
  const numeric = useMemo(() => result.columns.map((c) => NUMERIC_TYPE_IDS.has(c.typeId)), [result]);

  const rows = useMemo(() => {
    const indexed = result.rows.map((row, i) => ({ row, n: i + 1 }));
    if (sort) indexed.sort((x, y) => sort.dir * compareCells(x.row[sort.column], y.row[sort.column], numeric[sort.column]));
    return indexed.slice(0, MAX_ROWS);
  }, [result, sort, numeric]);

  const toggleSort = (column: number) =>
    setSort((s) => (s?.column !== column ? { column, dir: 1 } : s.dir === 1 ? { column, dir: -1 } : null));

  const total = result.rows.length;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 font-mono text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr>
              <th className="border-b border-line px-2 py-1.5 text-right font-normal text-faint">#</th>
              {result.columns.map((col, i) => (
                <th
                  key={i}
                  scope="col"
                  aria-sort={sort?.column === i ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                  className={`border-b border-line p-0 font-normal ${numeric[i] ? 'text-right' : 'text-left'}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(i)}
                    className="flex w-full items-baseline gap-1.5 px-3 py-1.5 hover:bg-raised"
                    style={{ justifyContent: numeric[i] ? 'flex-end' : 'flex-start' }}
                  >
                    <span className="font-semibold text-fg">{col.name}</span>
                    <span className="text-[10.5px] text-faint">{col.type}</span>
                    {sort?.column === i && <span className="text-amber">{sort.dir === 1 ? '↑' : '↓'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, n }) => (
              <tr key={n} className="hover:bg-raised/60">
                <td className="border-b border-line/60 px-2 py-1 text-right text-faint tabular-nums">{n}</td>
                {row.map((cell, i) => (
                  <td
                    key={i}
                    className={`max-w-[28rem] truncate border-b border-line/60 px-3 py-1 ${numeric[i] ? 'text-right tabular-nums' : ''}`}
                    title={cell ?? 'NULL'}
                  >
                    <CellValue value={cell} typeId={result.columns[i].typeId} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {total === 0 && <p className="p-4 text-center text-[13px] text-faint">Запрос не вернул ни одной строки.</p>}
      </div>
      <footer className="flex h-7 shrink-0 items-center border-t border-line px-3 text-[12px] text-dim">
        {total} {plural(total, 'строка', 'строки', 'строк')}
        {total > MAX_ROWS && <span className="ml-1 text-faint">· показаны первые {MAX_ROWS}</span>}
      </footer>
    </div>
  );
}

function CellValue({ value, typeId }: { value: Cell; typeId: number }) {
  if (value === null) return <span className="italic text-faint">NULL</span>;
  if (typeId === BOOLEAN_TYPE_ID) return <span className="text-nav">{value === 't' ? 'true' : 'false'}</span>;
  return <>{value}</>;
}
