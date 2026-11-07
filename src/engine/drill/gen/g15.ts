/**
 * g15: logic with a parameter A. Answer: int. Shapes: `divisor`, `segment`, `mask`.
 *
 * Every shape: a formula over atoms (leaf 0 is the atom with the unknown A, leaves 1.. are fixed) must be true for
 * ALL natural x; find A. Atoms:
 *   divisor: "c divides x" (A divides x). A is a natural number; ask the smallest or the largest A.
 *     Truth depends on x only through which of the numbers divide x, so for every subset S of the constants the least
 *     x divisible by exactly S (and, with A, by lcm(S, A)) decides; the largest A is claimed only when no A outside
 *     the divisors of the lcm can work (class representatives A'*q, q a big prime).
 *     base: 2 constants, lcm <= 24. core: 2-3 constants, lcm <= 48. hard: 3 constants, lcm <= 48.
 *   segment: "x lies in [a, b]" (integers); A = [l, r] is an unknown segment, answer = r - l, smallest or largest.
 *     Elementary regions between the segment ends give, for every region, whether x must lie in A, outside A or is free.
 *     base: 2 known segments, ends <= 40. core: 2, ends <= 60. hard: 3, ends <= 60.
 *   mask: "x AND c is not zero" (A a natural number below 128); ask the smallest A. For every combination of the
 *     fixed atoms the set of x realizing it either must meet A (then every minimal x must) or must miss A (then no bit
 *     of the union may be in A).
 * Reject: no valid A / impossible regions / unbounded answer, trivial answers (<= 1).
 */
import { Reject, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';
import { evalExpr, printTokens, randomTree, tokensText, type Expr } from './shared/logic';

export type P15 =
  | { shape: 'divisor'; consts: number[]; expr: Expr; ask: 'min' | 'max' }
  | { shape: 'segment'; segs: [number, number][]; expr: Expr; ask: 'min' | 'max' }
  | { shape: 'mask'; consts: number[]; expr: Expr; ask: 'min' };

const SEG_NAMES = ['P', 'Q', 'R'];
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number) => (a / gcd(a, b)) * b;
const lcmAll = (xs: readonly number[]) => xs.reduce(lcm, 1);

// ---------------------------------------------------------------- divisor

const BIG_PRIME = 1000003;

function divisorValid(consts: readonly number[], expr: Expr, A: number): boolean {
  const k = consts.length;
  for (let S = 0; S < 1 << k; S++) {
    let L = 1;
    for (let j = 0; j < k; j++) if ((S >> j) & 1) L = lcm(L, consts[j]);
    const others = consts.filter((_, j) => !((S >> j) & 1));
    const check = (x: number, a: boolean) => {
      if (others.some((c) => x % c === 0)) return; // pattern S cannot occur with this x
      if (!evalExpr(expr, (i) => (i === 0 ? a : (S >> (i - 1)) & 1 ? true : false))) throw new Error('fail');
    };
    try {
      // a true: the least such x is lcm(L, A); a false: the least is L itself unless A divides it
      check(lcm(L, A), true);
      if (L % A !== 0) check(L, false);
    } catch {
      return false;
    }
  }
  return true;
}

function solveDivisor(p: Extract<P15, { shape: 'divisor' }>): Solved {
  const L = lcmAll(p.consts);
  const cap = L + 24;
  const valid: number[] = [];
  for (let A = 1; A <= cap; A++) if (divisorValid(p.consts, p.expr, A)) valid.push(A);
  if (valid.length === 0) throw new Reject('no A');
  if (p.ask === 'max') {
    for (let d = 1; d <= L; d++) if (L % d === 0 && divisorValid(p.consts, p.expr, d * BIG_PRIME)) throw new Reject('unbounded');
  }
  const answer = p.ask === 'min' ? valid[0] : valid[valid.length - 1];
  if (answer <= 1) throw new Reject('trivial');
  return { answer: String(answer), steps: { lcm: L, valid: valid.slice(0, 12), validCount: valid.length } };
}

