import type { Brute } from '../types';
import type { P15 } from './g15';
import type { Expr } from './shared/logic';

function truth(e: Expr, atom: (i: number) => boolean): boolean {
  if (e.k === 'leaf') return atom(e.i);
  if (e.k === 'not') return !truth(e.a, atom);
  const a = truth(e.a, atom);
  const b = truth(e.b, atom);
  if (e.k === 'and') return a && b;
  if (e.k === 'or') return a || b;
  if (e.k === 'imp') return !a || b;
  return a === b;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export const brute: Brute<P15> = (p) => {
  if (p.shape === 'divisor') {
    const period = p.consts.reduce((l, c) => (l / gcd(l, c)) * c, 1);
    const cap = period + 24;
    const good: number[] = [];
    for (let A = 1; A <= cap; A++) {
      const upto = (period / gcd(period, A)) * A; // the pattern of divisibility repeats with this period
      let ok = true;
      for (let x = 1; x <= upto && ok; x++) {
        ok = truth(p.expr, (i) => (i === 0 ? x % A === 0 : x % p.consts[i - 1] === 0));
      }
      if (ok) good.push(A);
    }
    if (good.length === 0) return [];
    return [String(p.ask === 'min' ? Math.min(...good) : Math.max(...good))];
  }

  if (p.shape === 'segment') {
    const top = Math.max(...p.segs.map(([, b]) => b)) + 3;
    const lengths: number[] = [];
    for (let l = 1; l <= top; l++) {
      for (let r = l; r <= top; r++) {
        let ok = true;
        for (let x = 1; x <= top + 1 && ok; x++) {
          ok = truth(p.expr, (i) => (i === 0 ? l <= x && x <= r : p.segs[i - 1][0] <= x && x <= p.segs[i - 1][1]));
        }
        if (ok) lengths.push(r - l);
      }
    }
    if (lengths.length === 0) return [];
    return [String(p.ask === 'min' ? Math.min(...lengths) : Math.max(...lengths))];
  }

  for (let A = 1; A < 128; A++) {
    let ok = true;
    for (let x = 1; x < 512 && ok; x++) {
      ok = truth(p.expr, (i) => (i === 0 ? (x & A) !== 0 : (x & p.consts[i - 1]) !== 0));
    }
    if (ok) return [String(A)];
  }
  return [];
};
