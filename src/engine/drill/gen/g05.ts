/**
 * g05: building a number from the binary notation of N by a short list of steps. Answer: int.
 * Shapes: `min-n`, `min-r`, `max-n`.
 *
 * Steps work on the binary string s of the current number (no leading zeros) and are applied in order; the whole list
 * is performed `repeat` times; R is the decimal value of the final string.
 *   parity  - append the parity bit of the number of ones (inv: its complement)
 *   branch  - append `a` if the condition holds, `b` otherwise (condition: last bit is 0 / number of ones is even)
 *   prepend - write the string `s` to the left
 *   rem     - append the number of ones modulo 4 as two bits
 * Every algorithm appends at least one bit per round, so R(N) >= 2N.
 *   min-n: the smallest N with R(N) > T.   min-r: the smallest R > T over all N.   max-n: the largest N with R(N) <= T.
 *   base: 2 steps, T 15..60.   core: 3 steps, T 60..250.   hard: 3-4 steps, possibly repeated, T 150..900.
 * solve: integer arithmetic on (value, length) pairs, scanning N upward (or downward) with the bound R(N) >= N * 2^s,
 *   s = bits appended for sure. Reject: answer N <= 2, or nothing in range.
 */
import { Reject, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';
import { bin, popcount } from './shared/bits';

export type Step =
  | { t: 'parity'; inv: boolean }
  | { t: 'branch'; on: 'last' | 'ones'; a: string; b: string }
  | { t: 'prepend'; s: string }
  | { t: 'rem' };

export interface P05 {
  shape: 'min-n' | 'min-r' | 'max-n';
  steps: Step[];
  repeat: number;
  limit: number;
}

/** R(N) with plain integer arithmetic: value and bit length of the current string. */
function run(p: P05, n: number): number {
  let v = n;
  let len = bin(n).length;
  const append = (bits: number, k: number) => {
    v = v * 2 ** k + bits;
    len += k;
  };
  for (let round = 0; round < p.repeat; round++) {
    for (const st of p.steps) {
      if (st.t === 'parity') append(popcount(v) % 2 ^ (st.inv ? 1 : 0), 1);
      else if (st.t === 'branch') {
        const cond = st.on === 'last' ? v % 2 === 0 : popcount(v) % 2 === 0;
        const w = cond ? st.a : st.b;
        append(parseInt(w, 2), w.length);
      } else if (st.t === 'prepend') {
        v += parseInt(st.s, 2) * 2 ** len;
        len += st.s.length;
      } else append(popcount(v) % 4, 2);
    }
  }
  return v;
}

/** Bits appended in every round no matter what. */
function sureBits(p: P05): number {
  let s = 0;
  for (const st of p.steps) {
    if (st.t === 'parity') s += 1;
    else if (st.t === 'branch') s += Math.min(st.a.length, st.b.length);
    else if (st.t === 'rem') s += 2;
  }
  return s * p.repeat;
}

function trace(p: P05, n: number): { stage: number; bits: string }[] {
  // Same walk on strings, only to show the intermediate notations in the explanation.
  const out: { stage: number; bits: string }[] = [{ stage: 0, bits: bin(n) }];
  let s = bin(n);
  const ones = () => [...s].filter((c) => c === '1').length;
  for (let round = 0; round < p.repeat; round++) {
    for (const st of p.steps) {
      if (st.t === 'parity') s += String((ones() % 2) ^ (st.inv ? 1 : 0));
      else if (st.t === 'branch') s += (st.on === 'last' ? s.endsWith('0') : ones() % 2 === 0) ? st.a : st.b;
      else if (st.t === 'prepend') s = st.s + s;
      else s += (ones() % 4).toString(2).padStart(2, '0');
      out.push({ stage: out.length, bits: s });
    }
  }
  return out;
}

function find(p: P05): { n: number; r: number } {
  const s = 2 ** sureBits(p);
  if (p.shape === 'min-n') {
    for (let n = 1; n <= p.limit + 1; n++) if (run(p, n) > p.limit) return { n, r: run(p, n) };
  } else if (p.shape === 'min-r') {
    let best = -1;
    let at = 0;
    for (let n = 1; best < 0 || n * s <= best; n++) {
      const r = run(p, n);
      if (r > p.limit && (best < 0 || r < best)) {
        best = r;
        at = n;
      }
    }
    return { n: at, r: best };
  } else {
    for (let n = Math.floor(p.limit / s); n >= 1; n--) if (run(p, n) <= p.limit) return { n, r: run(p, n) };
  }
  throw new Reject('nothing found');
}

function solve(p: P05): Solved {
  const { n, r } = find(p);
  const answer = p.shape === 'min-r' ? r : n;
  if (p.shape !== 'min-r' && n <= 2) throw new Reject('trivial');
  const walk = trace(p, n);
  return {
    answer: String(answer),
    steps: {
      n,
      k: sureBits(p),
      twoPowK: 2 ** sureBits(p),
      scanLimit: Math.floor((p.shape === 'max-n' ? p.limit : r) / 2 ** sureBits(p)),
      nBits: bin(n),
      trace: walk,
      resultBits: walk[walk.length - 1].bits,
      result: r,
      justBelow: p.shape === 'min-n' && n > 1 ? run(p, n - 1) : 0,
    },
  };
}

function randomBits(rng: Rng, len: number, leadOne: boolean): string {
  let s = '';
  for (let i = 0; i < len; i++) s += leadOne && i === 0 ? '1' : String(rng.int(0, 1));
  return s;
}

function buildSteps(rng: Rng, level: Level): { steps: Step[]; repeat: number } {
  const branch = (): Step => {
    const len = rng.int(1, level === 'base' ? 1 : 2);
    let a = randomBits(rng, len, false);
    let b = randomBits(rng, rng.chance(0.6) ? len : rng.int(1, 2), false);
    if (a === b) b = a.length === 1 ? String(1 - Number(a)) : a.slice(0, -1) + String(1 - Number(a[a.length - 1]));
    if (rng.chance(0.5)) [a, b] = [b, a];
    return { t: 'branch', on: rng.chance(0.5) ? 'last' : 'ones', a, b };
  };
  const parity = (): Step => ({ t: 'parity', inv: rng.chance(0.4) });
  const prepend = (): Step => ({ t: 'prepend', s: randomBits(rng, rng.int(1, 2), true) });
  const rem = (): Step => ({ t: 'rem' });

  if (level === 'base') {
    return { steps: rng.shuffle<Step>([parity(), branch()]), repeat: 1 };
  }
  if (level === 'core') {
    const first = rng.pick([parity, branch]);
    const mid = rng.pick([parity, branch, prepend]);
    return { steps: [first(), mid(), rng.chance(0.5) ? parity() : branch()], repeat: 1 };
  }
  const steps: Step[] = [rng.pick([parity, branch, rem])(), rng.pick([parity, branch, rem, prepend])()];
  if (rng.chance(0.6)) steps.push(rng.pick([parity, branch, prepend])());
  return { steps: steps.some((s) => s.t === 'rem') ? steps : [...steps, rem()], repeat: rng.chance(0.6) ? 2 : 1 };
}

export const g05: Generator<P05> = {
  id: 'g05',
  answer: { kind: 'int' },
  shapes: ['min-n', 'min-r', 'max-n'],
  generate(rng, level, shape) {
    if (shape !== 'min-n' && shape !== 'min-r' && shape !== 'max-n') throw new Error(`g05: unknown shape "${shape}"`);
    const { steps, repeat } = buildSteps(rng, level);
    const [lo, hi] = level === 'base' ? [15, 60] : level === 'core' ? [60, 250] : [150, 900];
    return { shape, steps, repeat, limit: rng.int(lo, hi) };
  },
  solve,
  fields(p): Fields {
    return {
      steps: p.steps.map((st) => ({
        isParity: st.t === 'parity',
        isBranch: st.t === 'branch',
        isPrepend: st.t === 'prepend',
        isRem: st.t === 'rem',
        inv: st.t === 'parity' && st.inv,
        onLast: st.t === 'branch' && st.on === 'last',
        onOnes: st.t === 'branch' && st.on === 'ones',
        a: st.t === 'branch' ? st.a : '',
        b: st.t === 'branch' ? st.b : '',
        s: st.t === 'prepend' ? st.s : '',
      })),
      repeat: p.repeat,
      repeated: p.repeat > 1,
      limit: p.limit,
      askMinN: p.shape === 'min-n',
      askMinR: p.shape === 'min-r',
      askMaxN: p.shape === 'max-n',
    };
  },
};
