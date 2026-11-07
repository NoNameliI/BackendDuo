import type { Brute } from '../types';
import type { P16 } from './g16';

/** Bottom-up evaluation from the definition; the call count is a literal run of the plain recursion. */
export const brute: Brute<P16> = (p) => {
  const k0 = p.init.length;
  const pick = (n: number) => p.rules.find((r) => r.when === 'any' || (r.when === 'even' ? n % 2 === 0 : n % 2 === 1));

  if (p.shape === 'calls') {
    let count = 0;
    const run = (n: number): void => {
      count++;
      if (n <= k0) return;
      const r = pick(n);
      if (!r) throw new Error('no rule');
      for (const t of r.terms) run(n - t.lag);
    };
    run(p.N);
    return [String(count)];
  }

  const top = Math.max(p.N, p.M);
  const f: bigint[] = [0n];
  for (let n = 1; n <= top; n++) {
    if (n <= k0) {
      f.push(BigInt(p.init[n - 1]));
      continue;
    }
    const r = pick(n);
    if (!r) return [];
    let v = BigInt(r.add);
    for (const t of r.terms) v += BigInt(t.a * n + t.b) * f[n - t.lag];
    f.push(v);
  }
  if (p.shape === 'value') return [f[p.N].toString()];
  if (f[p.M] === 0n || f[p.N] % f[p.M] !== 0n) return [];
  return [(f[p.N] / f[p.M]).toString()];
};
