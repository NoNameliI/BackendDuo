/** Exact integer helpers over bigint. Pure; no task text. */

export const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

export const pow = (base: number | bigint, exp: number): bigint => BigInt(base) ** BigInt(exp);

/** ceil(a / b) for a >= 0, b > 0. */
export const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** Smallest b >= 0 with 2^b >= n (n >= 1). */
export function ceilLog2(n: bigint): number {
  if (n < 1n) throw new RangeError('ceilLog2 of a non-positive number');
  let b = 0;
  while (1n << BigInt(b) < n) b++;
  return b;
}

/** n! / (n-k)!, the number of ordered selections of k distinct items. */
export function permutations(n: number, k: number): bigint {
  let r = 1n;
  for (let i = 0; i < k; i++) r *= BigInt(n - i);
  return k > n ? 0n : r;
}

/** Decimal text of an integer that may exceed 2^53. */
export const text = (x: bigint | number): string => x.toString();

/** Number when it fits exactly, otherwise its decimal string (for statement fields). */
export const safe = (x: bigint): number | string => (x <= BigInt(Number.MAX_SAFE_INTEGER) && x >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(x) : x.toString());
