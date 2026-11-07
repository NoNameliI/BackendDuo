import type { Brute } from '../types';
import type { P05 } from './g05';

/** Direct simulation on strings of digits. */
function result(p: P05, n: number): number {
  let s = n.toString(2);
  const ones = () => s.split('').filter((c) => c === '1').length;
  for (let round = 0; round < p.repeat; round++) {
    for (const st of p.steps) {
      if (st.t === 'parity') {
        const bit = ones() % 2 === 1 ? '1' : '0';
        s += st.inv ? (bit === '1' ? '0' : '1') : bit;
      } else if (st.t === 'branch') {
        const cond = st.on === 'last' ? s[s.length - 1] === '0' : ones() % 2 === 0;
        s += cond ? st.a : st.b;
      } else if (st.t === 'prepend') {
        s = st.s + s;
      } else {
        s += ['00', '01', '10', '11'][ones() % 4];
      }
    }
  }
  return parseInt(s, 2);
}

export const brute: Brute<P05> = (p) => {
  if (p.shape === 'min-n') {
    for (let n = 1; n <= p.limit + 1; n++) if (result(p, n) > p.limit) return [String(n)];
    return [];
  }
  if (p.shape === 'max-n') {
    let last = 0;
    for (let n = 1; n <= p.limit; n++) if (result(p, n) <= p.limit) last = n;
    return last > 0 ? [String(last)] : [];
  }
  // min-r: every round appends at least one bit, so R(n) >= 2n and no n above the best value can improve it
  let best = Infinity;
  for (let n = 1; n <= best && n <= 4 * p.limit + 100000; n++) {
    const r = result(p, n);
    if (r > p.limit && r < best) best = r;
  }
  return best === Infinity ? [] : [String(best)];
};
