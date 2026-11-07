/**
 * g13: analysis of an executor's runs. Answer: int (counts may exceed 2^53: decimal strings). Shapes: `count`, `length`.
 *
 * The executor holds one number and has commands that all increase it: add v, multiply by v, square. A program is a
 * sequence of commands; its trajectory is the list of numbers it passes through (start and target included).
 * count: how many programs turn `start` into `target`; core adds a number the trajectory must not contain, hard
 *   also a number it must contain. Solved by memoized recursion on the value (ways from here to the target); a
 *   required number splits the count into a product of two segments.
 *   base: target 12..30, two commands, no restriction.
 *   core: target 40..120, three commands, one forbidden number.
 *   hard: target 80..300, three or four commands (square among them), one required and one forbidden number.
 *   Counts are kept below 10^5 (base), 10^12 (core), 10^19 (hard).
 * length: the shortest or the longest program (number of commands) with the same restrictions; segments add up.
 *   base: three commands, target 20..50. core: forbidden number, target 50..150. hard: required+forbidden, 100..300.
 *
 * Reject: no program; fewer than 5 programs (count) / length below 3; a forbidden number that changes nothing;
 * required or forbidden number equal to start or target or unreachable.
 */
import { Reject, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';
import { memoRec } from './shared/memo';

export type Op = { k: 'add' | 'mul' | 'square'; v: number };
export type P13 = {
  shape: 'count' | 'length';
  start: number;
  target: number;
  ops: Op[];
  through: number | null;
  avoid: number | null;
  ask: 'count' | 'shortest' | 'longest';
};

const step = (o: Op, x: number): number => (o.k === 'add' ? x + o.v : o.k === 'mul' ? x * o.v : x * x);

/** Programs from `from` to `to` that never touch `avoid`. */
function waysBetween(ops: Op[], from: number, to: number, avoid: number | null): bigint {
  const ways = memoRec<number, bigint>((v, self) => {
    if (v === avoid) return 0n;
    if (v === to) return 1n;
    let s = 0n;
    for (const o of ops) {
      const nx = step(o, v);
      if (nx <= to) s += self(nx);
    }
    return s;
  });
  return ways(from);
}

/** Shortest or longest program length between two numbers; -1 when there is none. */
function lengthBetween(ops: Op[], from: number, to: number, avoid: number | null, longest: boolean): number {
  const best = memoRec<number, number>((v, self) => {
    if (v === avoid) return -1;
    if (v === to) return 0;
    let r = -1;
    for (const o of ops) {
      const nx = step(o, v);
      if (nx > to) continue;
      const sub = self(nx);
      if (sub < 0) continue;
      if (r < 0 || (longest ? sub + 1 > r : sub + 1 < r)) r = sub + 1;
    }
    return r;
  });
  return best(from);
}

type Row = { v: number; ways: string; shortest: number; longest: number; forbidden: boolean };

/** Forward table: programs from `from` reaching each v (at most `span` values after `from`), forbidden number zeroed. */
function forwardTable(ops: Op[], from: number, to: number, avoid: number | null, span = 14): Row[] {
  const hi = Math.min(to, from + span - 1);
  const ways = new Map<number, bigint>([[from, 1n]]);
  const lo = new Map<number, number>([[from, 0]]);
  const up = new Map<number, number>([[from, 0]]);
  const rows: Row[] = [];
  for (let v = from; v <= hi; v++) {
    const forbidden = v === avoid;
    const w = forbidden ? 0n : (ways.get(v) ?? 0n);
    if (w > 0n) {
      for (const o of ops) {
        const nx = step(o, v);
        if (nx > hi) continue;
        ways.set(nx, (ways.get(nx) ?? 0n) + w);
        lo.set(nx, Math.min(lo.get(nx) ?? Infinity, lo.get(v)! + 1));
        up.set(nx, Math.max(up.get(nx) ?? -1, up.get(v)! + 1));
      }
    }
    if (w > 0n || forbidden) rows.push({ v, ways: w.toString(), shortest: w > 0n ? lo.get(v)! : 0, longest: w > 0n ? up.get(v)! : 0, forbidden });
  }
  return rows;
}

function solve13(p: P13): Solved {
  const { start, target, ops, through, avoid } = p;
  if (start < 2 || start >= target) throw new Reject('bad start');
  if (avoid !== null && (avoid === start || avoid === target)) throw new Reject('forbidden is an end');
  if (through !== null && (through === avoid || through <= start || through >= target)) throw new Reject('bad required number');
  const mids = through === null ? [target] : [through, target];
  const sum = (f: (a: number, b: number) => bigint): bigint[] => {
    let from = start;
    return mids.map((to) => {
      const r = f(from, to);
      from = to;
      return r;
    });
  };
  if (p.ask === 'count') {
    const parts = sum((a, b) => waysBetween(ops, a, b, avoid));
    const total = parts.reduce((x, y) => x * y, 1n);
    if (total < 5n) throw new Reject('too few programs');
    if (avoid !== null) {
      const free = mids.map((_, i) => waysBetween(ops, i === 0 ? start : through!, mids[i], null)).reduce((x, y) => x * y, 1n);
      if (free === total) throw new Reject('forbidden number changes nothing');
    }
    return { answer: total.toString(), steps: { parts: parts.map(String), total: total.toString(), ...tables(p) } };
  }
  const longest = p.ask === 'longest';
  const parts = mids.map((to, i) => lengthBetween(ops, i === 0 ? start : through!, to, avoid, longest));
  if (parts.some((x) => x < 0)) throw new Reject('no program');
  const total = parts.reduce((x, y) => x + y, 0);
  if (total < 3) throw new Reject('too short');
  return { answer: String(total), steps: { parts, total, ...tables(p) } };
}

function tables(p: P13): Fields {
  const first = forwardTable(p.ops, p.start, p.through ?? p.target, p.avoid);
  const out: Record<string, Fields[string]> = { table: first, tableFrom: p.start };
  if (p.through !== null) {
    out.table2 = forwardTable(p.ops, p.through, p.target, p.avoid);
    out.table2From = p.through;
  }
  out.hasTable2 = p.through !== null;
  return out;
}

function build(rng: Rng, level: Level, shape: 'count' | 'length'): P13 {
  const ops: Op[] = [];
  const a = rng.int(1, level === 'base' ? 2 : 3);
  ops.push({ k: 'add', v: a });
  if (level === 'base') {
    if (shape === 'length' || rng.chance(0.5)) {
      ops.push({ k: 'mul', v: rng.int(2, 3) });
      if (shape === 'length') ops.push({ k: 'add', v: a + rng.int(1, 3) });
    } else ops.push({ k: 'add', v: a + rng.int(1, 2) });
  } else {
    ops.push({ k: 'add', v: a + rng.int(1, 3) });
    ops.push({ k: 'mul', v: rng.int(2, 3) });
    if (level === 'hard' && rng.chance(0.7)) ops.push({ k: 'square', v: 0 });
  }
  const range: Record<Level, [number, number]> =
    shape === 'count' ? { base: [12, 30], core: [40, 120], hard: [80, 300] } : { base: [20, 50], core: [50, 150], hard: [100, 300] };
  const target = rng.int(...range[level]);
  const start = rng.int(2, 4);
  const avoid = level === 'base' ? null : rng.int(start + 2, target - 2);
  let through: number | null = null;
  if (level === 'hard') {
    through = rng.int(start + 3, target - 3);
    if (through === avoid) through = null;
  }
  const ask: P13['ask'] = shape === 'count' ? 'count' : level === 'base' ? 'shortest' : rng.chance(0.5) ? 'shortest' : 'longest';
  return { shape, start, target, ops, through, avoid, ask };
}

export const g13: Generator<P13> = {
  id: 'g13',
  answer: { kind: 'int' },
  shapes: ['count', 'length'],
  generate(rng, level, shape) {
    if (shape !== 'count' && shape !== 'length') throw new Error(`g13: unknown shape "${shape}"`);
    const p = build(rng, level, shape);
    if (level === 'hard' && p.through === null) throw new Reject('hard needs a required number');
    if (p.ask === 'count' && solve13(p).answer.length > (level === 'base' ? 5 : level === 'core' ? 12 : 19)) throw new Reject('count too large');
    return p;
  },
  solve: solve13,
  fields: (p): Fields => ({
    start: p.start,
    target: p.target,
    ops: p.ops.map((o) => ({ kind: o.k, v: o.v, isAdd: o.k === 'add', isMul: o.k === 'mul', isSquare: o.k === 'square' })),
    hasThrough: p.through !== null,
    through: p.through ?? 0,
    hasAvoid: p.avoid !== null,
    avoid: p.avoid ?? 0,
    askCount: p.ask === 'count',
    askShortest: p.ask === 'shortest',
    askLongest: p.ask === 'longest',
  }),
};
