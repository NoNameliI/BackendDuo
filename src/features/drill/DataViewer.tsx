import { useMemo, useRef, useState } from 'react';
import type { Cell, DataTable } from '@/engine/drill/types';
import { saveTextFile } from '@/platform';
import { Button } from '@/ui/Button';
import type { ExportFile } from './instanceView';

const ROW = 28;
const VIEW = 320;
const OVERSCAN = 6;

const show = (v: Cell): string => (typeof v === 'number' && !Number.isInteger(v) ? String(v).replace('.', ',') : String(v));

/** Spreadsheet column letters: 0 -> A, 25 -> Z, 26 -> AA. */
function letters(index: number): string {
  let out = '';
  let n = index;
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function compare(a: Cell, b: Cell): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** Data files of a statement: tables (windowed, sortable, searchable) or text (line numbers, search). */
export function DataViewer({ files, captions }: { files: ExportFile[]; captions: Readonly<Record<string, string>> }) {
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const file = files[Math.min(index, files.length - 1)];
  if (!file) return null;

  const save = async () => {
    try {
      const saved = await saveTextFile(file.name, file.text);
      setNote(saved.path ? `Сохранено: ${saved.path}` : `Файл ${file.name} скачан`);
      setPath(saved.path);
    } catch (e) {
      setNote(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`);
      setPath(null);
    }
  };
  const copy = (text: string, done: string) => {
    void navigator.clipboard?.writeText(text).then(() => setNote(done));
  };

  return (
    <section aria-label="Данные" className="overflow-hidden rounded-md border border-line bg-panel">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">Данные</p>
        {files.length > 1 && (
          <div role="group" aria-label="Файл" className="flex gap-1">
            {files.map((f, i) => (
              <button
                key={f.name}
                type="button"
                aria-pressed={i === index}
                onClick={() => {
                  setIndex(i);
                  setNote(null);
                  setPath(null);
                }}
                className={`rounded border px-2 py-0.5 font-mono text-[11.5px] ${i === index ? 'border-nav text-fg' : 'border-line text-dim hover:text-fg'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        <span className="font-mono text-[11.5px] text-faint">{file.name}</span>
        <div className="ml-auto flex gap-1.5">
          <Button variant="outline" onClick={() => void save()}>
            Сохранить как {file.ext.toUpperCase()}
          </Button>
          <Button variant="outline" onClick={() => copy(file.text.replace(/^﻿/, ''), 'Скопировано в буфер обмена')}>
            Копировать
          </Button>
        </div>
      </header>
      {file.table ? <TableView key={file.name} table={file.table} captions={captions} /> : <TextView key={file.name} text={file.text} />}
      <div role="status" className="flex min-h-[1.75rem] items-center gap-2 border-t border-line px-3 text-[12px] text-dim">
        {note}
        {path && (
          <Button variant="ghost" className="!h-6" onClick={() => copy(path, 'Путь скопирован')}>
            Копировать путь
          </Button>
        )}
      </div>
    </section>
  );
}

function Search({ value, onChange, label, note }: { value: string; onChange: (v: string) => void; label: string; note?: string }) {
  return (
    <div className="flex flex-1 items-center gap-2 border-b border-line px-3 py-1.5">
      <input
        type="search"
        aria-label={label}
        placeholder="Поиск"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-56 rounded border border-line-strong bg-well px-2 text-[13px] outline-none focus:border-nav"
      />
      <span role="status" className="font-mono text-[11.5px] text-faint">
        {note}
      </span>
    </div>
  );
}

function TableView({ table, captions }: { table: DataTable; captions: Readonly<Record<string, string>> }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [query, setQuery] = useState('');
  const [top, setTop] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const grid = table.header === false;
  // Original row indexes, so grid row numbers survive search and sorting.
  const order = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = table.rows.map((_, i) => i);
    if (q) list = list.filter((i) => table.rows[i].some((c) => show(c).toLowerCase().includes(q)));
    if (sort) list = [...list].sort((a, b) => sort.dir * compare(table.rows[a][sort.col], table.rows[b][sort.col]));
    return list;
  }, [table, query, sort]);
  const rows = useMemo(() => order.map((i) => table.rows[i]), [order, table]);

  const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((top + VIEW) / ROW) + OVERSCAN);
  const toTop = () => {
    if (box.current) box.current.scrollTop = 0;
  };

  const toggle = (col: number) => {
    setSort((s) => (s?.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }));
    toTop();
  };

  return (
    <>
      <div className="flex">
        <Search
          value={query}
          onChange={(v) => {
            setQuery(v);
            toTop();
          }}
          label="Поиск по таблице"
          note={`${rows.length.toLocaleString('ru-RU')} из ${table.rows.length.toLocaleString('ru-RU')} строк`}
        />
      </div>
      <div ref={box} className="overflow-auto" style={{ maxHeight: VIEW }} onScroll={(e) => setTop(e.currentTarget.scrollTop)} tabIndex={0} role="region" aria-label="Таблица данных">
        <table className="w-full border-collapse font-mono text-[12.5px]" aria-rowcount={rows.length + 1}>
          <thead className="sticky top-0 z-10 bg-raised">
            <tr style={{ height: ROW }}>
              {grid && <th scope="col" aria-label="Номер строки" className="w-10 px-2 text-right font-normal text-faint" />}
              {table.columns.map((c, i) => (
                <th key={c} scope="col" aria-sort={sort?.col === i ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className="px-3 text-left font-semibold">
                  <button type="button" onClick={() => toggle(i)} className="inline-flex items-center gap-1 hover:text-nav" title="Сортировать">
                    {grid ? letters(i) : (captions[`${table.key}.${c}`] ?? c)}
                    <span aria-hidden="true" className="text-faint">
                      {sort?.col === i ? (sort.dir === 1 ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {first > 0 && <tr aria-hidden="true" style={{ height: first * ROW }} />}
            {rows.slice(first, last).map((row, k) => (
              <tr key={first + k} aria-rowindex={first + k + 2} style={{ height: ROW }} className="border-t border-line/60">
                {grid && (
                  <th scope="row" className="w-10 select-none px-2 text-right font-normal text-faint">
                    {order[first + k] + 1}
                  </th>
                )}
                {row.map((cell, j) => (
                  <td key={j} className={`px-3 ${typeof cell === 'number' ? 'text-right tabular-nums' : ''}`}>
                    {show(cell)}
                  </td>
                ))}
              </tr>
            ))}
            {last < rows.length && <tr aria-hidden="true" style={{ height: (rows.length - last) * ROW }} />}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-3 py-4 text-[13px] text-faint">Ничего не найдено</p>}
      </div>
    </>
  );
}

function TextView({ text }: { text: string }) {
  const lines = useMemo(() => text.split('\n'), [text]);
  const [query, setQuery] = useState('');
  const [top, setTop] = useState(0);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const q = query.toLowerCase();
  const hits = useMemo(() => (q ? lines.flatMap((l, i) => (l.toLowerCase().includes(q) ? [i] : [])) : []), [lines, q]);
  const matches = useMemo(() => (q ? lines.reduce((sum, l) => sum + l.toLowerCase().split(q).length - 1, 0) : 0), [lines, q]);
  const hitSet = useMemo(() => new Set(hits), [hits]);

  const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((top + VIEW) / ROW) + OVERSCAN);
  const go = (k: number) => {
    if (hits.length === 0) return;
    const next = (k + hits.length) % hits.length;
    setAt(next);
    if (box.current) box.current.scrollTop = Math.max(0, hits[next] * ROW - VIEW / 2);
  };

  return (
    <>
      <div className="flex items-center">
        <Search
          value={query}
          onChange={(v) => {
            setQuery(v);
            setAt(0);
          }}
          label="Поиск по тексту"
          note={q ? `совпадений: ${matches}` : `${lines.length.toLocaleString('ru-RU')} строк`}
        />
        {hits.length > 0 && (
          <div className="flex gap-1 border-b border-line py-1.5 pr-3">
            <Button variant="ghost" className="!h-7" onClick={() => go(at - 1)} aria-label="Предыдущее совпадение">
              ↑
            </Button>
            <Button variant="ghost" className="!h-7" onClick={() => go(at + 1)} aria-label="Следующее совпадение">
              ↓
            </Button>
          </div>
        )}
      </div>
      <div ref={box} className="overflow-auto" style={{ maxHeight: VIEW }} onScroll={(e) => setTop(e.currentTarget.scrollTop)} tabIndex={0} role="region" aria-label="Текст данных">
        <div style={{ height: lines.length * ROW, position: 'relative' }} className="font-mono text-[12.5px]">
          {lines.slice(first, last).map((line, k) => {
            const i = first + k;
            return (
              <div key={i} style={{ position: 'absolute', top: i * ROW, height: ROW }} className={`flex w-full items-center whitespace-pre ${hitSet.has(i) ? 'bg-amber/15' : ''}`}>
                <span aria-hidden="true" className="w-12 shrink-0 select-none pr-3 text-right text-faint">
                  {i + 1}
                </span>
                <span>{line}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
