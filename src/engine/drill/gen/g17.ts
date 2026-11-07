/**
 * g17: a sequence of integers in a text file (first line = count, then one number per line).
 * Answer: pair "count maxSum". Shapes: `adjacent`, `triples`, `gap`.
 *
 * adjacent / triples: windows of 2 / 3 consecutive elements. A window is valid when exactly `need` of its elements are
 * divisible by p and every extra holds: sumMod (sum % m == r), sumMax (sum <= t), spread (max - min >= t).
 *   adjacent: base n=2000 values 1..999, need=1, no extras. core n=8000 values 1..9999, need 0..2, one extra.
 *   hard n=12000 values 1..99999, need 0..2, two different extras.
 *   triples: same sizes; need 1..2 (base 1).
 * gap: pairs i<j with j-i >= g and (a_i + a_j) % m == r, optionally only elements >= floor (hard).
 *   Residue buckets keyed by value % m keep count and maximum of the already-reachable elements: O(n).
 *   base n=1500 g 2..10; core n=2500 g 10..60; hard n=3000 g 30..200, floor ~ 1/4 of the value range.
 * Reject: fewer than 3 valid windows/pairs.
 * steps: count, best sum, position of the first best window/pair (1-based).
 */
import { Reject, type DataFile, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';

export type Extra = { kind: 'sumMod'; m: number; r: number } | { kind: 'sumMax'; t: number } | { kind: 'spread'; t: number };
export type P17 =
  | { shape: 'adjacent' | 'triples'; level: Level; a: number[]; p: number; need: number; extras: Extra[] }
  | { shape: 'gap'; level: Level; a: number[]; g: number; m: number; r: number; floor: number };

const SIZE = {
  base: { n: 2000, vmax: 999, gapN: 1500 },
  core: { n: 8000, vmax: 9999, gapN: 2500 },
  hard: { n: 12000, vmax: 99999, gapN: 3000 },
} as const;
const MIN_COUNT = 3;

function extraOk(e: Extra, sum: number, mx: number, mn: number): boolean {
  return e.kind === 'sumMod' ? sum % e.m === e.r : e.kind === 'sumMax' ? sum <= e.t : mx - mn >= e.t;
}

function solveWindows(p: Extract<P17, { shape: 'adjacent' | 'triples' }>): Solved {
  const size = p.shape === 'adjacent' ? 2 : 3;
  const { a } = p;
  let count = 0;
  let best = -Infinity;
  let at = 0;
  for (let i = 0; i + size <= a.length; i++) {
    let div = 0;
    let sum = 0;
    let mx = -Infinity;
    let mn = Infinity;
    for (let k = 0; k < size; k++) {
      const v = a[i + k];
      if (v % p.p === 0) div++;
      sum += v;
      if (v > mx) mx = v;
      if (v < mn) mn = v;
    }
    if (div !== p.need) continue;
    let ok = true;
    for (const e of p.extras) if (!extraOk(e, sum, mx, mn)) ok = false;
    if (!ok) continue;
    count++;
    if (sum > best) {
      best = sum;
      at = i + 1;
    }
  }
  if (count < MIN_COUNT) throw new Reject('too few windows');
  const win = a.slice(at - 1, at - 1 + size);
  return {
    answer: `${count} ${best}`,
    steps: {
      count,
      best,
      at,
      window: win,
      windowDiv: win.filter((v) => v % p.p === 0).length,
      windowMax: Math.max(...win),
      windowMin: Math.min(...win),
    },
  };
}

function solveGap(p: Extract<P17, { shape: 'gap' }>): Solved {
  const { a, g, m, r, floor } = p;
  const cnt = new Array<number>(m).fill(0);
  const top = new Array<number>(m).fill(-Infinity);
  const bestOf = new Array<number>(m).fill(-1); // index of the bucket maximum
  let count = 0;
  let best = -Infinity;
  let at = 0;
  let atJ = 0;
  for (let j = g; j < a.length; j++) {
    const left = a[j - g];
    if (left >= floor) {
      const k = left % m;
      cnt[k]++;
      if (left > top[k]) {
        top[k] = left;
        bestOf[k] = j - g;
      }
    }
    const v = a[j];
    if (v < floor) continue;
    const need = (((r - v) % m) + m) % m;
    if (cnt[need] === 0) continue;
    count += cnt[need];
    if (v + top[need] > best) {
      best = v + top[need];
      at = bestOf[need] + 1;
      atJ = j + 1;
    }
  }
  if (count < MIN_COUNT) throw new Reject('too few pairs');
  return {
    answer: `${count} ${best}`,
    steps: { count, best, at, atJ, left: a[at - 1], right: a[atJ - 1], dist: atJ - at, pairMod: best % m },
  };
}

function build(rng: Rng, level: Level, shape: P17['shape']): P17 {
  const s = SIZE[level];
  if (shape === 'gap') {
    const a = Array.from({ length: s.gapN }, () => rng.int(1, s.vmax));
    const m = rng.int(level === 'base' ? 3 : 5, level === 'hard' ? 14 : 9);
    const g = level === 'base' ? rng.int(2, 10) : level === 'core' ? rng.int(10, 60) : rng.int(30, 200);
    return { shape, level, a, g, m, r: rng.int(0, m - 1), floor: level === 'hard' ? Math.floor(s.vmax * (0.15 + rng.next() * 0.2)) : 0 };
  }
  const a = Array.from({ length: s.n }, () => rng.int(1, s.vmax));
  const size = shape === 'adjacent' ? 2 : 3;
  const pr = rng.pick(level === 'base' ? [3, 4, 5, 7] : [3, 5, 7, 9, 11, 13]);
  const need = level === 'base' ? 1 : shape === 'adjacent' ? rng.int(0, 2) : rng.int(1, 2);
  const pool: Extra[] = [
    { kind: 'sumMod', m: rng.int(3, 9), r: 0 },
    { kind: 'sumMax', t: Math.floor(s.vmax * size * (0.3 + rng.next() * 0.3)) },
    { kind: 'spread', t: Math.floor(s.vmax * (0.15 + rng.next() * 0.35)) },
  ];
  if (pool[0].kind === 'sumMod') pool[0].r = rng.int(0, pool[0].m - 1);
  const wanted = level === 'base' ? 0 : level === 'core' ? 1 : 2;
  const extras = rng.shuffle(pool).slice(0, wanted);
  return { shape, level, a, p: pr, need, extras };
}

function fields(p: P17): Fields {
  const n = p.a.length;
  if (p.shape === 'gap') {
    return { n, g: p.g, m: p.m, r: p.r, hasFloor: p.floor > 0, floor: p.floor };
  }
  return {
    n,
    p: p.p,
    need: p.need,
    needNone: p.need === 0,
    needOne: p.need === 1,
    needTwo: p.need === 2,
    extras: p.extras.map((e) => ({
      isSumMod: e.kind === 'sumMod',
      isSumMax: e.kind === 'sumMax',
      isSpread: e.kind === 'spread',
      m: e.kind === 'sumMod' ? e.m : 0,
      r: e.kind === 'sumMod' ? e.r : 0,
      t: e.kind === 'sumMod' ? 0 : e.t,
    })),
    hasExtras: p.extras.length > 0,
  };
}

export const g17: Generator<P17> = {
  id: 'g17',
  answer: { kind: 'pair' },
  shapes: ['adjacent', 'triples', 'gap'],
  generate: (rng, level, shape) => {
    if (shape !== 'adjacent' && shape !== 'triples' && shape !== 'gap') throw new Error(`g17: unknown shape "${shape}"`);
    return build(rng, level, shape);
  },
  solve: (p) => (p.shape === 'gap' ? solveGap(p) : solveWindows(p)),
  fields,
  files: (p): DataFile[] => [{ kind: 'text', text: `${p.a.length}\n${p.a.join('\n')}\n` }],
};
