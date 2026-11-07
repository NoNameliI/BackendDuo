/**
 * g14: positional numeral systems. Answer: int. Shapes: `powers`, `digit`.
 *
 * powers: N = sum of c*b^e plus k, written in `base`; count the digits equal to `digit`, the nonzero digits, or
 *   their sum. b is a power of the base, so each term is rewritten to c*base^(j*e) and added on a sparse run list
 *   (exponent -> digit, runs of base-1 come from borrows): O(terms), no big integer.
 *   base: base 2, b in {2,4,8}, 2-3 terms, e <= 40, |k| <= 20, ask count.
 *   core: base in {2,3,4,5,7,8,9}, b = base^1..3, 3-4 terms, e 100..2030, one or more negative terms, |k| <= 60.
 *   hard: base 2..16, 4-5 terms, the two terms below the leading one are negative (nested borrow runs), |k| <= 300,
 *     ask may be the digit sum, the counted digit may be >= 10.
 *   Reject: N <= 0; two terms with the same exponent after rewriting; answer < 2 or (count/nonzero) equal to the
 *   number of digits; core/hard without a borrow run of 10 or more; hard without two borrow runs; N longer than
 *   12000 digits (brute cost).
 *
 * digit: numbers written in given bases contain an unknown digit x; find the x for which their sum is divisible
 *   by m and answer the quotient. value(x) = A + W*x with A, W from place values; the congruence W*x = -A (mod m)
 *   is solved with the extended Euclid algorithm and candidates are taken from [lo, min(base) - 1] (lo = 1 when
 *   x leads a number).
 *   base: one number with x once plus one known number, base 11..16, m 7..15.
 *   core: two numbers, x in 2-3 places, base 13..30, m 10..30, gcd(m, base) = 1.
 *   hard: two different bases 11..30, x in both numbers (leading in the first), m 13..50.
 *   Reject: the number of candidates is not exactly one; quotient <= 0; m divides every value(x).
 */
