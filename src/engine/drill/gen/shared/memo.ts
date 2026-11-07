/** Memoized recursion: `f` receives the key and a cached `self` to call for sub-problems. Pure, no task text. */
export function memoRec<K extends string | number, V>(f: (key: K, self: (key: K) => V) => V): (key: K) => V {
  const cache = new Map<K, V>();
  const self = (key: K): V => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = f(key, self);
    cache.set(key, value);
    return value;
  };
  return self;
}

/** Decimal string of a BigInt (integers above 2^53 travel as strings). */
export const big = (v: bigint): string => v.toString();
