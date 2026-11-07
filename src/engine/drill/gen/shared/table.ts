/** Builders for data files and vocabulary draws. Pure; no task text. */
import type { Cell, DataFile, DataTable, Rng, Vocab } from '../../types';

/** Table with columns c1..cW (captions come from task labels). */
export function makeTable(key: string, width: number, rows: Cell[][], header = true): DataTable {
  const table: DataTable = { key, columns: Array.from({ length: width }, (_, i) => `c${i + 1}`), rows };
  return header ? table : { ...table, header: false };
}

export const tableFile = (...tables: DataTable[]): DataFile => ({ kind: 'table', tables });

/** The vocab list `key`, which must hold at least `n` entries. */
export function wordList(vocab: Vocab, key: string, n: number): readonly string[] {
  const list = vocab[key];
  if (!list || list.length < n) throw new Error(`vocab "${key}" needs ${n} entries`);
  return list;
}

/** n distinct entries of a vocab list in random order. */
export function drawWords(rng: Rng, vocab: Vocab, key: string, n: number): string[] {
  return rng.shuffle(wordList(vocab, key, n)).slice(0, n);
}

/** n distinct integers from [lo, hi], sorted ascending. */
export function distinctInts(rng: Rng, lo: number, hi: number, n: number): number[] {
  if (hi - lo + 1 < n) throw new RangeError('range too small');
  const seen = new Set<number>();
  while (seen.size < n) seen.add(rng.int(lo, hi));
  return [...seen].sort((a, b) => a - b);
}

const MONTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** `YYYY-MM-DD` for the day `offset` (0-based) of `year`; offsets may run into later years. */
export function isoDay(year: number, offset: number): string {
  let y = year;
  let left = offset;
  for (;;) {
    const len = leap(y) ? 366 : 365;
    if (left < len) break;
    left -= len;
    y++;
  }
  let m = 0;
  for (;;) {
    const len = MONTHS[m] + (m === 1 && leap(y) ? 1 : 0);
    if (left < len) break;
    left -= len;
    m++;
  }
  const two = (v: number) => String(v).padStart(2, '0');
  return `${y}-${two(m + 1)}-${two(left + 1)}`;
}

/** Spreadsheet column letters: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnLetters(index: number): string {
  let out = '';
  let n = index;
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}
