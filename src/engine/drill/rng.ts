import type { Rng } from './types';

/** cyrb53 over the joined parts, folded to a uint32. */
export function hashSeed(...parts: (string | number)[]): number {
  const s = parts.map(String).join('\u0001');
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

/** sfc32 with state from splitmix32(seed) and 12 warm-up outputs. */
export function createRng(seed: number): Rng {
  const sm = splitmix32(seed >>> 0);
  let a = sm();
  let b = sm();
  let c = sm();
  let d = sm();
  const u32 = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) u32();

  const int = (lo: number, hi: number): number => {
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) throw new RangeError(`int(${lo}, ${hi})`);
    const span = hi - lo + 1;
    if (span > 4294967296) throw new RangeError('range wider than 2^32');
    // Rejection on uint32: no modulo bias.
    const limit = Math.floor(4294967296 / span) * span;
    let u = u32();
    while (u >= limit) u = u32();
    return lo + (u % span);
  };
  return {
    seed: seed >>> 0,
    next: () => u32() / 4294967296,
    int,
    pick: <T>(xs: readonly T[]): T => {
      if (xs.length === 0) throw new RangeError('pick from an empty list');
      return xs[int(0, xs.length - 1)];
    },
    shuffle: <T>(xs: readonly T[]): T[] => {
      const out = xs.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    chance: (p) => u32() / 4294967296 < p,
    fork: (label) => createRng(hashSeed(seed >>> 0, label)),
  };
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/** Seeds are shown as 8 hex digits. */
export function seedHex(seed: number): string {
  return (seed >>> 0).toString(16).padStart(8, '0');
}

export function parseSeedHex(text: string): number | null {
  const t = text.trim();
  return /^[0-9a-fA-F]{1,8}$/.test(t) ? parseInt(t, 16) : null;
}
