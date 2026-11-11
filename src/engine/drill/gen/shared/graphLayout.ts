/**
 * Picture of a small weighted graph: vertex positions on a jittered lattice, found by restarts and hill climbing
 * (few crossings, hard geometric rules), then label plates placed along the edges. Pure numbers, no DOM: the
 * generator calls it at generation time, so a bad picture is rejected before a learner sees it.
 */
import type { Rng } from '../../types';
import { boxCircleDist, boxGap, boxSegDist, segCross, segDist, type Box, type Pt, type Seg } from './plane';

export interface LayoutEdge {
  a: number;
  b: number;
  text: string;
}
export interface GraphLayout {
  nodes: Pt[];
  /** Label plates by edge index (top-left, size). */
  labels: Box[];
  crossings: number;
  /** No layout satisfied every rule; the least bad one is returned. */
  fallback: boolean;
}

export const NODE_R = 16;

/** Mono 13 px label: estimated width, fixed height. */
export function labelSize(text: string): { w: number; h: number } {
  return { w: 7.8 * text.length + 8, h: 18 };
}

const MIN_NODE_DIST = 72;
const CLEAR = NODE_R + 12;
const CROSS_ANGLE = 25;
const INCIDENT_ANGLE = 20;
const PARALLEL_ANGLE = 10;
const PARALLEL_DIST = 12;
const PARALLEL_OVERLAP = 10;
const THIRD_EDGE = 10;
const JITTER = 14;
const RESTARTS = 24;
const PASSES = 3;
/** One crossing is good enough once this many restarts have run: the search stops. */
const GOOD_AFTER = 8;
const STROKE = 0.75;
const PLATE_PAD = 2;
const PLATE_GAP = 2;
const NODE_GAP = 3;
const OWNER_GAP = 6;
const OWNER_T = [0.2, 0.8] as const;
const CROSS_ZONE = 4;
const OFFSETS = [0, 10, -10, 18, -18];
const TS = [0.5, 0.4, 0.6, 0.3, 0.7];

const segOf = (nodes: readonly Pt[], e: LayoutEdge): Seg => ({ a: nodes[e.a], b: nodes[e.b] });
const inflate = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
const incident = (e: LayoutEdge, f: LayoutEdge): boolean => e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b;

const dist = (a: Pt, b: Pt): number => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));

/** sin of the angle between the lines of two segments (no trigonometry: this runs in the search loop). */
function sinBetween(s: Seg, r: Seg): number {
  const ux = s.b.x - s.a.x;
  const uy = s.b.y - s.a.y;
  const vx = r.b.x - r.a.x;
  const vy = r.b.y - r.a.y;
  return Math.abs(ux * vy - uy * vx) / (Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy) || 1);
}
const SIN_CROSS = Math.sin((CROSS_ANGLE * Math.PI) / 180);
const SIN_INCIDENT = Math.sin((INCIDENT_ANGLE * Math.PI) / 180);
const SIN_PARALLEL = Math.sin((PARALLEL_ANGLE * Math.PI) / 180);

/** Visits every violated geometric rule; returns the number of crossings. */
function scan(nodes: readonly Pt[], edges: readonly LayoutEdge[], bad: (what: string) => void): number {
  const segs = edges.map((e) => segOf(nodes, e));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (dist(nodes[i], nodes[j]) < MIN_NODE_DIST) bad(`nodes ${i},${j} too close`);
    }
  }
  edges.forEach((e, i) => {
    nodes.forEach((p, k) => {
      if (k !== e.a && k !== e.b && segDist(p, segs[i]).d < CLEAR) bad(`edge ${i} near node ${k}`);
    });
  });
  let crossings = 0;
  for (let i = 0; i < edges.length; i++) {
    const s = segs[i];
    for (let j = i + 1; j < edges.length; j++) {
      const r = segs[j];
      const sin = sinBetween(s, r);
      if (incident(edges[i], edges[j])) {
        if (sin < SIN_INCIDENT) bad(`edges ${i},${j} nearly collinear`);
        continue;
      }
      if (sin < SIN_PARALLEL) {
        if (parallelOverlap(s, r)) bad(`edges ${i},${j} run side by side`);
        continue;
      }
      if (Math.max(s.a.x, s.b.x) < Math.min(r.a.x, r.b.x) || Math.max(r.a.x, r.b.x) < Math.min(s.a.x, s.b.x)) continue;
      if (Math.max(s.a.y, s.b.y) < Math.min(r.a.y, r.b.y) || Math.max(r.a.y, r.b.y) < Math.min(s.a.y, s.b.y)) continue;
      const p = segCross(s, r);
      if (!p) continue;
      crossings++;
      if (sin < SIN_CROSS) bad(`edges ${i},${j} cross at a shallow angle`);
      if (nodes.some((q) => dist(q, p) < CLEAR)) bad(`edges ${i},${j} cross at a node`);
      if (segs.some((t, k) => k !== i && k !== j && segDist(p, t).d < THIRD_EDGE)) bad(`edges ${i},${j} meet a third edge`);
    }
  }
  return crossings;
}

