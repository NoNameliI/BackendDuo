import type { Brute } from '../types';
import type { P09 } from './g09';

/** Direct reading of the conditions, row by row, with explicit pair comparisons. */
export const brute: Brute<P09> = (p) => {
  let count = 0;
  for (const row of p.rows) {
    const n = row.length;
    if (p.shape === 'pattern') {
      const c = p.cfg;
      // multiplicity of every cell
      const mult = row.map((v) => row.filter((w) => w === v).length);
      if (mult.some((m) => m > 2)) continue;
      const pairs = mult.filter((m) => m === 2).length / 2;
      if (pairs !== (c.struct === 'pair' ? 1 : 2)) continue;
      let once = 0;
      const seen: number[] = [];
      let rep = 0;
      for (let i = 0; i < n; i++) {
        if (mult[i] === 1) once += row[i];
        else if (!seen.includes(row[i])) {
          seen.push(row[i]);
          rep += row[i];
        }
      }
      if (c.factor > 0 && once <= c.factor * rep) continue;
      const top = row.reduce((a, b) => (b > a ? b : a), row[0]);
      const topMult = row.filter((w) => w === top).length;
      if (c.maxAt === 'once' && topMult !== 1) continue;
      if (c.maxAt === 'repeated' && topMult !== 2) continue;
      count++;
    } else if (p.shape === 'compare') {
      const c = p.cfg;
      const a = c.colsA.reduce((s, i) => s + row[i], 0);
      const b = c.colsB.reduce((s, i) => s + row[i], 0);
      if (a <= b) continue;
      if (c.maxT > 0 && row.every((v) => v < c.maxT)) continue;
      if (c.div > 0 && row.filter((v) => v % c.div === 0).length < c.cnt) continue;
      count++;
    } else {
      const c = p.cfg;
      const avg = row.reduce((s, v) => s + v, 0) / n;
      if (row.filter((v) => v > avg).length !== c.q) continue;
      if (c.minT > 0 && !row.some((v) => v < c.minT)) continue;
      if (c.spread > 0 && Math.max(...row) - Math.min(...row) <= c.spread) continue;
      count++;
    }
  }
  return [String(count)];
};
