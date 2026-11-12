const M = 0x5bd1e995;
const SEED = 0x9747b28c | 0;

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Utils.murmur2 of the Kafka clients: 32-bit signed arithmetic, little-endian blocks, tail falls through. */
export function murmur2(data: Uint8Array): number {
  const length = data.length;
  let h = SEED ^ length;
  const blocks = length >> 2;
  for (let i = 0; i < blocks; i++) {
    const j = i << 2;
    let k = (data[j] & 0xff) | ((data[j + 1] & 0xff) << 8) | ((data[j + 2] & 0xff) << 16) | ((data[j + 3] & 0xff) << 24);
    k = Math.imul(k, M);
    k ^= k >>> 24;
    k = Math.imul(k, M);
    h = Math.imul(h, M);
    h ^= k;
  }
  const index = blocks << 2;
  // The tail of the Java switch falls through from 3 to 1.
  const tail = length - index;
  if (tail >= 3) h ^= (data[index + 2] & 0xff) << 16;
  if (tail >= 2) h ^= (data[index + 1] & 0xff) << 8;
  if (tail >= 1) {
    h ^= data[index] & 0xff;
    h = Math.imul(h, M);
  }
  h ^= h >>> 13;
  h = Math.imul(h, M);
  h ^= h >>> 15;
  return h | 0;
}

/** Utils.toPositive is a mask, not abs. */
export const toPositive = (n: number): number => n & 0x7fffffff;

export const murmur2String = (s: string): number => murmur2(utf8(s));