function parallelOverlap(s: Seg, r: Seg): boolean {
  const dist = Math.min(segDist(r.a, s).d, segDist(r.b, s).d, segDist(s.a, r).d, segDist(s.b, r).d);
  if (dist >= PARALLEL_DIST) return false;
  const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) || 1;
  const ux = (s.b.x - s.a.x) / len;
  const uy = (s.b.y - s.a.y) / len;
  const proj = (p: Pt) => (p.x - s.a.x) * ux + (p.y - s.a.y) * uy;
  const lo = Math.max(0, Math.min(proj(r.a), proj(r.b)));
  const hi = Math.min(len, Math.max(proj(r.a), proj(r.b)));
  return hi - lo > PARALLEL_OVERLAP;
}

interface Board {
  nodes: readonly Pt[];
  segs: Seg[];
  crossPts: Pt[];
}

function boardOf(nodes: readonly Pt[], edges: readonly LayoutEdge[]): Board {
  const segs = edges.map((e) => segOf(nodes, e));
  const crossPts: Pt[] = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segCross(segs[i], segs[j]);
      if (p) crossPts.push(p);
    }
  }
  return { nodes, segs, crossPts };
}

/** Why the plate cannot stand on edge `i`, or null (placed plates are checked separately). */
function plateFits(box: Box, i: number, bd: Board): string | null {
  const zone = inflate(box, PLATE_PAD);
  for (let k = 0; k < bd.segs.length; k++) {
    const sg = bd.segs[k];
    // Segments whose bounding box misses the plate by a margin cannot touch it.
    if (k === i || Math.max(sg.a.x, sg.b.x) < zone.x - 1 || Math.min(sg.a.x, sg.b.x) > zone.x + zone.w + 1) continue;
    if (Math.max(sg.a.y, sg.b.y) < zone.y - 1 || Math.min(sg.a.y, sg.b.y) > zone.y + zone.h + 1) continue;
    if (boxSegDist(zone, sg) < STROKE) return `label ${i} touches edge ${k}`;
  }
  for (let k = 0; k < bd.nodes.length; k++) {
    if (boxCircleDist(box, bd.nodes[k], NODE_R) < NODE_GAP) return `label ${i} touches node ${k}`;
  }
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const own = segDist(c, bd.segs[i]);
  let other = Infinity;
  bd.segs.forEach((s, k) => {
    if (k !== i) other = Math.min(other, segDist(c, s).d);
  });
  if (other - own.d < OWNER_GAP || own.t < OWNER_T[0] || own.t > OWNER_T[1]) return `label ${i} is not clearly owned`;
  const wide = inflate(box, CROSS_ZONE);
  if (bd.crossPts.some((p) => p.x >= wide.x && p.x <= wide.x + wide.w && p.y >= wide.y && p.y <= wide.y + wide.h)) {
    return `label ${i} covers a crossing`;
  }
  return null;
}

/** Plate candidates along an edge, nearest to its own line and middle first. */
function candidates(seg: Seg, text: string): Box[] {
  const { w, h } = labelSize(text);
  const dx = seg.b.x - seg.a.x;
  const dy = seg.b.y - seg.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const list: { d: number; t: number }[] = [];
  for (const d of OFFSETS) for (const t of TS) list.push({ d, t });
  list.sort((p, q) => Math.abs(p.d) - Math.abs(q.d) || Math.abs(p.t - 0.5) - Math.abs(q.t - 0.5));
  return list.map(({ d, t }) => {
    const cx = Math.round(seg.a.x + t * dx - (d * dy) / len);
    const cy = Math.round(seg.a.y + t * dy + (d * dx) / len);
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  });
}

/** Greedy plates, most constrained edge first; null when some edge has no place. Deterministic. */
export function placeLabels(nodes: readonly Pt[], edges: readonly LayoutEdge[]): Box[] | null {
  const bd = boardOf(nodes, edges);
  const options = edges.map((e, i) => candidates(bd.segs[i], e.text).filter((b) => plateFits(b, i, bd) === null));
  const order = edges.map((_, i) => i).sort((x, y) => options[x].length - options[y].length || x - y);
  const placed: (Box | null)[] = edges.map(() => null);
  for (const i of order) {
    const box = options[i].find((b) => placed.every((q) => !q || boxGap(b, q) >= PLATE_GAP));
    if (!box) return null;
    placed[i] = box;
  }
  return placed as Box[];
}

