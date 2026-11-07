/**
 * g01: match a weighted graph drawing with a table of roads. Answer: int. Shapes: `edge`, `path`.
 *
 * The table lists which numbered points are joined (no weights); the drawing gives lettered vertices and weighted
 * edges, the same graph with hidden labels. Asked about two table points: the weight of the road between them
 * (`edge`) or the length of the shortest route between two unjoined points (`path`).
 * Solve: colour refinement (degrees, then neighbour colours) run on both graphs together; a point whose colour is
 * unique in both graphs is matched to the letter of that colour; the edge weight or a Dijkstra run gives the answer.
 *   base: 5..6 vertices, 6..8 edges, weights 1..9.   core: 7..8 vertices, 9..11 edges, weights 2..20.
 *   hard: 9 vertices, 12..14 edges, weights 2..30.
 *   Reject: the asked points do not have a unique colour; the graphs are not alike; no road for `edge`.
 */
import { createRng, hashSeed } from '../rng';
import { Reject, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';

export interface Edge {
  a: number;
  b: number;
  w: number;
}
export interface P01 {
  shape: 'edge' | 'path';
  n: number;
  /** Table of roads between points 0..n-1. */
  table: boolean[][];
  /** Drawing: edges between letters 0..n-1. */
  edges: Edge[];
  p: number;
  q: number;
}

const LETTERS = 'ABCDEFGHI';

const matrixOf = (n: number, edges: { a: number; b: number }[]): boolean[][] => {
  const m = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  for (const e of edges) m[e.a][e.b] = m[e.b][e.a] = true;
  return m;
};

/** Refined colours of table points (0..n-1) and drawing vertices (n..2n-1) in one shared colour space. */
function colours(table: boolean[][], draw: boolean[][]): number[] {
  const n = table.length;
  const adj: number[][] = Array.from({ length: 2 * n }, () => []);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (table[i][j]) adj[i].push(j);
      if (draw[i][j]) adj[n + i].push(n + j);
    }
  let col = adj.map((l) => l.length);
  for (let round = 0; round < n; round++) {
    const sigs = col.map((c, v) => `${c}:${adj[v].map((u) => col[u]).sort((x, y) => x - y).join(',')}`);
    const ids = new Map<string, number>();
    for (const s of [...new Set(sigs)].sort()) ids.set(s, ids.size);
    col = sigs.map((s) => ids.get(s) as number);
  }
  return col;
}

function dijkstra(n: number, edges: Edge[], from: number, to: number): { dist: number; route: number[] } {
  const dist = Array<number>(n).fill(Infinity);
  const prev = Array<number>(n).fill(-1);
  const done = Array<boolean>(n).fill(false);
  dist[from] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let v = 0; v < n; v++) if (!done[v] && (u < 0 || dist[v] < dist[u])) u = v;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    for (const e of edges) {
      const v = e.a === u ? e.b : e.b === u ? e.a : -1;
      if (v >= 0 && dist[u] + e.w < dist[v]) {
        dist[v] = dist[u] + e.w;
        prev[v] = u;
      }
    }
  }
  if (dist[to] === Infinity) return { dist: Infinity, route: [] };
  const route = [to];
  while (route[0] !== from) route.unshift(prev[route[0]]);
  return { dist: dist[to], route };
}

function analyse(p: P01) {
  const n = p.n;
  const col = colours(p.table, matrixOf(n, p.edges));
  const tableHalf = col.slice(0, n);
  const drawHalf = col.slice(n);
  if (tableHalf.slice().sort().join() !== drawHalf.slice().sort().join()) throw new Reject('graphs differ');
  const letterOf = (pt: number): number => {
    const c = tableHalf[pt];
    if (tableHalf.filter((x) => x === c).length !== 1 || drawHalf.filter((x) => x === c).length !== 1) throw new Reject('ambiguous point');
    return drawHalf.indexOf(c);
  };
  return { letterOf, degrees: p.table.map((r) => r.filter(Boolean).length) };
}

