import type { Brute } from '../types';
import type { P02 } from './g02';
import type { Expr } from './shared/logic';

function value(e: Expr, v: number[]): boolean {
  if (e.k === 'leaf') return v[e.i] === 1;
  if (e.k === 'not') return !value(e.a, v);
  const a = value(e.a, v);
  const b = value(e.b, v);
  if (e.k === 'and') return a && b;
  if (e.k === 'or') return a || b;
  if (e.k === 'imp') return !a || b;
  return a === b;
}

function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  const out: number[][] = [];
  for (const rest of permutations(n - 1)) {
    for (let at = 0; at <= rest.length; at++) out.push([...rest.slice(0, at), n - 1, ...rest.slice(at)]);
  }
  return out;
}

/** Every order of the variables over the columns that reproduces the listed rows. */
export const brute: Brute<P02> = (p) => {
  const n = p.names.length;
  const found = new Set<string>();
  for (const colVar of permutations(n)) {
    let ok = true;
    for (let r = 0; r < p.rows.length && ok; r++) {
      const v = new Array<number>(n).fill(0);
      colVar.forEach((variable, col) => (v[variable] = p.rows[r][col]));
      if (Number(value(p.expr, v)) !== p.f[r]) ok = false;
    }
    if (ok && p.complete) {
      // all rows with this value of F must be listed
      const shown = new Set(p.rows.map((row) => row.join('')));
      let count = 0;
      for (let m = 0; m < 1 << n; m++) {
        const v = Array.from({ length: n }, (_, i) => (m >> i) & 1);
        if (Number(value(p.expr, v)) === p.f[0]) {
          count++;
          if (!shown.has(colVar.map((variable) => v[variable]).join(''))) ok = false;
        }
      }
      if (count !== shown.size) ok = false;
    }
    if (ok) found.add(colVar.map((variable) => p.names[variable]).join(''));
  }
  return [...found].sort();
};