/** Every broken rule as text; empty = the picture is valid. `labels` null = no plates could be placed. */
export function layoutProblems(nodes: readonly Pt[], edges: readonly LayoutEdge[], labels: readonly Box[] | null): string[] {
  const out: string[] = [];
  scan(nodes, edges, (what) => out.push(what));
  if (!labels) {
    out.push('labels not placed');
    return out;
  }
  const bd = boardOf(nodes, edges);
  labels.forEach((b, i) => {
    const why = plateFits(b, i, bd);
    if (why) out.push(why);
    for (let k = i + 1; k < labels.length; k++) if (boxGap(b, labels[k]) < PLATE_GAP) out.push(`labels ${i},${k} too close`);
  });
  return out;
}

const lattice = (cols: number, rows: number, sx: number, sy: number, scale: number): Pt[] => {
  const out: Pt[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push({ x: Math.round((30 + sx * i) * scale), y: Math.round((30 + sy * j) * scale) });
  return out;
};

interface Found {
  nodes: Pt[];
  crossings: number;
  score: number;
}

/**
 * Cheap score for the climbing loop: the pairwise rules that decide most layouts (node spacing, clearance, shallow
 * angles, crossings) on plain arrays. Every term involves a few vertices, so a move is judged by the terms of the
 * moved vertex only. The full `scan` judges the result of every climb.
 */
function quick(xs: number[], ys: number[], edges: readonly LayoutEdge[]) {
  const n = xs.length;
  const m = edges.length;
  const ax: number[] = [];
  const ay: number[] = [];
  const ex: number[] = [];
  const ey: number[] = [];
  const l2: number[] = [];
  const inc: number[][] = Array.from({ length: n }, () => []);
  edges.forEach((e, i) => {
    inc[e.a].push(i);
    inc[e.b].push(i);
  });
  const refresh = (i: number) => {
    const e = edges[i];
    ax[i] = xs[e.a];
    ay[i] = ys[e.a];
    ex[i] = xs[e.b] - xs[e.a];
    ey[i] = ys[e.b] - ys[e.a];
    l2[i] = ex[i] * ex[i] + ey[i] * ey[i];
  };
  for (let i = 0; i < m; i++) refresh(i);
  const sinI2 = SIN_INCIDENT * SIN_INCIDENT;
  const sinC2 = SIN_CROSS * SIN_CROSS;
  const nodeTerm = (i: number, j: number): number => {
    const dx = xs[i] - xs[j];
    const dy = ys[i] - ys[j];
    return dx * dx + dy * dy < MIN_NODE_DIST * MIN_NODE_DIST ? 1000 : 0;
  };
  const clearTerm = (i: number, k: number): number => {
    const t = Math.min(1, Math.max(0, ((xs[k] - ax[i]) * ex[i] + (ys[k] - ay[i]) * ey[i]) / (l2[i] || 1)));
    const px = ax[i] + t * ex[i] - xs[k];
    const py = ay[i] + t * ey[i] - ys[k];
    return px * px + py * py < CLEAR * CLEAR ? 1000 : 0;
  };
  const longTerm = (i: number): number => {
    const len = Math.sqrt(l2[i]);
    return len > 220 ? (len - 220) / 10 : 0;
  };
  const pairTerm = (i: number, j: number): number => {
    const cr = ex[i] * ey[j] - ey[i] * ex[j];
    const sin2 = (cr * cr) / (l2[i] * l2[j] || 1);
    if (incident(edges[i], edges[j])) return sin2 < sinI2 ? 1000 : 0;
    const d1 = ex[i] * (ay[j] - ay[i]) - ey[i] * (ax[j] - ax[i]);
    const d2 = ex[i] * (ay[j] + ey[j] - ay[i]) - ey[i] * (ax[j] + ex[j] - ax[i]);
    if (d1 * d2 >= 0) return 0;
    const d3 = ex[j] * (ay[i] - ay[j]) - ey[j] * (ax[i] - ax[j]);
    const d4 = ex[j] * (ay[i] + ey[i] - ay[j]) - ey[j] * (ax[i] + ex[i] - ax[j]);
    if (d3 * d4 >= 0) return 0;
    return 100 + (sin2 < sinC2 ? 1000 : 0);
  };
  const full = (): number => {
    let sum = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) sum += nodeTerm(i, j);
    for (let i = 0; i < m; i++) {
      sum += longTerm(i);
      for (let k = 0; k < n; k++) if (k !== edges[i].a && k !== edges[i].b) sum += clearTerm(i, k);
      for (let j = i + 1; j < m; j++) sum += pairTerm(i, j);
    }
    return sum;
  };
  /** Terms that involve vertex v (each counted once); stops early once the sum reaches `limit` (terms are never negative). */
  const partial = (v: number, limit = Infinity): number => {
    let sum = 0;
    for (let j = 0; j < n; j++) if (j !== v) sum += nodeTerm(v, j);
    if (sum >= limit) return sum;
    for (let f = 0; f < m; f++) if (edges[f].a !== v && edges[f].b !== v) sum += clearTerm(f, v);
    if (sum >= limit) return sum;
    for (const e of inc[v]) {
      sum += longTerm(e);
      for (let k = 0; k < n; k++) if (k !== edges[e].a && k !== edges[e].b) sum += clearTerm(e, k);
      if (sum >= limit) return sum;
      for (let f = 0; f < m; f++) {
        if (f === e || (f < e && (edges[f].a === v || edges[f].b === v))) continue;
        sum += pairTerm(e, f);
        if (sum >= limit) return sum;
      }
    }
    return sum;
  };
  const move = (v: number, x: number, y: number) => {
    xs[v] = x;
    ys[v] = y;
    for (const e of inc[v]) refresh(e);
  };
  return { full, partial, move };
}