function solve01(p: P01): Solved {
  const { letterOf, degrees } = analyse(p);
  const a = letterOf(p.p);
  const b = letterOf(p.q);
  const mapping = [
    { point: p.p + 1, letter: LETTERS[a], degree: degrees[p.p] },
    { point: p.q + 1, letter: LETTERS[b], degree: degrees[p.q] },
  ];
  const degs = degrees.map((d, i) => ({ point: i + 1, degree: d }));
  if (p.shape === 'edge') {
    const e = p.edges.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    if (!e) throw new Reject('no road');
    return { answer: String(e.w), steps: { mapping, degrees: degs } };
  }
  const { dist, route } = dijkstra(p.n, p.edges, a, b);
  if (!Number.isFinite(dist)) throw new Reject('not connected');
  return { answer: String(dist), steps: { mapping, degrees: degs, route: route.map((v) => LETTERS[v]) } };
}

function build(rng: Rng, level: Level, shape: 'edge' | 'path'): P01 {
  const spec = {
    base: { n: [5, 6], m: [6, 8], w: [1, 9] },
    core: { n: [7, 8], m: [9, 11], w: [2, 20] },
    hard: { n: [9, 9], m: [12, 14], w: [2, 30] },
  }[level];
  for (let attempt = 0; attempt < 40; attempt++) {
    const n = rng.int(spec.n[0], spec.n[1]);
    const m = rng.int(spec.m[0], spec.m[1]);
    const used = new Set<string>();
    const edges: Edge[] = [];
    const add = (a: number, b: number) => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (a === b || used.has(key)) return;
      used.add(key);
      edges.push({ a: Math.min(a, b), b: Math.max(a, b), w: rng.int(spec.w[0], spec.w[1]) });
    };
    for (let v = 1; v < n; v++) add(v, rng.int(0, v - 1));
    while (edges.length < m) add(rng.int(0, n - 1), rng.int(0, n - 1));
    edges.sort((x, y) => x.a - y.a || x.b - y.b);

    const perm = rng.shuffle(Array.from({ length: n }, (_, i) => i));
    const table = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
    for (const e of edges) table[perm[e.a]][perm[e.b]] = table[perm[e.b]][perm[e.a]] = true;
    const draft: P01 = { shape, n, table, edges, p: 0, q: 1 };
    const { letterOf } = analyse(draft);
    const single: number[] = [];
    for (let pt = 0; pt < n; pt++) {
      try {
        letterOf(pt);
        single.push(pt);
      } catch {
        /* ambiguous point */
      }
    }
    const pairs: [number, number][] = [];
    for (const x of single) for (const y of single) if (x !== y && table[x][y] === (shape === 'edge')) pairs.push([x, y]);
    if (pairs.length === 0) continue;
    const [pp, qq] = rng.pick(pairs);
    return { ...draft, p: pp, q: qq };
  }
  throw new Reject('no distinguishable pair');
}

const CX = 200;
const CY = 160;
const RADIUS = 130;

/** The graph as a picture: vertices on a circle, slots shuffled by a stream derived from the params themselves. */
function drawing(p: P01): Fields {
  const rng = createRng(hashSeed('g01.drawing', p.n, ...p.edges.map((e) => `${e.a}-${e.b}-${e.w}`)));
  const slots = rng.shuffle(Array.from({ length: p.n }, (_, i) => i));
  return {
    nodes: Array.from({ length: p.n }, (_, i) => {
      const angle = (2 * Math.PI * slots[i]) / p.n - Math.PI / 2;
      return { label: LETTERS[i], x: Math.round(CX + RADIUS * Math.cos(angle)), y: Math.round(CY + RADIUS * Math.sin(angle)) };
    }),
    edges: p.edges.map((e) => ({ a: LETTERS[e.a], b: LETTERS[e.b], w: e.w })),
  };
}

export const g01: Generator<P01> = {
  id: 'g01',
  answer: { kind: 'int' },
  shapes: ['edge', 'path'],
  generate(rng, level, shape) {
    if (shape !== 'edge' && shape !== 'path') throw new Error(`g01: unknown shape "${shape}"`);
    return build(rng, level, shape);
  },
  solve: solve01,
  fields(p): Fields {
    return {
      n: p.n,
      letters: Array.from({ length: p.n }, (_, i) => LETTERS[i]),
      points: Array.from({ length: p.n }, (_, i) => i + 1),
      rows: p.table.map((row, i) => ({ point: i + 1, cells: row.map((c) => (c ? '+' : '')) })),
      edges: p.edges.map((e) => ({ a: LETTERS[e.a], b: LETTERS[e.b], w: e.w })),
      drawing: drawing(p),
      from: p.p + 1,
      to: p.q + 1,
      askEdge: p.shape === 'edge',
      askPath: p.shape === 'path',
    };
  },
};
