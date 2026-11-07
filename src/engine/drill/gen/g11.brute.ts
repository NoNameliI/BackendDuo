import type { Brute } from '../types';
import type { P11 } from './g11';

/** Direct reading of the statement: find bit widths by trial, count codes by explicit multiplication. */
export const brute: Brute<P11> = (p) => {
  const bitsFor = (n: bigint) => {
    let b = 0;
    while (2n ** BigInt(b) < n) b++;
    return b;
  };
  const bytesFor = (bits: number) => {
    let bytes = 0;
    while (bytes * 8 < bits) bytes++;
    return bytes;
  };
  const perCode = (): number => {
    if (p.shape === 'plates') {
      let codes = 1n;
      for (const g of p.groups) {
        for (let i = 0; i < g.len; i++) codes *= BigInt(g.distinct ? g.size - i : g.size);
      }
      return bytesFor(bitsFor(codes));
    }
    const size = p.parts.letters + p.parts.digits + p.parts.other;
    return bytesFor(bitsFor(BigInt(size)) * p.len);
  };

  const inRange = (v: number) => v >= 2 && v <= 200000;
  const pc = perCode();
  if (p.shape === 'extra') {
    const totalBytes = p.unit === 'KiB' ? p.total * 1024 : p.total;
    const found: number[] = [];
    for (let extra = 1; extra <= 200000; extra++) if ((pc + extra) * p.count === totalBytes) found.push(extra);
    return found.filter(inRange).map(String);
  }
  const total = (pc + p.extra) * p.count;
  let shown = total;
  if (p.unit === 'KiB') {
    shown = 0;
    while (shown * 1024 < total) shown++;
  }
  return inRange(shown) ? [String(shown)] : [];
};
