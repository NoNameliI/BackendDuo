import type { Brute } from '../types';
import type { P04 } from './g04';

const MAX_LEN = 12;

/** Exhaustive search over code trees: best cost of placing k words under every tree node. */
export const brute: Brute<P04> = (p) => {
  const fixed = p.known.map((k) => k.code);
  const isWord = (s: string) => fixed.includes(s);
  const isOnWay = (s: string) => fixed.some((w) => w.length > s.length && w.startsWith(s));
  const sumMode = p.shape === 'total';
  const join = (a: number, b: number) => (sumMode ? a + b : Math.max(a, b));
  const memo = new Map<string, number>();

  const best = (s: string, k: number): number => {
    if (k === 0) return 0;
    if (s.length > MAX_LEN || isWord(s)) return Infinity;
    const onWay = isOnWay(s);
    const key = `${s.length}:${k}`;
    if (!onWay && memo.has(key)) return memo.get(key)!;
    let res = k === 1 && !onWay ? s.length : Infinity;
    for (let k0 = 0; k0 <= k; k0++) {
      const a = best(s + '0', k0);
      if (a === Infinity) continue;
      const b = best(s + '1', k - k0);
      if (b === Infinity) continue;
      res = Math.min(res, join(a, b));
    }
    if (!onWay) memo.set(key, res);
    return res;
  };

  const r = best('', p.rest.length);
  return r === Infinity ? [] : [String(r)];
};