import { Reject, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';

export type Term = { c: number; b: number; e: number }; // c*b^e, c != 0 (sign in c); b is a power of the base
export type P14 =
  | { shape: 'powers'; base: number; terms: Term[]; k: number; ask: 'count' | 'nonzero' | 'sum'; digit: number }
  | { shape: 'digit'; nums: { text: string; base: number }[]; m: number };

type Powers = Extract<P14, { shape: 'powers' }>;
type Digit = Extract<P14, { shape: 'digit' }>;

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_DIGITS = 12_000;

const digitText = (d: number) => DIGITS[d];
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

// ---------------------------------------------------------------- powers

type Run = { pos: number; len: number; digit: number }; // ascending positions, merged

/** Digits of sum(v_i * base^E_i) as runs, or null when the sum is not positive. */
function sparseSum(base: number, items: { E: number; v: number }[]): Run[] | null {
  const sorted = items.slice().sort((a, b) => a.E - b.E);
  const runs: Run[] = [];
  let pos = 0;
  let carry = 0;
  const push = (len: number, digit: number) => {
    const last = runs[runs.length - 1];
    if (last && last.digit === digit) last.len += len;
    else runs.push({ pos, len, digit });
    pos += len;
  };
  const step = () => {
    const d = ((carry % base) + base) % base;
    carry = (carry - d) / base;
    push(1, d);
  };
  const advance = (to: number) => {
    while (pos < to) {
      if (carry === 0) push(to - pos, 0);
      else if (carry === -1) push(to - pos, base - 1);
      else step();
    }
  };
  for (const { E, v } of sorted) {
    advance(E);
    carry += v;
  }
  while (carry > 0) step();
  if (carry < 0) return null;
  while (runs.length > 0 && runs[runs.length - 1].digit === 0) runs.pop();
  return runs.length > 0 ? runs : null;
}

function exponentOf(base: number, b: number): number {
  let j = 0;
  for (let x = 1; x < b; x *= base) j++;
  if (base ** j !== b || j === 0) throw new Error(`g14: ${b} is not a power of ${base}`);
  return j;
}

function analyze(p: Powers): { runs: Run[]; length: number; rewritten: { c: number; e: number }[] } {
  const rewritten = p.terms.map((t) => ({ c: t.c, e: exponentOf(p.base, t.b) * t.e }));
  if (new Set(rewritten.map((t) => t.e)).size !== rewritten.length) throw new Reject('same exponent');
  const items = [...rewritten.map((t) => ({ E: t.e, v: t.c })), { E: 0, v: p.k }];
  const runs = sparseSum(p.base, items);
  if (!runs) throw new Reject('not positive');
  const top = runs[runs.length - 1];
  const length = top.pos + top.len;
  if (length > MAX_DIGITS) throw new Reject('too long');
  return { runs, length, rewritten };
}

function solvePowers(p: Powers): Solved {
  const { runs, length, rewritten } = analyze(p);
  let count = 0;
  for (const r of runs) {
    if (p.ask === 'count') count += r.digit === p.digit ? r.len : 0;
    else if (p.ask === 'nonzero') count += r.digit !== 0 ? r.len : 0;
    else count += r.digit * r.len;
  }
  if (count < 2 || (p.ask !== 'sum' && count === length)) throw new Reject('trivial answer');
  return {
    answer: String(count),
    steps: {
      rewritten,
      runs: runs
        .slice()
        .reverse()
        .map((r) => ({ from: r.pos + r.len - 1, to: r.pos, digitText: digitText(r.digit), len: r.len, single: r.len === 1 })),
      length,
      count,
    },
  };
}

const pickDigit = (rng: Rng, base: number) => (rng.chance(0.5) ? base - 1 : rng.chance(0.5) ? 0 : rng.int(0, base - 1));

function buildPowers(rng: Rng, level: Level): Powers {
  const base = level === 'base' ? 2 : level === 'core' ? rng.pick([2, 3, 4, 5, 7, 8, 9]) : rng.int(2, 16);
  const count = level === 'base' ? rng.int(2, 3) : level === 'core' ? rng.int(3, 4) : rng.int(4, 5);
  const raw = Array.from({ length: count }, () => {
    const j = rng.int(1, 3);
    const e = level === 'base' ? rng.int(1, 40) : rng.int(100, 2030);
    return { j, e, E: j * e };
  }).sort((a, b) => b.E - a.E);
  const negative = raw.map((_, i) => i > 0 && rng.chance(level === 'core' ? 0.3 : 0.4));
  if (level === 'core') negative[rng.int(1, count - 1)] = true;
  if (level === 'hard') negative[1] = negative[2] = true;
  const cMax = level === 'base' ? 3 : level === 'core' ? Math.max(1, Math.min(base - 1, 6)) : Math.max(2, Math.min(base, 9));
  const terms = raw.map((r, i): Term => ({ c: (negative[i] ? -1 : 1) * rng.int(1, cMax), b: base ** r.j, e: r.e }));
  const kMax = level === 'base' ? 20 : level === 'core' ? 60 : 300;
  const k = rng.int(-kMax, kMax);

  let ask: Powers['ask'] = 'count';
  let digit = 0;
  if (level === 'base') digit = rng.int(0, 1);
  else if (level === 'core') {
    ask = rng.chance(0.7) ? 'count' : 'nonzero';
    digit = pickDigit(rng, base);
  } else {
    const r = rng.next();
    ask = r < 0.3 ? 'sum' : r < 0.8 ? 'count' : 'nonzero';
    digit = base >= 11 && rng.chance(0.5) ? base - 1 : pickDigit(rng, base);
  }
  const p: Powers = { shape: 'powers', base, terms, k, ask, digit };

  const { runs } = analyze(p);
  if (level !== 'base') {
    const borrows = runs.filter((r) => r.digit === base - 1 && r.len >= 10).length;
    if (borrows === 0) throw new Reject('no borrow run');
    if (level === 'hard' && runs.filter((r) => r.digit === base - 1 && r.len >= 3).length < 2) throw new Reject('one borrow run');
  }
  return p;
}

function powersFields(p: Powers): Fields {
  const terms: Term[] = p.terms.slice().sort((a, b) => exponentOf(p.base, b.b) * b.e - exponentOf(p.base, a.b) * a.e);
  if (p.k !== 0) terms.push({ c: p.k, b: 1, e: 0 });
  return {
    base: p.base,
    terms,
    askCount: p.ask === 'count',
    askNonzero: p.ask === 'nonzero',
    askSum: p.ask === 'sum',
    digitText: digitText(p.digit),
  };
}

// ---------------------------------------------------------------- digit

function modInverse(a: number, m: number): number {
  let [r0, r1] = [m, a % m];
  let [t0, t1] = [0, 1];
  while (r1 !== 0) {
    const q = Math.floor(r0 / r1);
    [r0, r1] = [r1, r0 - q * r1];
    [t0, t1] = [t1, t0 - q * t1];
  }
  return ((t0 % m) + m) % m;
}

function solveDigit(p: Digit): Solved {
  let A = 0n;
  let W = 0n;
  let lo = 0;
  let hi = Infinity;
  const weights: { place: number; value: string; num: number; base: number }[] = [];
  p.nums.forEach((num, ni) => {
    const b = BigInt(num.base);
    const len = num.text.length;
    if (num.text[0] === '0') throw new Reject('leading zero');
    for (let i = 0; i < len; i++) {
      const place = len - 1 - i;
      const w = b ** BigInt(place);
      const ch = num.text[i];
      if (ch === 'x') {
        W += w;
        hi = Math.min(hi, num.base - 1);
        if (i === 0) lo = 1;
        weights.push({ place, value: w.toString(), num: ni + 1, base: num.base });
      } else {
        const d = DIGITS.indexOf(ch);
        if (d < 0 || d >= num.base) throw new Reject('bad digit');
        A += BigInt(d) * w;
      }
    }
  });
  if (W === 0n || hi < lo) throw new Reject('no unknown digit');
  const mB = BigInt(p.m);
  const aMod = Number(A % mB);
  const wMod = Number(W % mB);
  if (aMod === 0 && wMod === 0) throw new Reject('divisible for every x');
  const g = gcd(wMod, p.m);
  const target = (p.m - aMod) % p.m;
  if (target % g !== 0) throw new Reject('no candidate');
  const m1 = p.m / g;
  const x0 = m1 === 1 ? 0 : (((target / g) * modInverse((wMod / g) % m1, m1)) % m1);
  const first = x0 + Math.max(0, Math.ceil((lo - x0) / m1)) * m1;
  const candidates: number[] = [];
  for (let x = first; x <= hi && candidates.length < 2; x += m1) candidates.push(x);
  if (candidates.length !== 1) throw new Reject('candidates are not unique');
  const x = candidates[0];
  const value = A + W * BigInt(x);
  const quotient = value / mB;
  if (quotient <= 0n) throw new Reject('quotient is not positive');
  return {
    answer: quotient.toString(),
    steps: { weights, aMod, wMod, x, value: value.toString(), quotient: quotient.toString() },
  };
}

function buildDigit(rng: Rng, level: Level): Digit {
  type Cells = (number | null)[];
  const known = (base: number, len: number): Cells => Array.from({ length: len }, (_, i) => rng.int(i === 0 ? 1 : 0, base - 1));
  const text = (cells: Cells) => cells.map((d) => (d === null ? 'x' : digitText(d))).join('');

  if (level === 'base') {
    const base = rng.int(11, 16);
    const a = known(base, rng.int(4, 6));
    a[rng.int(0, a.length - 1)] = null;
    const nums = rng.shuffle([{ text: text(a), base }, { text: text(known(base, rng.int(3, 6))), base }]);
    return { shape: 'digit', nums, m: rng.int(7, 15) };
  }

  const bases = level === 'core' ? [rng.int(13, 30)] : [rng.int(11, 30)];
  if (level === 'core') bases.push(bases[0]);
  else {
    let second = rng.int(11, 30);
    while (second === bases[0]) second = rng.int(11, 30);
    bases.push(second);
  }
  let m: number;
  if (level === 'core') {
    const coprime = Array.from({ length: 21 }, (_, i) => i + 10).filter((v) => gcd(v, bases[0]) === 1);
    m = rng.pick(coprime);
  } else m = rng.int(13, 50);

  const lens = bases.map(() => (level === 'core' ? rng.int(5, 8) : rng.int(6, 9)));
  const cells = bases.map((b, i) => known(b, lens[i]));
  const chosen = new Set<string>();
  const mark = (ni: number, pos: number) => {
    chosen.add(`${ni}:${pos}`);
    cells[ni][pos] = null;
  };
  const wanted = level === 'core' ? rng.int(2, 3) : rng.int(2, 4);
  if (level === 'hard') {
    mark(0, 0);
    mark(1, rng.chance(0.5) ? 0 : rng.int(1, lens[1] - 1));
  }
  while (chosen.size < wanted) {
    const ni = rng.int(0, 1);
    const pos = rng.int(0, lens[ni] - 1);
    if (!chosen.has(`${ni}:${pos}`)) mark(ni, pos);
  }
  return { shape: 'digit', nums: cells.map((c, i) => ({ text: text(c), base: bases[i] })), m };
}

// ---------------------------------------------------------------- generator

export const g14: Generator<P14> = {
  id: 'g14',
  answer: { kind: 'int' },
  shapes: ['powers', 'digit'],
  generate(rng, level, shape) {
    if (shape === 'powers') return buildPowers(rng, level);
    if (shape === 'digit') return buildDigit(rng, level);
    throw new Error(`g14: unknown shape "${shape}"`);
  },
  solve: (p) => (p.shape === 'powers' ? solvePowers(p) : solveDigit(p)),
  fields: (p) =>
    p.shape === 'powers'
      ? powersFields(p)
      : { nums: p.nums, m: p.m, bases: p.nums.map((n) => n.base) },
};
