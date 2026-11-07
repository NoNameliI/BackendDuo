import type { Brute } from '../types';
import type { P20 } from './g20';

type Pos = number[];

/** Plain game-tree simulation: can the mover force a win within k own moves? */
function wins(p: P20, st: Pos, k: number): boolean {
  const L = p.game.limit;
  for (let i = 0; i < st.length; i++) {
    for (const op of p.game.ops) {
      const nx = st.slice();
      nx[i] = op.kind === 'add' ? st[i] + op.k : st[i] * op.k;
      if (nx.reduce((a, b) => a + b, 0) >= L) return true;
      if (k <= 1) continue;
      let all = true;
      for (let j = 0; j < nx.length && all; j++) {
        for (const op2 of p.game.ops) {
          const ny = nx.slice();
          ny[j] = op2.kind === 'add' ? nx[j] + op2.k : nx[j] * op2.k;
          if (ny.reduce((a, b) => a + b, 0) >= L || !wins(p, ny, k - 1)) {
            all = false;
            break;
          }
        }
      }
      if (all) return true;
    }
  }
  return false;
}

export const brute: Brute<P20> = (p) => {
  const good: number[] = [];
  for (let s = 1; s <= p.cap; s++) {
    const st: Pos = p.game.heaps === 1 ? [s] : [s, p.tail];
    if (!wins(p, st, 1) && wins(p, st, 2)) good.push(s);
  }
  if (good.length < 2) return [];
  const pair = p.shape === 'least' ? [good[0], good[1]] : [good[0], good[good.length - 1]];
  return [`${pair[0]} ${pair[1]}`];
};
