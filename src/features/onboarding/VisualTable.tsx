import type { DragEvent } from 'react';

type Cell = string | number | null;

interface VisualTableProps {
  name: string;
  columns: string[];
  rows: Cell[][];
  pick?: 'row' | 'column';
  onPickRow?: (index: number) => void;
  onPickColumn?: (column: string) => void;
  /** Highlighted row or column, coloured by whether the pick was right. */
  marked?: { row?: number; column?: string; tone: 'ok' | 'err' };
  /** Rows accept dropped items (by row index). */
  onDropRow?: (index: number, e: DragEvent) => void;
  /** Keyboard alternative to dropping: rows become buttons. */
  rowAction?: { label: (index: number) => string; onAction: (index: number) => void };
  fresh?: Set<string>;
}

const toneClass = { ok: 'bg-ok/15 text-ok', err: 'bg-err/15 text-err animate-shake' };

export function VisualTable({ name, columns, rows, pick, onPickRow, onPickColumn, marked, onDropRow, rowAction, fresh }: VisualTableProps) {
  const columnTone = (c: string) => (marked?.column === c ? toneClass[marked.tone] : '');
  const rowTone = (i: number) => (marked?.row === i ? toneClass[marked.tone] : '');

  return (
    <figure className="overflow-hidden rounded-md border border-line bg-well">
      <figcaption className="flex items-center gap-2 border-b border-line px-3 py-1.5 font-mono text-[12px]">
        <span className="text-faint">таблица</span>
        <span className="font-semibold text-fg">{name}</span>
      </figcaption>
      <table className="w-full border-collapse font-mono text-[13px]">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className={`border-b border-line p-0 text-left font-semibold ${columnTone(c)}`}>
                {pick === 'column' ? (
                  <button type="button" onClick={() => onPickColumn?.(c)} className="w-full px-3 py-2 text-left hover:bg-nav/10 focus-visible:bg-nav/10">
                    {c}
                  </button>
                ) : (
                  <span className="block px-3 py-2">{c}</span>
                )}
              </th>
            ))}
            {rowAction && <th className="w-px border-b border-line" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              onClick={pick === 'row' ? () => onPickRow?.(i) : undefined}
              onDragOver={onDropRow ? (e) => e.preventDefault() : undefined}
              onDrop={onDropRow ? (e) => onDropRow(i, e) : undefined}
              className={`${pick === 'row' ? 'cursor-pointer hover:bg-nav/10' : ''} ${onDropRow ? 'transition-colors [&.drag-over]:bg-amber/10' : ''} ${rowTone(i)}`}
              onDragEnter={onDropRow ? (e) => e.currentTarget.classList.add('drag-over') : undefined}
              onDragLeave={onDropRow ? (e) => e.currentTarget.classList.remove('drag-over') : undefined}
            >
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`border-b border-line/60 px-3 py-2 ${columnTone(columns[j])} ${fresh?.has(`${i}:${columns[j]}`) ? 'animate-pop text-ok' : ''}`}
                >
                  {pick === 'row' && j === 0 ? (
                    <button
                      type="button"
                      aria-label={`Строка: ${row.map(format).join(', ')}`}
                      onClick={(e) => (e.stopPropagation(), onPickRow?.(i))}
                      className="text-left"
                    >
                      {format(cell)}
                    </button>
                  ) : cell === null ? (
                    <span className="italic text-faint">NULL</span>
                  ) : (
                    format(cell)
                  )}
                </td>
              ))}
              {rowAction && (
                <td className="border-b border-line/60 px-2">
                  <button
                    type="button"
                    aria-label={`${rowAction.label(i)}: ${row.map(format).join(', ')}`}
                    onClick={() => rowAction.onAction(i)}
                    className="whitespace-nowrap rounded border border-amber/60 px-2 py-0.5 text-[11px] text-amber hover:bg-amber/10"
                  >
                    {rowAction.label(i)}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

const format = (cell: Cell) => (cell === null ? 'NULL' : String(cell));
