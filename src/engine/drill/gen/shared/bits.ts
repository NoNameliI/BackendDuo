/** Bit and address helpers. Pure; numbers stay within 2^53. */

export function popcount(n: number): number {
  let c = 0;
  let x = n;
  while (x > 0) {
    c += x % 2;
    x = Math.floor(x / 2);
  }
  return c;
}

export const bin = (n: number): string => n.toString(2);

export function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) r = (r * (n - i + 1)) / i;
  return Math.round(r);
}

export const ipToInt = (o: readonly number[]): number => ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
export const intToIp = (v: number): number[] => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
export const prefixMask = (p: number): number => (p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);
export const ipText = (o: readonly number[]): string => o.join('.');
