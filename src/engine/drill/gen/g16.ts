/**
 * g16: recursive functions. Answer: int (values above 2^53 are decimal strings). Shapes: `value`, `ratio`, `calls`.
 *
 * F is defined by its first k0 values and, for n > k0, by a rule chosen by the parity of n (or the same rule for
 * every n): F(n) = sum over terms of (a*n + b) * F(n - lag), plus a constant.
 * value: the value F(N). Top-down memoized recursion with big integers.
 *   base: k0 = 2, two terms, N chosen so the value has 2..9 digits. core: two or three terms, 10..30 digits.
 *   hard: parity-dependent rules, 17..60 digits.
 * ratio: F(N) / F(M) where every rule is a single term (n + b) * F(n - lag): the quotient is the product of the
 *   factors for n = N, N - lag, ... down to M + lag (telescoping), no huge number is needed.
 *   base: N 12..20, N - M 2..4. core: N 100..2030, N - M 3..6, one rule. hard: N up to 2100, N - M 4..8, a rule
 *   for even n and another for odd n.
 * calls: how many calls of F (the first one included) the plain recursive evaluation of F(N) makes.
 *   calls(n) = 1 for n <= k0, else 1 + the sum of calls over the terms. Memoized recursion with big integers.
 *   base: up to 500 calls. core: 1 000..200 000. hard: parity rules, up to 1 000 000.
 *
 * Reject: values or counts outside the ranges above; N too close to k0; quotient not exact.
 */