function buildDivisor(rng: Rng, level: Level): P15 {
  const k = level === 'base' ? 2 : level === 'core' ? rng.int(2, 3) : 3;
  const limit = level === 'base' ? 24 : 48;
  const pool = [2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 16, 18];
  const consts: number[] = [];
  for (let tries = 0; consts.length < k && tries < 30; tries++) {
    const c = rng.pick(pool);
    if (consts.includes(c) || lcmAll([...consts, c]) > limit) continue;
    // no constant divides another one (keeps the atoms independent enough to be interesting)
    if (consts.some((d) => c % d === 0 || d % c === 0)) continue;
    consts.push(c);
  }
  if (consts.length < k) throw new Reject('constants');
  const expr = randomTree(rng, Array.from({ length: k + 1 }, (_, i) => i), { ops: ['and', 'or', 'imp', 'imp'], negLeaf: 0.4 });
  return { shape: 'divisor', consts, expr, ask: level === 'base' ? 'min' : rng.pick(['min', 'max'] as const) };
}

// ---------------------------------------------------------------- segment

function solveSegment(p: Extract<P15, { shape: 'segment' }>): Solved {
  const cuts = [...new Set([1, ...p.segs.flatMap(([a, b]) => [a, b + 1])])].sort((x, y) => x - y);
  type Region = { from: number; to: number; need: 'in' | 'out' | 'free' }; // to = Infinity for the last one
  const regions: Region[] = cuts.map((from, i) => {
    const inSeg = p.segs.map(([a, b]) => a <= from && from <= b);
    const at = (a: boolean) => evalExpr(p.expr, (j) => (j === 0 ? a : inSeg[j - 1]));
    const [f0, f1] = [at(false), at(true)];
    if (!f0 && !f1) throw new Reject('impossible region');
    return { from, to: i + 1 < cuts.length ? cuts[i + 1] - 1 : Infinity, need: f0 && f1 ? 'free' : f1 ? 'in' : 'out' };
  });
  const need = regions.filter((r) => r.need === 'in');
  if (need.length === 0) throw new Reject('A may be empty');
  const lo = need[0].from;
  const hi = need[need.length - 1].to;
  if (hi === Infinity) throw new Reject('unbounded');
  if (regions.some((r) => r.need === 'out' && r.from <= hi && r.to >= lo)) throw new Reject('A cannot be a segment');
  const before = regions.filter((r) => r.need === 'out' && r.to < lo);
  const after = regions.filter((r) => r.need === 'out' && r.from > hi);
  const left = before.length ? before[before.length - 1].to + 1 : 1;
  const right = after.length ? after[0].from - 1 : Infinity;
  if (p.ask === 'max' && right === Infinity) throw new Reject('unbounded');
  const answer = p.ask === 'min' ? hi - lo : right - left;
  if (answer <= 0) throw new Reject('trivial');
  return {
    answer: String(answer),
    steps: {
      regions: regions.map((r) => ({ from: r.from, to: r.to === Infinity ? 0 : r.to, open: r.to === Infinity, needIn: r.need === 'in', needOut: r.need === 'out' })),
      lo,
      hi,
      left,
      right: right === Infinity ? 0 : right,
    },
  };
}

function buildSegment(rng: Rng, level: Level): P15 {
  const m = level === 'hard' ? 3 : 2;
  const top = level === 'base' ? 40 : 60;
  const segs: [number, number][] = Array.from({ length: m }, () => {
    const a = rng.int(1, top - 8);
    return [a, a + rng.int(3, Math.min(25, top - a))] as [number, number];
  });
  const expr = randomTree(rng, Array.from({ length: m + 1 }, (_, i) => i), { ops: ['and', 'or', 'imp', 'imp'], negLeaf: 0.4 });
  return { shape: 'segment', segs, expr, ask: level === 'base' ? 'min' : rng.pick(['min', 'max'] as const) };
}

// ---------------------------------------------------------------- mask

const MASK_BITS = 8; // x ranges over 8-bit patterns; bit 7 is outside every constant and every A < 128

