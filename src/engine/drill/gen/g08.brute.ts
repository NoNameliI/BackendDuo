import type { Brute } from '../types';
import type { P08 } from './g08';

/** Lists every word of the alphabet in alphabetical order and tests each against the rules directly. */
export const brute: Brute<P08> = (p) => {
  const size = p.letters.length;
  const valid = (w: number[]): boolean => {
    for (const r of p.rules) {
      if (r.kind === 'distinct' && new Set(w).size !== w.length) return false;
      if (r.kind === 'noRepeat' && w.some((x, i) => i > 0 && x === w[i - 1])) return false;
      if (r.kind === 'count') {
        const k = w.filter((x) => x === r.letter).length;
        if (r.op === 'eq' && k !== r.n) return false;
        if (r.op === 'le' && k > r.n) return false;
        if (r.op === 'ge' && k < r.n) return false;
      }
      if (r.kind === 'notFirst' && r.letters.includes(w[0])) return false;
      if (r.kind === 'notLast' && r.letters.includes(w[w.length - 1])) return false;
      if (r.kind === 'noPair' && w.some((x, i) => i > 0 && w[i - 1] === r.a && x === r.b)) return false;
    }
    return true;
  };

  const list: number[][] = [];
  const w = new Array<number>(p.length).fill(0);
  for (;;) {
    if (valid(w)) list.push(w.slice());
    let i = p.length - 1;
    while (i >= 0 && w[i] === size - 1) w[i--] = 0;
    if (i < 0) break;
    w[i]++;
  }

  if (list.length < 10 || list.length === size ** p.length) return [];
  if (p.shape === 'count') return [String(list.length)];
  if (p.shape === 'first') {
    const idx = list.findIndex((x) => x[0] === p.target);
    return idx <= 0 ? [] : [String(idx + 1)];
  }
  const idx = list.findIndex((x) => x.every((c, i) => c === p.word[i]));
  return idx <= 0 || idx === list.length - 1 ? [] : [String(idx + 1)];
};
