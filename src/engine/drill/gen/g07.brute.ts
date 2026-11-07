import type { Brute } from '../types';
import type { P07 } from './g07';

/** Plain stepwise arithmetic: bits -> bytes -> units, bigint throughout. */
export const brute: Brute<P07> = (p) => {
  const unitBytes = (u: 'KiB' | 'MiB') => (u === 'KiB' ? 1024n : 1048576n);
  const ceilTo = (x: bigint, d: bigint) => {
    let q = x / d;
    if (q * d < x) q += 1n;
    return q;
  };
  const keep = (v: bigint, hi: bigint) => (v >= 2n && v <= hi ? [v.toString()] : []);

  if (p.shape === 'sound') {
    const bits = BigInt(p.rate) * BigInt(p.depth) * BigInt(p.channels) * BigInt(p.seconds);
    return keep(ceilTo(ceilTo(bits, 8n), unitBytes(p.unit)), 5000n);
  }
  if (p.shape === 'image') {
    const pixels = BigInt(p.w * p.h) * BigInt(p.count);
    if (p.ask === 'size') {
      let bpp = 0n;
      while (2n ** bpp < BigInt(p.colors)) bpp++;
      return keep(ceilTo(ceilTo(pixels * bpp, 8n), unitBytes(p.unit)), 5000n);
    }
    const limitBytes = BigInt(p.limit) * unitBytes(p.unit);
    let best = 0n;
    for (let b = 1n; b <= 64n; b++) if (ceilTo(pixels * b, 8n) <= limitBytes) best = b;
    return best >= 2n && best <= 20n ? [(2n ** best).toString()] : [];
  }
  // Independent route: apply the factors one by one to the size, tracking a fraction.
  let n = BigInt(p.sizeA);
  let d = 1n;
  for (const key of ['rate', 'depth', 'channels', 'time'] as const) {
    if (p.f[key].up) n *= BigInt(p.f[key].k);
    else d *= BigInt(p.f[key].k);
  }
  if (n % d !== 0n) return [];
  const size = n / d;
  return size === BigInt(p.sizeA) ? [] : keep(size, 2000n);
};
