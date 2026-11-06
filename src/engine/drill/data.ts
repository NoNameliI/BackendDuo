import { seedHex } from './rng';
import type { Cell, DataTable } from './types';

const BOM = String.fromCodePoint(0xfeff);

export const DATA_LIMITS = { rows: 20_000, textBytes: 1_000_000 } as const;

function cell(value: Cell): string {
  const text = typeof value === 'number' ? (Number.isInteger(value) ? String(value) : String(value).replace('.', ',')) : value;
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** `;`-separated, UTF-8 with BOM, CRLF, decimal comma. Header captions: `captions["t1.c2"]`, else the column key. */
export function toCsv(table: DataTable, captions: Readonly<Record<string, string>> = {}): string {
  const header = table.columns.map((c) => cell(captions[`${table.key}.${c}`] ?? c));
  const lines = [header, ...table.rows.map((row) => row.map(cell))].map((row) => row.join(';'));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** UTF-8 without BOM, LF. */
export function toText(text: string): string {
  return text.replace(new RegExp(`^${BOM}`), '').replace(/\r\n?/g, '\n');
}

/** `<n>_<seedHex>[_<tableKey>].<ext>` */
export function fileName(n: number, seed: number, ext: 'csv' | 'txt', tableKey?: string): string {
  return `${n}_${seedHex(seed)}${tableKey ? `_${tableKey}` : ''}.${ext}`;
}
