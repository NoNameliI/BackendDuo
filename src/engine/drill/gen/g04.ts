/**
 * g04: prefix-free (uniquely decodable) binary codes. Answer: int. Shapes: `total`, `longest`.
 *
 * Some letters already have codewords; the remaining letters need codewords so that no word is the start of another.
 *   total:   minimal possible sum of the lengths of the remaining codewords.
 *   longest: minimal possible length of the longest remaining codeword.
 * solve: collect the maximal free nodes of the code tree (their depths). total: split the shallowest free node
 * until there are enough nodes, then take the shallowest ones; longest: smallest L whose capacity
 * sum(2^(L-d)) reaches the number of words.
 *   base: 3 known words in a tree of depth <= 4, 2-3 words to add.
 *   core: 4 known words, depth <= 5, 3-5 words to add; total needs n >= number of free nodes, longest L >= 3.
 *   hard: 5 known words, depth <= 6, 4-7 words to add; total needs at least one split, longest L >= 3.
 *   Reject: no room within 12 bits; answers below 2.
 */
import { Reject, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';

export type P04 = { shape: 'total' | 'longest'; known: { letter: string; code: string }[]; rest: string[] };

const LETTERS = 'ABCDEFGHIJKLMNOP';
const MAX_LEN = 12;

/** Depths of the maximal tree nodes that are neither a codeword nor on the way to one. */
function freeDepths(fixed: readonly string[]): number[] {
  const words = new Set(fixed);
  const prefixes = new Set<string>();
  for (const w of fixed) for (let i = 0; i < w.length; i++) prefixes.add(w.slice(0, i));
  const out: number[] = [];
  const walk = (node: string) => {
    for (const b of '01') {
      const c = node + b;
      if (words.has(c)) continue;
      if (prefixes.has(c)) walk(c);
      else out.push(c.length);
    }
  };
  walk('');
  return out.sort((a, b) => a - b);
}

const groups = (depths: number[]) => {
  const out: { depth: number; count: number }[] = [];
  for (const d of depths) {
    const last = out[out.length - 1];
    if (last && last.depth === d) last.count++;
    else out.push({ depth: d, count: 1 });
  }
  return out;
};

function solve04(p: P04): Solved {
  const n = p.rest.length;
  const free = freeDepths(p.known.map((k) => k.code));
  if (p.shape === 'total') {
    const nodes = free.slice();
    let splits = 0;
    while (nodes.length < n) {
      nodes.sort((a, b) => a - b);
      const d = nodes.shift()!;
      if (d >= MAX_LEN) throw new Reject('no room');
      nodes.push(d + 1, d + 1);
      splits++;
    }
    nodes.sort((a, b) => a - b);
    // Splitting the shallowest chosen node into two children beats keeping the deepest chosen node.
    const chosen = nodes.slice(0, n);
    while (chosen[0] + 2 < chosen[chosen.length - 1]) {
      const d = chosen.shift()!;
      chosen.pop();
      chosen.push(d + 1, d + 1);
      chosen.sort((a, b) => a - b);
      splits++;
    }
    const lengths = chosen;
    const sum = lengths.reduce((s, x) => s + x, 0);
    if (sum < 2) throw new Reject('trivial');
    return { answer: String(sum), steps: { free: groups(free), splits, final: groups(lengths), lengths, sum } };
  }
  for (let L = 1; L <= MAX_LEN; L++) {
    const capacity = free.reduce((s, d) => s + (d <= L ? 2 ** (L - d) : 0), 0);
    if (capacity >= n) {
      if (L < 2) throw new Reject('trivial');
      const smaller = free.reduce((s, d) => s + (d <= L - 1 ? 2 ** (L - 1 - d) : 0), 0);
      return { answer: String(L), steps: { free: groups(free), capacity, smaller, length: L } };
    }
  }
  throw new Reject('no room');
}

function build(rng: Rng, level: Level, shape: 'total' | 'longest'): P04 {
  const cfg = {
    base: { leaves: 5, known: 3, depth: 4, add: [2, 3] },
    core: { leaves: 7, known: 4, depth: 5, add: [3, 5] },
    hard: { leaves: 9, known: 5, depth: 6, add: [4, 7] },
  }[level];
  let leaves = [''];
  while (leaves.length < cfg.leaves) {
    const open = leaves.filter((l) => l.length < cfg.depth);
    const leaf = rng.pick(open);
    leaves = leaves.filter((l) => l !== leaf);
    leaves.push(leaf + '0', leaf + '1');
  }
  const fixed = rng.shuffle(leaves).slice(0, cfg.known);
  const n = rng.int(cfg.add[0], cfg.add[1]);
  const names = LETTERS.slice(0, cfg.known + n).split('');
  const knownIdx = new Set(rng.shuffle(names.map((_, i) => i)).slice(0, cfg.known));
  const codes = rng.shuffle(fixed);
  let ci = 0;
  const known: P04['known'] = [];
  const rest: string[] = [];
  names.forEach((letter, i) => {
    if (knownIdx.has(i)) known.push({ letter, code: codes[ci++] });
    else rest.push(letter);
  });
  const p: P04 = { shape, known, rest };
  const free = freeDepths(known.map((k) => k.code));
  if (level === 'core' && shape === 'total' && n < free.length) throw new Reject('no split needed');
  if (level === 'hard' && shape === 'total' && n <= free.length) throw new Reject('no split needed');
  const s = solve04(p);
  if (level !== 'base' && shape === 'longest' && Number(s.answer) < 3) throw new Reject('shallow');
  return p;
}

export const g04: Generator<P04> = {
  id: 'g04',
  answer: { kind: 'int' },
  shapes: ['total', 'longest'],
  generate(rng, level, shape) {
    if (shape !== 'total' && shape !== 'longest') throw new Error(`g04: unknown shape "${shape}"`);
    return build(rng, level, shape);
  },
  solve: solve04,
  fields(p): Fields {
    return {
      known: p.known,
      rest: p.rest,
      count: p.rest.length,
      askTotal: p.shape === 'total',
      askLongest: p.shape === 'longest',
    };
  },
};