import { Reject, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';
import { memoRec } from './shared/memo';

export type Term = { a: number; b: number; lag: number };
export type FRule = { when: 'any' | 'even' | 'odd'; terms: Term[]; add: number };
export type P16 = { shape: 'value' | 'ratio' | 'calls'; init: number[]; rules: FRule[]; N: number; M: number };

const ruleFor = (rules: readonly FRule[], n: number): FRule => {
  const r = rules.find((x) => x.when === 'any' || (x.when === 'even') === (n % 2 === 0));
  if (!r) throw new Reject('no rule');
  return r;
};

function solve16(p: P16): Solved {
  const k0 = p.init.length;
  if (p.N <= k0 + 2) throw new Reject('N too small');
  if (p.shape === 'ratio') {
    const lag = p.rules[0].terms[0].lag;
    if (p.M < k0 || (p.N - p.M) % lag !== 0 || p.N <= p.M) throw new Reject('bad ratio range');
    let product = 1n;
    const factors: number[] = [];
    for (let k = p.N; k > p.M; k -= lag) {
      const t = ruleFor(p.rules, k).terms;
      if (t.length !== 1 || t[0].lag !== lag || t[0].a !== 1) throw new Reject('not a product rule');
      const f = k + t[0].b;
      if (f < 1) throw new Reject('factor');
      factors.push(f);
      product *= BigInt(f);
    }
    const items = factors.map((f, i) => ({ n: p.N - i * lag, f, odd: (p.N - i * lag) % 2 !== 0 }));
    return {
      answer: product.toString(),
      steps: { factors, factorItems: items, factorCount: factors.length, stepLag: lag, product: product.toString() },
    };
  }
  if (p.shape === 'calls') {
    const calls = memoRec<number, bigint>((n, self) => {
      if (n <= k0) return 1n;
      let s = 1n;
      for (const t of ruleFor(p.rules, n).terms) s += self(n - t.lag);
      return s;
    });
    const total = calls(p.N);
    const tableLen = Math.min(p.N, 10);
    const table = Array.from({ length: tableLen }, (_, i) => ({ n: i + 1, c: Number(calls(i + 1)) }));
    const used = ruleFor(p.rules, p.N).terms.map((t) => ({ lag: t.lag, n: p.N - t.lag, c: calls(p.N - t.lag).toString() }));
    return { answer: total.toString(), steps: { calls: total.toString(), callTable: table, callTerms: used } };
  }
  const f = memoRec<number, bigint>((n, self) => {
    if (n <= k0) return BigInt(p.init[n - 1]);
    const r = ruleFor(p.rules, n);
    let s = BigInt(r.add);
    for (const t of r.terms) s += BigInt(t.a * n + t.b) * self(n - t.lag);
    return s;
  });
  const value = f(p.N);
  const order = Math.max(...ruleFor(p.rules, p.N).terms.map((t) => t.lag));
  const from = Math.min(p.N - 2, p.N - order);
  const tailItems = Array.from({ length: p.N - from }, (_, i) => ({ n: from + i, v: f(from + i).toString() }));
  const tail = tailItems.map((x) => x.v);
  return {
    answer: value.toString(),
    steps: { tail, tailItems, order, value: value.toString(), digits: value.toString().length },
  };
}

// ---------------------------------------------------------------- construction

/** Sequence values by plain iteration (used to pick N). */
function sequence(init: number[], rules: FRule[], upTo: number): bigint[] {
  const v: bigint[] = [0n, ...init.map(BigInt)];
  for (let n = init.length + 1; n <= upTo; n++) {
    const r = ruleFor(rules, n);
    let s = BigInt(r.add);
    for (const t of r.terms) s += BigInt(t.a * n + t.b) * v[n - t.lag];
    v.push(s);
  }
  return v;
}

function sumRule(rng: Rng, level: Level, k0: number, when: FRule['when']): FRule {
  const count = level === 'base' ? 2 : rng.int(2, 3);
  const lags = rng.shuffle(Array.from({ length: k0 }, (_, i) => i + 1)).slice(0, Math.min(count, k0));
  if (lags.length < 2) lags.push(lags[0] + 1);
  const bMax = level === 'base' ? 2 : level === 'core' ? 3 : 4;
  const terms: Term[] = lags.sort((x, y) => x - y).map((lag) => ({ a: 0, b: rng.int(1, bMax), lag }));
  return { when, terms, add: level === 'base' ? rng.int(0, 3) : rng.int(-3, 5) };
}

function build(rng: Rng, level: Level, shape: P16['shape']): P16 {
  if (shape === 'ratio') {
    const lag = rng.int(1, 2);
    const mk = (when: FRule['when']): FRule => ({ when, terms: [{ a: 1, b: rng.int(-2, 6), lag }], add: 0 });
    const rules = level === 'hard' ? [mk('even'), mk('odd')] : [mk('any')];
    if (level === 'hard' && rules[0].terms[0].b === rules[1].terms[0].b) throw new Reject('same parity rules');
    const init = [rng.int(1, 3), rng.int(1, 3)];
    const [nLo, nHi] = level === 'base' ? [12, 20] : level === 'core' ? [100, 2030] : [1500, 2100];
    const [dLo, dHi] = level === 'base' ? [2, 4] : level === 'core' ? [3, 6] : [4, 8];
    const N = rng.int(nLo, nHi);
    const M = N - lag * Math.ceil(rng.int(dLo, dHi) / lag);
    return { shape, init, rules, N, M };
  }
  const k0 = level === 'base' ? 2 : rng.int(2, 3);
  const init = Array.from({ length: k0 }, () => rng.int(1, 4));
  const rules: FRule[] = level === 'hard' ? [sumRule(rng, level, k0, 'even'), sumRule(rng, level, k0, 'odd')] : [sumRule(rng, level, k0, 'any')];
  const upTo = shape === 'value' ? (level === 'base' ? 30 : level === 'core' ? 90 : 160) : 40;
  const seq = sequence(init, rules, upTo);
  let candidates: number[];
  if (shape === 'value') {
    const [lo, hi] = level === 'base' ? [2, 9] : level === 'core' ? [10, 30] : [17, 60];
    candidates = seq.map((_, n) => n).filter((n) => n > k0 + 2 && seq[n] > 0n && seq[n].toString().length >= lo && seq[n].toString().length <= hi);
  } else {
    const cap = level === 'base' ? 500 : level === 'core' ? 200_000 : 1_000_000;
    const floor = level === 'base' ? 20 : level === 'core' ? 1000 : 100_000;
    const calls = memoRec<number, number>((n, self) => (n <= k0 ? 1 : 1 + ruleFor(rules, n).terms.reduce((s, t) => s + self(n - t.lag), 0)));
    candidates = Array.from({ length: upTo + 1 }, (_, n) => n).filter((n) => n > k0 + 2 && calls(n) >= floor && calls(n) <= cap);
  }
  if (candidates.length === 0) throw new Reject('no suitable N');
  return { shape, init, rules, N: rng.pick(candidates), M: 0 };
}

export const g16: Generator<P16> = {
  id: 'g16',
  answer: { kind: 'int' },
  shapes: ['value', 'ratio', 'calls'],
  generate(rng, level, shape) {
    if (shape !== 'value' && shape !== 'ratio' && shape !== 'calls') throw new Error(`g16: unknown shape "${shape}"`);
    return build(rng, level, shape);
  },
  solve: solve16,
  fields: (p): Fields => ({
    k0: p.init.length,
    init: p.init.map((v, i) => ({ n: i + 1, v, vNeg: v < 0, vAbs: Math.abs(v) })),
    rules: p.rules.map((r) => ({
      whenAny: r.when === 'any',
      whenEven: r.when === 'even',
      whenOdd: r.when === 'odd',
      add: r.add,
      addNeg: r.add < 0,
      addAbs: Math.abs(r.add),
      hasAdd: r.add !== 0,
      terms: r.terms.map((t, i) => ({
        a: t.a,
        aNeg: t.a < 0,
        aAbs: Math.abs(t.a),
        b: t.b,
        bNeg: t.b < 0,
        bAbs: Math.abs(t.b),
        bZero: t.b === 0,
        bOne: Math.abs(t.b) === 1,
        lag: t.lag,
        isConst: t.a === 0,
        first: i === 0,
      })),
    })),
    order: Math.max(...p.rules.flatMap((r) => r.terms.map((t) => t.lag))),
    stepLag: p.rules[0].terms[0].lag,
    stepLagOne: p.rules[0].terms[0].lag === 1,
    N: p.N,
    M: p.M,
    diff: p.N - p.M,
    askValue: p.shape === 'value',
    askRatio: p.shape === 'ratio',
    askCalls: p.shape === 'calls',
  }),
};
