import type { Brute } from '../types';
import type { P17 } from './g17';

/** Every window / every pair of positions is examined directly. */
export const brute: Brute<P17> = (p) => {
  const a = p.a;
  let count = 0;
  let best = -Infinity;
  if (p.shape === 'gap') {
    for (let i = 0; i < a.length; i++) {
      for (let j = i + p.g; j < a.length; j++) {
        if (a[i] < p.floor || a[j] < p.floor) continue;
        if ((a[i] + a[j]) % p.m !== p.r) continue;
        count++;
        best = Math.max(best, a[i] + a[j]);
      }
    }
  } else {
    const size = p.shape === 'adjacent' ? 2 : 3;
    for (let i = 0; i + size <= a.length; i++) {
      const w = a.slice(i, i + size);
      if (w.filter((v) => v % p.p === 0).length !== p.need) continue;
      const sum = w.reduce((s, v) => s + v, 0);
      const ok = p.extras.every((e) => {
        if (e.kind === 'sumMod') return sum % e.m === e.r;
        if (e.kind === 'sumMax') return sum <= e.t;
        return Math.max(...w) - Math.min(...w) >= e.t;
      });
      if (!ok) continue;
      count++;
      best = Math.max(best, sum);
    }
  }
  return count > 0 ? [`${count} ${best}`] : [];
};
