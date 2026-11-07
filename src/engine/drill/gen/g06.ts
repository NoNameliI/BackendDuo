/**
 * g06: a drawing executor on the integer plane. Answer: int. Shapes: `region`, `common`.
 *
 * The executor starts at (0,0) facing +y with the pen down; commands: forward n, right a, left a (a multiple of 90),
 * pen up, pen down, repeat k [ ... ]. Every pen-down run must come back to its start: it is one closed polygon.
 *
 * region: count the lattice points inside or on the border of the drawn figures (ask `closed`) or strictly inside
 *   them (ask `strict`). Figures have disjoint bounding boxes, so Pick's theorem is applied per figure and summed.
 *   base: one rectangle written as a repeat, sides 3..12, ask closed.
 *   core: two figures (rectangle, L-shape), sides 4..25, either ask.
 *   hard: three figures (rectangle, L, U-notch, staircase), sides up to 40, pen-up jumps, either ask.
 * common: two overlapping rectangles; count the lattice points that belong to both (closed) or lie strictly inside
 *   both (strict). Solved by intersecting the two boxes.
 *   base: sides 4..14. core: 5..30. hard: 8..60 with both asks.
 *
 * Reject: a run that is not closed or not simple; boxes that meet (region); rectangles that nest or touch (common);
 * answer below 4 or above 4000 (region) / above 4000 (common).
 */