function climb(n: number, edges: readonly LayoutEdge[], slots: Pt[], rng: Rng): Found {
  const pick = rng.shuffle(Array.from({ length: slots.length }, (_, i) => i)).slice(0, n);
  const xs = pick.map((s) => slots[s].x);
  const ys = pick.map((s) => slots[s].y);
  const used = new Set(pick);
  const q = quick(xs, ys, edges);
  let cur = q.full();
  for (let pass = 0; pass < PASSES && cur > 0; pass++) {
    let moved = false;
    for (let v = 0; v < n; v++) {
      let here = q.partial(v);
      for (let s = 0; s < slots.length; s++) {
        if (used.has(s) || here === 0) continue;
        const ox = xs[v];
        const oy = ys[v];
        q.move(v, slots[s].x, slots[s].y);
        const next = q.partial(v, here);
        if (next < here) {
          cur += next - here;
          here = next;
          moved = true;
          used.delete(pick[v]);
          used.add(s);
          pick[v] = s;
        } else q.move(v, ox, oy);
      }
    }
    if (!moved) break;
  }
  const nodes = xs.map((x, i) => ({ x, y: ys[i] }));
  let viol = 0;
  const crossings = scan(nodes, edges, () => viol++);
  let over = 0;
  for (const e of edges) over += Math.max(0, dist(nodes[e.a], nodes[e.b]) - 220) / 10;
  return { nodes, crossings, score: 1000 * viol + 100 * crossings + over };
}

/** Vertex positions and label plates; the rng is a stream of its own, so data never depends on the picture. */
export function layoutGraph(n: number, edges: readonly LayoutEdge[], rng: Rng): GraphLayout {
  let best: { f: Found; labels: Box[] } | null = null;
  let least: Found | null = null;
  const phases = [
    { tag: 'r', cols: 6, rows: 4, scale: 1 },
    { tag: 'q', cols: 7, rows: 5, scale: 1.3 },
  ];
  for (const ph of phases) {
    for (let r = 0; r < RESTARTS; r++) {
      if (best && r >= GOOD_AFTER && best.f.crossings <= 1) break;
      const sub = rng.fork(ph.tag + r);
      const slots = lattice(ph.cols, ph.rows, 72, 80, ph.scale).map((p) => ({ x: p.x + sub.int(-JITTER, JITTER), y: p.y + sub.int(-JITTER, JITTER) }));
      const f = climb(n, edges, slots, sub);
      if (!least || f.score < least.score) least = f;
      if (f.score >= 1000 || (best && f.score >= best.f.score)) continue;
      const labels = placeLabels(f.nodes, edges);
      if (!labels) continue;
      if (!best || f.score < best.f.score) best = { f, labels };
      if (f.crossings === 0) return { nodes: f.nodes, labels, crossings: 0, fallback: false };
    }
    if (best) break;
  }
  if (best) return { nodes: best.f.nodes, labels: best.labels, crossings: best.f.crossings, fallback: false };
  const f = least as Found;
  const labels =
    placeLabels(f.nodes, edges) ??
    edges.map((e) => {
      const { w, h } = labelSize(e.text);
      return { x: (f.nodes[e.a].x + f.nodes[e.b].x) / 2 - w / 2, y: (f.nodes[e.a].y + f.nodes[e.b].y) / 2 - h / 2, w, h };
    });
  return { nodes: f.nodes, labels, crossings: f.crossings, fallback: true };
}
