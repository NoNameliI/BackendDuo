import { seedHex } from './rng';
import type { Cell, DataTable } from './types';

const BOM = String.fromCodePoint(0xfeff);

export const DATA_LIMITS = { rows: 20_000, textBytes: 1_000_000 } as const;

function cell(value: Cell): string {
  const text = typeof value === 'number' ? (Number.isInteger(value) ? String(value) : String(value).replace('.', ',')) : value;
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** `;`-separated, UTF-8 with BOM, CRLF, decimal comma. Header captions (none when `header` is false): `captions["t1.c2"]`, else the column key. */
export function toCsv(table: DataTable, captions: Readonly<Record<string, string>> = {}): string {
  const header = table.columns.map((c) => cell(captions[`${table.key}.${c}`] ?? c));
  const lines = [...(table.header === false ? [] : [header]), ...table.rows.map((row) => row.map(cell))].map((row) => row.join(';'));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** Caption row text of a table as the viewer shows it (a grid shows spreadsheet letters instead, so it has no caption row). */
export function headerOf(table: DataTable, captions: Readonly<Record<string, string>> = {}): string[] | null {
  return table.header === false ? null : table.columns.map((c) => captions[`${table.key}.${c}`] ?? c);
}

const tsvCell = (value: Cell): string => {
  const text = typeof value === 'number' && !Number.isInteger(value) ? String(value).replace('.', ',') : String(value);
  return /[\t"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Tab-separated rows for the clipboard (Excel splits them into cells); decimal comma as in the viewer. */
export function toTsv(table: DataTable, captions: Readonly<Record<string, string>> = {}): string {
  const header = headerOf(table, captions);
  return [...(header ? [header.map(tsvCell)] : []), ...table.rows.map((row) => row.map(tsvCell))].map((row) => row.join('\t')).join('\r\n');
}

/** UTF-8 without BOM, LF. */
export function toText(text: string): string {
  return text.replace(new RegExp(`^${BOM}`), '').replace(/\r\n?/g, '\n');
}

/** `<n>_<seedHex>[_<tableKey>].<ext>`; the workbook has no key (`<n>_<seedHex>.xlsx`). */
export function fileName(n: number, seed: number, ext: 'csv' | 'txt' | 'xlsx', tableKey?: string): string {
  return `${n}_${seedHex(seed)}${tableKey ? `_${tableKey}` : ''}.${ext}`;
}
