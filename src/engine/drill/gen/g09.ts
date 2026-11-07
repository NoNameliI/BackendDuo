/**
 * g09: rows of integers in one sheet; count the rows that satisfy a condition. Answer: int.
 * Shapes: `pattern`, `compare`, `mean`.
 *
 * pattern: repetition structure of the row (one value twice / two values twice, all other values once). core adds
 *   "sum of the once-values > factor * sum of the repeated values (each counted once)"; hard adds where the row
 *   maximum must lie (any | among once-values | among repeated values).
 * compare: sum of the cells in column set A > sum of the cells in column set B (disjoint). core adds "row maximum
 *   >= maxT"; hard adds "at least cnt cells divisible by div".
 * mean: exactly q cells strictly above the row average. core adds "row minimum < minT"; hard adds "max - min > spread".
 *   base: 5 cells per row, 1000 rows, values 1..30.   core: 6 cells, 2500 rows, values 1..60.
 *   hard: 7 cells, 5000 rows, values 1..100 (pattern: width 6).
 * solve: one pass with a small per-row tally. steps: counts and three sample rows with the verdict.
 * Reject: fewer than 5 matching rows.
 * Table: t1 with one column per cell (c1..cW), no id column; spreadsheet letters A, B, ... name the columns.
 */
import { Reject, type DataFile, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';
import { columnLetters, makeTable, tableFile } from './shared/table';

type Pattern = { struct: 'pair' | 'twoPairs'; factor: number; maxAt: 'any' | 'once' | 'repeated' };
type Compare = { colsA: number[]; colsB: number[]; maxT: number; div: number; cnt: number };
type Mean = { q: number; minT: number; spread: number };
export type P09 =
  | { shape: 'pattern'; level: Level; rows: number[][]; cfg: Pattern }
  | { shape: 'compare'; level: Level; rows: number[][]; cfg: Compare }
  | { shape: 'mean'; level: Level; rows: number[][]; cfg: Mean };

const SIZE = {
  base: { width: 5, rows: 1000, vmax: 30 },
  core: { width: 6, rows: 2500, vmax: 60 },
  hard: { width: 7, rows: 5000, vmax: 100 },
} as const;
const MIN_COUNT = 5;

function patternOk(row: number[], c: Pattern): boolean {
  const tally = new Map<number, number>();
  for (const v of row) tally.set(v, (tally.get(v) ?? 0) + 1);
  let twice = 0;
  let sumOnce = 0;
  let sumRep = 0;
  for (const [v, k] of tally) {
    if (k === 1) sumOnce += v;
    else if (k === 2) {
      twice++;
      sumRep += v;
    } else return false;
  }
  if (twice !== (c.struct === 'pair' ? 1 : 2)) return false;
  if (c.factor > 0 && !(sumOnce > c.factor * sumRep)) return false;
  if (c.maxAt !== 'any') {
    const mx = Math.max(...row);
    const isOnce = tally.get(mx) === 1;
    if (isOnce !== (c.maxAt === 'once')) return false;
  }
  return true;
}

function compareOk(row: number[], c: Compare): boolean {
  let a = 0;
  let b = 0;
  for (const i of c.colsA) a += row[i];
  for (const i of c.colsB) b += row[i];
  if (!(a > b)) return false;
  if (c.maxT > 0 && Math.max(...row) < c.maxT) return false;
  if (c.div > 0) {
    let n = 0;
    for (const v of row) if (v % c.div === 0) n++;
    if (n < c.cnt) return false;
  }
  return true;
}

function meanOk(row: number[], c: Mean): boolean {
  let sum = 0;
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of row) {
    sum += v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  let above = 0;
  for (const v of row) if (v * row.length > sum) above++;
  if (above !== c.q) return false;
  if (c.minT > 0 && !(mn < c.minT)) return false;
  if (c.spread > 0 && !(mx - mn > c.spread)) return false;
  return true;
}

const test = (p: P09, row: number[]): boolean =>
  p.shape === 'pattern' ? patternOk(row, p.cfg) : p.shape === 'compare' ? compareOk(row, p.cfg) : meanOk(row, p.cfg);

function build(rng: Rng, level: Level, shape: P09['shape']): P09 {
  const s = SIZE[level];
  const width = shape === 'pattern' && level === 'hard' ? 6 : s.width;
  const rows = Array.from({ length: s.rows }, () => Array.from({ length: width }, () => rng.int(1, s.vmax)));
  if (shape === 'pattern') {
    const cfg: Pattern = {
      struct: level === 'base' || rng.chance(0.6) ? 'pair' : 'twoPairs',
      factor: level === 'base' ? 0 : rng.int(1, 3),
      maxAt: level === 'hard' ? rng.pick(['once', 'repeated'] as const) : 'any',
    };
    return { shape, level, rows, cfg };
  }
  if (shape === 'compare') {
    const order = rng.shuffle(Array.from({ length: width }, (_, i) => i));
    const a = rng.int(1, width - 2);
    const b = rng.int(1, width - a);
    const cfg: Compare = {
      colsA: order.slice(0, a).sort((x, y) => x - y),
      colsB: order.slice(a, a + b).sort((x, y) => x - y),
      maxT: level === 'base' ? 0 : Math.floor(s.vmax * (0.8 + rng.next() * 0.15)),
      div: level === 'hard' ? rng.int(3, 7) : 0,
      cnt: level === 'hard' ? rng.int(1, 2) : 0,
    };
    return { shape, level, rows, cfg };
  }
  const cfg: Mean = {
    q: rng.int(1, width - 2),
    minT: level === 'base' ? 0 : Math.floor(s.vmax * (0.1 + rng.next() * 0.15)),
    spread: level === 'hard' ? Math.floor(s.vmax * (0.55 + rng.next() * 0.2)) : 0,
  };
  return { shape, level, rows, cfg };
}

function solve(p: P09): Solved {
  let count = 0;
  const samples: { cells: number[]; ok: boolean }[] = [];
  let yes = 0;
  let no = 0;
  for (const row of p.rows) {
    const ok = test(p, row);
    if (ok) count++;
    if (ok && yes < 2) {
      samples.push({ cells: row, ok });
      yes++;
    } else if (!ok && no < 1) {
      samples.push({ cells: row, ok });
      no++;
    }
  }
  if (count < MIN_COUNT) throw new Reject('too few rows');
  return { answer: String(count), steps: { count, total: p.rows.length, samples } };
}

function fields(p: P09): Fields {
  const width = p.rows[0].length;
  const base: Fields = { rowCount: p.rows.length, width, lastLetter: columnLetters(width - 1) };
  if (p.shape === 'pattern') {
    const c = p.cfg;
    return {
      ...base,
      onePair: c.struct === 'pair',
      twoPairs: c.struct === 'twoPairs',
      hasFactor: c.factor > 0,
      factor: c.factor,
      factorOne: c.factor === 1,
      maxOnce: c.maxAt === 'once',
      maxRepeated: c.maxAt === 'repeated',
    };
  }
  if (p.shape === 'compare') {
    const c = p.cfg;
    return {
      ...base,
      colsA: c.colsA.map(columnLetters),
      colsB: c.colsB.map(columnLetters),
      oneColA: c.colsA.length === 1,
      oneColB: c.colsB.length === 1,
      oneColumn: c.colsA.length === 1 && c.colsB.length === 1,
      colA: columnLetters(c.colsA[0]),
      colB: columnLetters(c.colsB[0]),
      hasMax: c.maxT > 0,
      maxT: c.maxT,
      hasDiv: c.div > 0,
      div: c.div,
      cnt: c.cnt,
    };
  }
  const c = p.cfg;
  return { ...base, q: c.q, hasMin: c.minT > 0, minT: c.minT, hasSpread: c.spread > 0, spread: c.spread };
}

export const g09: Generator<P09> = {
  id: 'g09',
  answer: { kind: 'int' },
  shapes: ['pattern', 'compare', 'mean'],
  generate: (rng, level, shape) => {
    if (shape !== 'pattern' && shape !== 'compare' && shape !== 'mean') throw new Error(`g09: unknown shape "${shape}"`);
    return build(rng, level, shape);
  },
  solve,
  fields,
  files: (p): DataFile[] => [tableFile(makeTable('t1', p.rows[0].length, p.rows, false))],
};
