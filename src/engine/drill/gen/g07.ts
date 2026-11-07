/**
 * g07: memory for sound and raster images. Answer: int. Shapes: `sound`, `image`, `change`.
 *
 * sound:  size = rate * depth * channels * time, in bytes -> KiB or MiB, rounded up to a whole number.
 *   base: mono, 8-22 kHz, 8 or 16 bit, 10-90 s, KiB.   core: 1-2 channels, 22-48 kHz, 16-32 bit, 20-300 s, MiB.
 *   hard: 2-6 channels, up to 96 kHz, 16-32 bit, 30-600 s given as minutes and seconds, MiB.
 * image:  size = width * height * bits per pixel * count, bits = ceil(log2(colors)); ask the size (rounded up)
 *   or the largest palette that fits into a size limit (a power of two).
 *   base: power-of-two palettes, one image, KiB.  core: MiB, wide pictures, size or palette.
 *   hard: palettes that are not powers of two, several images, size or palette.
 * change: a recording of known size is redone with other parameters; only the factors (x or / k per parameter) are shown;
 *   ratios of the changed parameters (2 / 3 / 4 of them), always a whole number of MiB.
 * Reject: answers outside 2..5000 (change: size above 2000), degenerate palettes, fractional results.
 */
import { Reject, type FieldValue, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';
import { ceilDiv, gcd, ceilLog2 } from './shared/bigint';

type ChangeKey = 'rate' | 'depth' | 'channels' | 'time';
/** k = 1 means the parameter is unchanged. */
type Factor = { up: boolean; k: number };
type Snd = { rate: number; depth: number; channels: number; seconds: number };
export type P07 =
  | ({ shape: 'sound'; unit: 'KiB' | 'MiB' } & Snd)
  | {
      shape: 'image';
      w: number;
      h: number;
      colors: number;
      count: number;
      unit: 'KiB' | 'MiB';
      ask: 'size' | 'colors';
      limit: number;
    }
  | { shape: 'change'; sizeA: number; f: Record<ChangeKey, Factor> };

const UNIT_BITS = { KiB: 8n * 1024n, MiB: 8n * 1024n * 1024n } as const;

function checkRange(v: bigint, hi = 5000n) {
  if (v < 2n || v > hi) throw new Reject('answer out of range');
}

function solve07(p: P07): Solved {
  if (p.shape === 'sound') {
    const bits = BigInt(p.rate) * BigInt(p.depth) * BigInt(p.channels) * BigInt(p.seconds);
    const size = ceilDiv(bits, UNIT_BITS[p.unit]);
    checkRange(size);
    const bytes = ceilDiv(bits, 8n);
    return { answer: size.toString(), steps: { bits: bits.toString(), bytes: bytes.toString(), size: size.toString() } };
  }
  if (p.shape === 'image') {
    const pixels = BigInt(p.w) * BigInt(p.h) * BigInt(p.count);
    if (p.ask === 'size') {
      const bpp = ceilLog2(BigInt(p.colors));
      const bits = pixels * BigInt(bpp);
      const size = ceilDiv(bits, UNIT_BITS[p.unit]);
      checkRange(size);
      return {
        answer: size.toString(),
        steps: {
          bpp,
          pixels: pixels.toString(),
          bits: bits.toString(),
          bytes: ceilDiv(bits, 8n).toString(),
          unitBits: UNIT_BITS[p.unit].toString(),
          unitBytes: (UNIT_BITS[p.unit] / 8n).toString(),
          sizeFloor: (bits / UNIT_BITS[p.unit]).toString(),
          rounded: bits % UNIT_BITS[p.unit] !== 0n,
          size: size.toString(),
        },
      };
    }
    const limitBits = BigInt(p.limit) * UNIT_BITS[p.unit];
    const bpp = Number(limitBits / pixels);
    if (bpp < 2 || bpp > 20) throw new Reject('palette out of range');
    const colors = 1n << BigInt(bpp);
    return {
      answer: colors.toString(),
      steps: {
        pixels: pixels.toString(),
        limitBits: limitBits.toString(),
        bppExact: (Number(limitBits * 100n / pixels) / 100).toString(),
        bpp,
        colors: colors.toString(),
      },
    };
  }
  const [num, den] = changeRatio(p.f);
  const g = gcd(num, den);
  const rn = num / g;
  const rd = den / g;
  if (BigInt(p.sizeA) % rd !== 0n) throw new Reject('fractional result');
  const size = (BigInt(p.sizeA) / rd) * rn;
  checkRange(size, 2000n);
  if (size === BigInt(p.sizeA)) throw new Reject('unchanged');
  return {
    answer: size.toString(),
    steps: {
      ratioNum: rn.toString(),
      ratioDen: rd.toString(),
      mulTotal: num.toString(),
      divTotal: den.toString(),
      size: size.toString(),
    },
  };
}

const CHANGE_KEYS: readonly ChangeKey[] = ['rate', 'depth', 'channels', 'time'];

function changeRatio(f: Record<ChangeKey, Factor>): [bigint, bigint] {
  let num = 1n;
  let den = 1n;
  for (const key of CHANGE_KEYS) {
    if (f[key].up) num *= BigInt(f[key].k);
    else den *= BigInt(f[key].k);
  }
  return [num, den];
}

const RATES = { base: [8000, 11025, 16000, 22050], core: [22050, 32000, 44100, 48000], hard: [44100, 48000, 96000] };
const DEPTHS = { base: [8, 16], core: [16, 24, 32], hard: [16, 24, 32] };

function buildSound(rng: Rng, level: Level): P07 {
  const channels = level === 'base' ? 1 : level === 'core' ? rng.pick([1, 2]) : rng.pick([2, 4, 6]);
  const seconds =
    level === 'base' ? rng.int(2, 18) * 5 : level === 'core' ? rng.int(2, 30) * 10 : rng.int(6, 120) * 5;
  return {
    shape: 'sound',
    rate: rng.pick(RATES[level]),
    depth: rng.pick(DEPTHS[level]),
    channels,
    seconds,
    unit: level === 'base' ? 'KiB' : 'MiB',
  };
}

function buildImage(rng: Rng, level: Level): P07 {
  const dim = () => (level === 'base' ? rng.int(8, 40) * 16 : rng.int(40, 200) * 16);
  const colors =
    level === 'hard'
      ? rng.pick([100, 200, 1000, 5000, 100000, 3000000])
      : level === 'core'
        ? rng.pick([256, 65536, 16777216])
        : rng.pick([2, 4, 16, 256]);
  const ask: 'size' | 'colors' = level === 'base' ? 'size' : rng.chance(0.5) ? 'size' : 'colors';
  const count = level === 'hard' ? rng.int(2, 24) : 1;
  const unit: 'KiB' | 'MiB' = level === 'base' ? 'KiB' : 'MiB';
  const w = dim();
  const h = dim();
  let limit = 0;
  if (ask === 'colors') {
    const bpp = rng.int(level === 'hard' ? 3 : 2, 12);
    const needBits = BigInt(w) * BigInt(h) * BigInt(count) * BigInt(bpp);
    limit = Number(ceilDiv(needBits, UNIT_BITS[unit])) + rng.int(0, 1);
  }
  return { shape: 'image', w, h, colors: ask === 'colors' ? 0 : colors, count, unit, ask, limit };
}

function buildChange(rng: Rng, level: Level): P07 {
  const changes = level === 'base' ? 2 : level === 'core' ? 3 : 4;
  const keys = rng.shuffle<ChangeKey>([...CHANGE_KEYS]).slice(0, changes);
  const f = {} as Record<ChangeKey, Factor>;
  for (const key of CHANGE_KEYS) f[key] = { up: true, k: 1 };
  for (const key of keys) {
    const k = key === 'channels' ? 2 : rng.pick(level === 'base' ? [2, 4] : [2, 3, 4]);
    f[key] = { up: rng.chance(0.5), k };
  }
  const [num, den] = changeRatio(f);
  const rd = Number(den / gcd(num, den));
  if (rd > 40) throw new Reject('ratio too awkward');
  const sizeA = rd * rng.int(1, Math.max(1, Math.floor(40 / rd)));
  return { shape: 'change', sizeA, f };
}

export const g07: Generator<P07> = {
  id: 'g07',
  answer: { kind: 'int' },
  shapes: ['sound', 'image', 'change'],
  generate(rng, level, shape) {
    const p = shape === 'sound' ? buildSound(rng, level) : shape === 'image' ? buildImage(rng, level) : shape === 'change' ? buildChange(rng, level) : null;
    if (!p) throw new Error(`g07: unknown shape "${shape}"`);
    solve07(p);
    return p;
  },
  solve: solve07,
  fields(p): Fields {
    if (p.shape === 'sound') {
      return {
        rate: p.rate,
        depth: p.depth,
        channels: p.channels,
        seconds: p.seconds,
        minutes: Math.floor(p.seconds / 60),
        secs: p.seconds % 60,
        askKiB: p.unit === 'KiB',
        askMiB: p.unit === 'MiB',
      };
    }
    if (p.shape === 'image') {
      return {
        w: p.w,
        h: p.h,
        colors: p.colors,
        count: p.count,
        single: p.count === 1,
        askSize: p.ask === 'size',
        askColors: p.ask === 'colors',
        limit: p.limit,
        askKiB: p.unit === 'KiB',
        askMiB: p.unit === 'MiB',
      };
    }
    const out: Record<string, FieldValue> = { sizeA: p.sizeA };
    for (const key of CHANGE_KEYS) {
      const { up, k } = p.f[key];
      const changed = k !== 1;
      out[`${key}Changed`] = changed;
      out[`${key}Up`] = changed && up;
      out[`${key}Down`] = changed && !up;
      out[`${key}Mul`] = up ? k : 1;
      out[`${key}Div`] = up ? 1 : k;
      out[`${key}MulOne`] = !(changed && up);
      out[`${key}DivOne`] = !(changed && !up);
    }
    return out;
  },
};
