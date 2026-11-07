import type { Brute } from '../types';
import type { P10 } from './g10';

const bits32 = (o: readonly number[]): string => o.map((x) => x.toString(2).padStart(8, '0')).join('');
const fromBits = (s: string): number[] => [0, 8, 16, 24].map((i) => parseInt(s.slice(i, i + 8), 2));
const ones = (s: string): number => s.split('').filter((c) => c === '1').length;

/** Works on 32-character strings of bits. */
export const brute: Brute<P10> = (p) => {
  if (p.shape === 'network') {
    const ip = bits32(p.ip);
    const mask = '1'.repeat(p.prefix) + '0'.repeat(32 - p.prefix);
    let s = '';
    for (let i = 0; i < 32; i++) {
      const bit = p.what === 'net' ? (ip[i] === '1' && mask[i] === '1' ? '1' : '0') : mask[i] === '0' ? '1' : ip[i];
      s += bit;
    }
    const o = fromBits(s);
    const v = p.part === 0 ? o.reduce((a, b) => a + b, 0) : o[p.part - 1];
    return p.part !== 0 && v === 0 ? [] : [String(v)];
  }

  if (p.shape === 'mask') {
    const ip = bits32(p.ip);
    const net = bits32(p.net);
    const fit: number[] = [];
    for (let k = 0; k <= 32; k++) {
      let ok = true;
      for (let i = 0; i < 32; i++) {
        const masked = i < k && ip[i] === '1' ? '1' : '0';
        if (masked !== net[i]) ok = false;
      }
      if (ok) fit.push(k);
    }
    if (fit.length < 2) return [];
    const lo = Math.min(...fit);
    const hi = Math.max(...fit);
    if (p.ask === 'minOnes') return [String(lo)];
    if (p.ask === 'maxOnes') return [String(hi)];
    return [String(Math.pow(2, 32 - lo) - 2)];
  }

  const ip = bits32(p.ip);
  const head = ip.slice(0, p.prefix);
  const h = 32 - p.prefix;
  let count = 0;
  for (let host = 0; host < 2 ** h; host++) {
    if (p.exclude && (host === 0 || host === 2 ** h - 1)) continue;
    const addr = head + host.toString(2).padStart(h, '0');
    const n = ones(addr);
    const ok = p.cond.kind === 'even' ? n % 2 === 0 : p.cond.kind === 'odd' ? n % 2 === 1 : n % p.cond.m === 0;
    if (ok) count++;
  }
  return count < 2 ? [] : [String(count)];
};
