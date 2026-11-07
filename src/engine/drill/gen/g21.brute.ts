import type { Brute } from '../types';
import type { P21 } from './g21';

type Pos = number[];

/** Plain game-tree simulation: can the mover force a win within k own moves? */
function wins(p: P21, st: Pos, k: number): boolean {
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

/** Every first move leaves a position where the second mover wins within `k` own moves (no first-move win). */
function everyReplyWins(p: P21, st: Pos, k: number): boolean {
  for (let i = 0; i < st.length; i++) {
    for (const op of p.game.ops) {
      const nx = st.slice();
      nx[i] = op.kind === 'add' ? st[i] + op.k : st[i] * op.k;
      if (nx.reduce((a, b) => a + b, 0) >= p.game.limit) return false;
      if (!wins(p, nx, k)) return false;
    }
  }
  return true;
}

export const brute: Brute<P21> = (p) => {
  const good: number[] = [];
  for (let s = 1; s <= p.cap; s++) {
    const st: Pos = p.game.heaps === 1 ? [s] : [s, p.tail];
    if (everyReplyWins(p, st, 2) && !everyReplyWins(p, st, 1)) good.push(s);
  }
  if (good.length === 0) return [];
  return [String(p.shape === 'least' ? good[0] : good[good.length - 1])];
};
