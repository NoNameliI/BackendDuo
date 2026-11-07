/**
 * g18: a grid of integers in a sheet; a walker moves from one corner to the opposite one, one step at a time toward
 * it (right/down, right/up, left/down or left/up by start corner), adding the values of the visited cells.
 * Answer: pair "max min" (largest and smallest total). Shapes: `corner`, `through`, `walls`.
 *
 * corner:  plain walk, start corner varies (tl, tr, bl, br).
 * through: the walk must pass through a marked inner cell (spreadsheet address in the fields).
 * walls:   some cells are empty and cannot be entered (no walk, no answer: Reject).
 *   base: 12x12, values 1..9, no through-cell near corners; walls 4% of cells.
 *   core: 20x20, values 1..20; walls 8%.
 *   hard: 22x22, values -5..30; walls 12%; through-cell in the middle band.
 * solve: orient to the top-left start and run forward/backward DP (shared/gridDp.ts), O(cells).
 * Reject: no walk, max == min.
 * steps: max, min, number of blocked cells.
 * Table: t1, one column per grid column, empty string = wall.
 */
import { Reject, type DataFile, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';
import { orient, walkExtremes, type Corner, type Grid } from './shared/gridDp';
import { columnLetters, makeTable, tableFile } from './shared/table';

export type P18 = {
  shape: 'corner' | 'through' | 'walls';
  level: Level;
  start: Corner;
  grid: Grid;
  via?: [number, number]; // [row, col], 0-based, in the sheet as given
};

const SIZE = {
  base: { n: 12, lo: 1, hi: 9, walls: 0.04 },
  core: { n: 20, lo: 1, hi: 20, walls: 0.08 },
  hard: { n: 22, lo: -5, hi: 30, walls: 0.12 },
} as const;

function build(rng: Rng, level: Level, shape: P18['shape']): P18 {
  const s = SIZE[level];
  const h = s.n;
  const w = s.n + (level === 'base' ? 0 : rng.int(0, 4));
  const start = rng.pick(['tl', 'tr', 'bl', 'br'] as const);
  const grid: Grid = Array.from({ length: h }, () => Array.from({ length: w }, () => rng.int(s.lo, s.hi)));
  let via: [number, number] | undefined;
  if (shape === 'through') {
    const band = level === 'hard' ? 0.3 : 0.15;
    via = [rng.int(Math.floor(h * band), Math.ceil(h * (1 - band)) - 1), rng.int(Math.floor(w * band), Math.ceil(w * (1 - band)) - 1)];
  }
  if (shape === 'walls') {
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (rng.chance(s.walls)) grid[r][c] = null;
    const corners: [number, number][] = [[0, 0], [0, w - 1], [h - 1, 0], [h - 1, w - 1]];
    for (const [r, c] of corners) if (grid[r][c] === null) grid[r][c] = rng.int(s.lo, s.hi);
  }
  return { shape, level, start, grid, via };
}

function solve(p: P18): Solved {
  const o = orient(p.grid, p.start, p.via);
  const ex = walkExtremes(o.grid, o.via);
  if (!ex) throw new Reject('no walk');
  if (ex.max === ex.min) throw new Reject('single total');
  return { answer: `${ex.max} ${ex.min}`, steps: { max: ex.max, min: ex.min, wallCount: p.grid.flat().filter((v) => v === null).length } };
}

function fields(p: P18): Fields {
  const h = p.grid.length;
  const w = p.grid[0].length;
  return {
    rows: h,
    cols: w,
    lastCell: `${columnLetters(w - 1)}${h}`,
    startTL: p.start === 'tl',
    startTR: p.start === 'tr',
    startBL: p.start === 'bl',
    startBR: p.start === 'br',
    startCell: `${columnLetters(p.start === 'tr' || p.start === 'br' ? w - 1 : 0)}${p.start === 'bl' || p.start === 'br' ? h : 1}`,
    endCell: `${columnLetters(p.start === 'tr' || p.start === 'br' ? 0 : w - 1)}${p.start === 'bl' || p.start === 'br' ? 1 : h}`,
    horizontal: p.start === 'tl' || p.start === 'bl' ? 'right' : 'left',
    vertical: p.start === 'tl' || p.start === 'tr' ? 'down' : 'up',
    hasVia: p.via !== undefined,
    viaCell: p.via ? `${columnLetters(p.via[1])}${p.via[0] + 1}` : '',
    hasWalls: p.shape === 'walls',
  };
}

export const g18: Generator<P18> = {
  id: 'g18',
  answer: { kind: 'pair' },
  shapes: ['corner', 'through', 'walls'],
  generate: (rng, level, shape) => {
    if (shape !== 'corner' && shape !== 'through' && shape !== 'walls') throw new Error(`g18: unknown shape "${shape}"`);
    return build(rng, level, shape);
  },
  solve,
  fields,
  files: (p): DataFile[] => [tableFile(makeTable('t1', p.grid[0].length, p.grid.map((row) => row.map((v) => (v === null ? '' : v))), false))],
};