function solveMask(p: Extract<P15, { shape: 'mask' }>): Solved {
  const k = p.consts.length;
  const members: number[][] = Array.from({ length: 1 << k }, () => []);
  for (let x = 0; x < 1 << MASK_BITS; x++) {
    let S = 0;
    p.consts.forEach((c, j) => {
      if ((x & c) !== 0) S |= 1 << j;
    });
    members[S].push(x);
  }
  const hit: number[][] = []; // every A must meet each of these x
  let forbidden = 0; // bits no A may contain
  for (let S = 0; S < 1 << k; S++) {
    if (members[S].length === 0) continue;
    const at = (a: boolean) => evalExpr(p.expr, (i) => (i === 0 ? a : ((S >> (i - 1)) & 1) === 1));
    if (!at(false) && !at(true)) throw new Reject('impossible combination');
    if (!at(false)) hit.push(members[S].filter((x) => !members[S].some((y) => y !== x && (y & x) === y)));
    if (!at(true)) for (const x of members[S]) forbidden |= x;
  }
  let answer = 0;
  for (let A = 1; A < 128 && answer === 0; A++) {
    if ((A & forbidden) !== 0) continue;
    if (hit.every((minimal) => minimal.every((x) => (x & A) !== 0))) answer = A;
  }
  if (answer <= 1) throw new Reject(answer === 0 ? 'no A' : 'trivial');
  const allowed = ~forbidden & 127;
  return {
    answer: String(answer),
    steps: {
      forbidden,
      forbiddenBits: forbidden.toString(2),
      allowed,
      allowedBits: allowed.toString(2).padStart(7, '0'),
      allowedBitCount: allowed.toString(2).split('1').length - 1,
      answerBits: answer.toString(2),
    },
  };
}

function buildMask(rng: Rng, level: Level): P15 {
  const k = level === 'base' ? 2 : 3;
  const consts = new Set<number>();
  while (consts.size < k) consts.add(rng.int(3, level === 'hard' ? 63 : 31));
  const expr = randomTree(rng, Array.from({ length: k + 1 }, (_, i) => i), { ops: ['and', 'or', 'imp', 'imp'], negLeaf: 0.4 });
  return { shape: 'mask', consts: [...consts], expr, ask: 'min' };
}

// ---------------------------------------------------------------- generator

function atoms(p: P15): Fields[] {
  const blank = { isA: false, c: 0, lo: 0, hi: 0, name: '' };
  if (p.shape === 'segment') {
    return [{ ...blank, isA: true, name: 'A' }, ...p.segs.map(([lo, hi], i) => ({ ...blank, lo, hi, name: SEG_NAMES[i] }))];
  }
  return [{ ...blank, isA: true, name: 'A' }, ...p.consts.map((c) => ({ ...blank, c }))];
}

const solveAny = (p: P15): Solved =>
  p.shape === 'divisor' ? solveDivisor(p) : p.shape === 'segment' ? solveSegment(p) : solveMask(p);

export const g15: Generator<P15> = {
  id: 'g15',
  answer: { kind: 'int' },
  shapes: ['divisor', 'segment', 'mask'],
  generate(rng, level, shape) {
    const make =
      shape === 'divisor' ? buildDivisor : shape === 'segment' ? buildSegment : shape === 'mask' ? buildMask : null;
    if (!make) throw new Error(`g15: unknown shape "${shape}"`);
    // Most random formulas are degenerate: draw several here, the outer loop only sees the survivors.
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const p = make(rng, level);
        solveAny(p);
        return p;
      } catch (e) {
        if (!(e instanceof Reject)) throw e;
      }
    }
    throw new Reject('no usable formula');
  },
  solve: solveAny,
  fields(p): Fields {
    const at = atoms(p);
    const text = (i: number) =>
      p.shape === 'divisor'
        ? `D(x,${i === 0 ? 'A' : p.consts[i - 1]})`
        : p.shape === 'segment'
          ? `x∈${at[i].name}`
          : `(x & ${i === 0 ? 'A' : p.consts[i - 1]}) ≠ 0`;
    const tokens = printTokens(p.expr, text);
    return {
      formula: tokensText(tokens),
      tokens,
      atoms: at,
      askMin: p.ask === 'min',
      askMax: p.ask === 'max',
    };
  },
};
