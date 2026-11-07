import type { Brute } from '../types';
import type { P13 } from './g13';

/** Forward table over all values 0..target with a "required number seen" flag; no recursion. */
export const brute: Brute<P13> = (p) => {
  const T = p.target;
  const apply = (k: string, v: number, x: number): number => (k === 'add' ? x + v : k === 'mul' ? x * v : x * x);
  const seen0 = p.through === null || p.start === p.through ? 1 : 0;
  const cnt: bigint[][] = Array.from({ length: T + 1 }, () => [0n, 0n]);
  const lo: number[][] = Array.from({ length: T + 1 }, () => [Infinity, Infinity]);
  const hi: number[][] = Array.from({ length: T + 1 }, () => [-Infinity, -Infinity]);
  cnt[p.start][seen0] = 1n;
  lo[p.start][seen0] = 0;
  hi[p.start][seen0] = 0;
  for (let v = p.start; v < T; v++) {
    if (v === p.avoid) continue;
    for (let f = 0; f < 2; f++) {
      if (cnt[v][f] === 0n) continue;
      for (const o of p.ops) {
        const nx = apply(o.k, o.v, v);
        if (nx > T || nx === p.avoid) continue;
        const nf = p.through === null || f === 1 || nx === p.through ? 1 : 0;
        cnt[nx][nf] += cnt[v][f];
        lo[nx][nf] = Math.min(lo[nx][nf], lo[v][f] + 1);
        hi[nx][nf] = Math.max(hi[nx][nf], hi[v][f] + 1);
      }
    }
  }
  if (cnt[T][1] === 0n) return [];
  if (p.ask === 'count') return [cnt[T][1].toString()];
  return [String(p.ask === 'shortest' ? lo[T][1] : hi[T][1])];
};
