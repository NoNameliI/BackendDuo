import type { Brute } from '../types';
import type { P14 } from './g14';

const SYMBOLS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Every answer that satisfies the statement, found with plain BigInt arithmetic. */
export const brute: Brute<P14> = (p) => {
  if (p.shape === 'powers') {
    let n = BigInt(p.k);
    for (const t of p.terms) n += BigInt(t.c) * BigInt(t.b) ** BigInt(t.e);
    if (n <= 0n) return [];
    const text = n.toString(p.base);
    const want = SYMBOLS[p.digit];
    let total = 0;
    for (const ch of text) {
      if (p.ask === 'count') total += ch === want ? 1 : 0;
      else if (p.ask === 'nonzero') total += ch !== '0' ? 1 : 0;
      else total += SYMBOLS.indexOf(ch);
    }
    return [String(total)];
  }

  const found = new Set<string>();
  const top = Math.max(...p.nums.map((n) => n.base));
  for (let x = 0; x < top; x++) {
    let sum = 0n;
    let valid = true;
    for (const num of p.nums) {
      const text = num.text.replaceAll('x', SYMBOLS[x]);
      if (text[0] === '0') valid = false;
      let value = 0n;
      for (const ch of text) {
        const d = SYMBOLS.indexOf(ch.toLowerCase());
        if (d < 0 || d >= num.base) valid = false;
        value = value * BigInt(num.base) + BigInt(Math.max(d, 0));
      }
      sum += value;
    }
    if (valid && sum % BigInt(p.m) === 0n) found.add((sum / BigInt(p.m)).toString());
  }
  return [...found].sort((a, b) => (a.length === b.length ? (a < b ? -1 : a > b ? 1 : 0) : a.length - b.length));
};
