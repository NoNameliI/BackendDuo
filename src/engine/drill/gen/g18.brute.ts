import type { Brute } from '../types';
import type { P18 } from './g18';

/** Collects the set of every total a walk can have when it reaches each cell (no max/min shortcuts). */
export const brute: Brute<P18> = (p) => {
  const h = p.grid.length;
  const w = p.grid[0].length;
  const sr = p.start === 'tl' || p.start === 'tr' ? 0 : h - 1;
  const sc = p.start === 'tl' || p.start === 'bl' ? 0 : w - 1;
  const dr = sr === 0 ? 1 : -1;
  const dc = sc === 0 ? 1 : -1;
  type Sums = [Set<number>, Set<number>]; // [before the marked cell, after it]
  const table = new Map<number, Sums>();
  const key = (r: number, c: number) => r * 1000 + c;
  const viaKey = p.via ? key(p.via[0], p.via[1]) : -1;

  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      const r = sr + i * dr;
      const c = sc + j * dc;
      const v = p.grid[r][c];
      if (v === null) continue;
      const here: Sums = [new Set(), new Set()];
      table.set(key(r, c), here);
      const into = (set: Set<number>, from: Set<number>) => from.forEach((x) => set.add(x + v));
      if (i === 0 && j === 0) {
        if (p.via) here[0].add(v);
        else here[1].add(v);
        continue;
      }
      for (const prev of [table.get(key(r - dr, c)), table.get(key(r, c - dc))]) {
        if (!prev) continue;
        if (key(r, c) === viaKey) into(here[1], prev[0]);
        else {
          into(here[0], prev[0]);
          into(here[1], prev[1]);
        }
      }
    }
  }
  const last = table.get(key(sr + (h - 1) * dr, sc + (w - 1) * dc));
  if (!last || last[1].size === 0) return [];
  const all = [...last[1]];
  return [`${Math.max(...all)} ${Math.min(...all)}`];
};