import { Reject, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';
import { bbox, boxesApart, isSimple, pick, type Pt } from './shared/grid';

export type Cmd =
  | { op: 'fwd'; n: number }
  | { op: 'right'; a: number }
  | { op: 'left'; a: number }
  | { op: 'up' }
  | { op: 'down' }
  | { op: 'repeat'; k: number; body: Cmd[] };
export type P06 = { shape: 'region' | 'common'; program: Cmd[]; ask: 'closed' | 'strict' };

const DX = [0, 1, 0, -1];
const DY = [1, 0, -1, 0];
const MAX_COUNT = 4000;

// ---------------------------------------------------------------- execution

/** Closed figures drawn by the program (pen-down runs). */
function figuresOf(program: readonly Cmd[]): Pt[][] {
  let x = 0;
  let y = 0;
  let h = 0;
  let down = true;
  let cur: Pt[] | null = [{ x: 0, y: 0 }];
  const figs: Pt[][] = [];
  let budget = 4000;
  const exec = (cs: readonly Cmd[]) => {
    for (const c of cs) {
      if (--budget < 0) throw new Reject('program too long');
      if (c.op === 'fwd') {
        x += DX[h] * c.n;
        y += DY[h] * c.n;
        if (down) cur!.push({ x, y });
      } else if (c.op === 'right' || c.op === 'left') {
        if (c.a % 90 !== 0) throw new Reject('angle');
        const q = (c.a / 90) % 4;
        h = c.op === 'right' ? (h + q) % 4 : (h - q + 4) % 4;
      } else if (c.op === 'up') {
        if (down) {
          figs.push(cur!);
          cur = null;
          down = false;
        }
      } else if (c.op === 'down') {
        if (!down) {
          down = true;
          cur = [{ x, y }];
        }
      } else for (let i = 0; i < c.k; i++) exec(c.body);
    }
  };
  exec(program);
  if (down && cur) figs.push(cur);
  return figs.map((f) => {
    const last = f[f.length - 1];
    if (f.length < 4 || last.x !== f[0].x || last.y !== f[0].y) throw new Reject('run is not closed');
    const poly = f.slice(0, -1).filter((p, i, a) => i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
    if (!isSimple(poly)) throw new Reject('not simple');
    return poly;
  });
}

function solveP(p: P06): Solved {
  const figs = figuresOf(p.program);
  if (p.shape === 'region') {
    if (figs.length < 1) throw new Reject('no figure');
    const boxes = figs.map(bbox);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (!boxesApart(boxes[i], boxes[j])) throw new Reject('figures meet');
    const infos = figs.map((f) => pick(f));
    const total = infos.reduce((s, r) => s + (p.ask === 'closed' ? r.closed : r.inside), 0);
    if (total < 4 || total > MAX_COUNT) throw new Reject('count out of range');
    return {
      answer: String(total),
      steps: {
        figures: figs.map((f, i) => ({
          vertices: f.map((v) => ({ x: v.x, y: v.y })),
          area2: infos[i].area2,
          boundary: infos[i].boundary,
          inside: infos[i].inside,
          closed: infos[i].closed,
        })),
        total,
      },
    };
  }
  if (figs.length !== 2) throw new Reject('need two figures');
  const boxes = figs.map((f) => {
    const b = bbox(f);
    if (f.length !== 4) throw new Reject('not a rectangle');
    return b;
  });
  const [a, b] = boxes;
  const x0 = Math.max(a.x0, b.x0);
  const x1 = Math.min(a.x1, b.x1);
  const y0 = Math.max(a.y0, b.y0);
  const y1 = Math.min(a.y1, b.y1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx < 1 || dy < 1) throw new Reject('no overlap');
  const same = (r: typeof a) => r.x0 === x0 && r.x1 === x1 && r.y0 === y0 && r.y1 === y1;
  if (same(a) || same(b)) throw new Reject('nested');
  const total = p.ask === 'closed' ? (dx + 1) * (dy + 1) : Math.max(0, dx - 1) * Math.max(0, dy - 1);
  if (total < 4 || total > MAX_COUNT) throw new Reject('count out of range');
  return { answer: String(total), steps: { boxes, overlap: { x0, y0, x1, y1, dx, dy }, total } };
}

// ---------------------------------------------------------------- construction

const rot = (p: Pt): Pt => ({ x: -p.y, y: p.x });
const norm = (poly: Pt[]): Pt[] => {
  const b = bbox(poly);
  return poly.map((p) => ({ x: p.x - b.x0, y: p.y - b.y0 }));
};
const shift = (poly: Pt[], dx: number, dy: number): Pt[] => poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
const pts = (...xy: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < xy.length; i += 2) out.push({ x: xy[i], y: xy[i + 1] });
  return out;
};

type Kind = 'rect' | 'L' | 'U' | 'stair';

function shapeOf(rng: Rng, kind: Kind, lo: number, hi: number): Pt[] {
  const side = () => rng.int(lo, hi);
  if (kind === 'rect') {
    const w = side();
    const h = side();
    return pts(0, 0, w, 0, w, h, 0, h);
  }
  if (kind === 'L') {
    const w = Math.max(side(), 3);
    const h = Math.max(side(), 3);
    const cw = rng.int(1, w - 1);
    const ch = rng.int(1, h - 1);
    return pts(0, 0, w, 0, w, ch, cw, ch, cw, h, 0, h);
  }
  if (kind === 'U') {
    const w = Math.max(side(), 5);
    const h = Math.max(side(), 3);
    const nx = rng.int(1, w - 3);
    const nw = rng.int(1, w - nx - 1);
    const nd = rng.int(1, h - 1);
    return pts(0, 0, w, 0, w, h, nx + nw, h, nx + nw, h - nd, nx, h - nd, nx, h, 0, h);
  }
  const s = Math.max(1, Math.round(side() / 3));
  const t = Math.max(1, Math.round(side() / 3));
  return pts(0, 0, 3 * s, 0, 3 * s, t, 2 * s, t, 2 * s, 2 * t, s, 2 * t, s, 3 * t, 0, 3 * t);
}

/** Random rotation / mirror, then a random start vertex and direction. */
function orientAndStart(rng: Rng, poly: Pt[]): Pt[] {
  let q = poly;
  for (let i = rng.int(0, 3); i > 0; i--) q = q.map(rot);
  if (rng.chance(0.5)) q = q.map((p) => ({ x: -p.x, y: p.y }));
  q = norm(q);
  if (rng.chance(0.5)) q = q.slice().reverse();
  const s = rng.int(0, q.length - 1);
  return [...q.slice(s), ...q.slice(0, s)];
}

type Pen = { x: number; y: number; h: number };
const dirOf = (a: Pt, b: Pt): number => (b.x > a.x ? 1 : b.x < a.x ? 3 : b.y > a.y ? 0 : 2);

function turn(out: Cmd[], pen: Pen, d: number): void {
  const diff = (((d - pen.h) % 4) + 4) % 4;
  if (diff === 1) out.push({ op: 'right', a: 90 });
  else if (diff === 2) out.push({ op: 'right', a: 180 });
  else if (diff === 3) out.push({ op: 'left', a: 90 });
  pen.h = d;
}

function jump(out: Cmd[], pen: Pen, to: Pt): void {
  out.push({ op: 'up' });
  if (to.x !== pen.x) {
    turn(out, pen, to.x > pen.x ? 1 : 3);
    out.push({ op: 'fwd', n: Math.abs(to.x - pen.x) });
  }
  if (to.y !== pen.y) {
    turn(out, pen, to.y > pen.y ? 0 : 2);
    out.push({ op: 'fwd', n: Math.abs(to.y - pen.y) });
  }
  out.push({ op: 'down' });
  pen.x = to.x;
  pen.y = to.y;
}

function drawFigure(out: Cmd[], pen: Pen, poly: Pt[]): void {
  const n = poly.length;
  const dirs = poly.map((p, i) => dirOf(p, poly[(i + 1) % n]));
  const len = poly.map((p, i) => Math.abs(poly[(i + 1) % n].x - p.x) + Math.abs(poly[(i + 1) % n].y - p.y));
  turn(out, pen, dirs[0]);
  const t = (dirs[1] - dirs[0] + 4) % 4;
  const uniform = dirs.every((d, i) => (dirs[(i + 1) % n] - d + 4) % 4 === t);
  const corner = (): Cmd => (t === 1 ? { op: 'right', a: 90 } : { op: 'left', a: 90 });
  if (n === 4 && uniform && (t === 1 || t === 3)) {
    if (len[0] === len[1]) out.push({ op: 'repeat', k: 4, body: [{ op: 'fwd', n: len[0] }, corner()] });
    else out.push({ op: 'repeat', k: 2, body: [{ op: 'fwd', n: len[0] }, corner(), { op: 'fwd', n: len[1] }, corner()] });
  } else {
    for (let i = 0; i < n; i++) {
      out.push({ op: 'fwd', n: len[i] });
      pen.h = dirs[i];
      turn(out, pen, dirs[(i + 1) % n]);
    }
  }
  pen.h = dirs[0];
  pen.x = poly[0].x;
  pen.y = poly[0].y;
}

const KINDS: Record<Level, Kind[]> = { base: ['rect'], core: ['rect', 'L'], hard: ['rect', 'L', 'U', 'stair'] };

function buildRegion(rng: Rng, level: Level): P06 {
  const count = level === 'base' ? 1 : level === 'core' ? 2 : 3;
  const [lo, hi] = level === 'base' ? [3, 12] : level === 'core' ? [4, 25] : [4, 40];
  const out: Cmd[] = [];
  const pen: Pen = { x: 0, y: 0, h: 0 };
  let maxX = 0;
  for (let i = 0; i < count; i++) {
    let poly = orientAndStart(rng, shapeOf(rng, rng.pick(KINDS[level]), lo, hi));
    if (i === 0) poly = shift(poly, -poly[0].x, -poly[0].y);
    else {
      const b = bbox(poly);
      poly = shift(poly, maxX + rng.int(1, 4) - b.x0, rng.int(-8, 8) - b.y0);
      jump(out, pen, poly[0]);
    }
    maxX = Math.max(maxX, bbox(poly).x1);
    drawFigure(out, pen, poly);
  }
  return { shape: 'region', program: out, ask: level === 'base' || rng.chance(0.5) ? 'closed' : 'strict' };
}

function buildCommon(rng: Rng, level: Level): P06 {
  const [lo, hi] = level === 'base' ? [4, 14] : level === 'core' ? [5, 30] : [8, 60];
  const rect = (): Pt[] => shapeOf(rng, 'rect', lo, hi);
  const a = rect();
  const w1 = bbox(a).x1;
  const h1 = bbox(a).y1;
  const b = rect();
  const w2 = bbox(b).x1;
  const h2 = bbox(b).y1;
  const bx = rng.int(-w2 + 2, w1 - 2);
  const by = rng.int(-h2 + 2, h1 - 2);
  const pa = orientAndStartKeep(rng, a);
  const pb = orientAndStartKeep(rng, shift(b, bx, by));
  const out: Cmd[] = [];
  const pen: Pen = { x: 0, y: 0, h: 0 };
  const origin = pa[0];
  const A = shift(pa, -origin.x, -origin.y);
  const B = shift(pb, -origin.x, -origin.y);
  drawFigure(out, pen, A);
  jump(out, pen, B[0]);
  drawFigure(out, pen, B);
  return { shape: 'common', program: out, ask: level === 'base' ? 'closed' : rng.chance(0.5) ? 'closed' : 'strict' };
}

/** Random start vertex and direction, geometry unchanged. */
function orientAndStartKeep(rng: Rng, poly: Pt[]): Pt[] {
  const q = rng.chance(0.5) ? poly.slice().reverse() : poly;
  const s = rng.int(0, q.length - 1);
  return [...q.slice(s), ...q.slice(0, s)];
}

// ---------------------------------------------------------------- fields

type Line = { depth: number; op: string; value: number };
const OP_FLAGS: Record<string, string> = { fwd: 'isFwd', right: 'isRight', left: 'isLeft', repeat: 'isRepeat', end: 'isEnd', up: 'isUp', down: 'isDown' };
// Template view of a line: op flags for the ops that exist, the argument and the nesting depth.
function lineView(l: Line): Fields {
  const flags: Record<string, boolean> = {};
  for (const k of Object.values(OP_FLAGS)) flags[k] = false;
  flags.isBack = false;
  if (OP_FLAGS[l.op]) flags[OP_FLAGS[l.op]] = true;
  return { ...l, ...flags, arg: l.value, indent: l.depth };
}
function flatten(cs: readonly Cmd[], depth: number, out: Line[]): void {
  for (const c of cs) {
    if (c.op === 'fwd') out.push({ depth, op: 'fwd', value: c.n });
    else if (c.op === 'right' || c.op === 'left') out.push({ depth, op: c.op, value: c.a });
    else if (c.op === 'up' || c.op === 'down') out.push({ depth, op: c.op, value: 0 });
    else {
      out.push({ depth, op: 'repeat', value: c.k });
      flatten(c.body, depth + 1, out);
      out.push({ depth, op: 'end', value: 0 });
    }
  }
}

function fieldsOf(p: P06): Fields {
  const lines: Line[] = [];
  flatten(p.program, 0, lines);
  return {
    program: p.program as unknown as Fields[],
    lines: lines.map(lineView),
    askClosed: p.ask === 'closed',
    askStrict: p.ask === 'strict',
    shapeRegion: p.shape === 'region',
    shapeCommon: p.shape === 'common',
  };
}

export const g06: Generator<P06> = {
  id: 'g06',
  answer: { kind: 'int' },
  shapes: ['region', 'common'],
  generate(rng, level, shape) {
    if (shape === 'region') return buildRegion(rng, level);
    if (shape === 'common') return buildCommon(rng, level);
    throw new Error(`g06: unknown shape "${shape}"`);
  },
  solve: solveP,
  fields: fieldsOf,
};
