// Visual rules on plain data (boxes, segments, colours), no DOM: collect.ts fills a Snapshot, evaluate() judges it.
// All thresholds are screen pixels and live here.
import { boxCircleDist, boxGap, boxSegDist, segAngle, segCross, segDist, type Box, type Pt, type Seg } from '@/engine/drill/gen/shared/plane';
import type { RuleId } from './api';
import { contrastRatio, requiredRatio, type Rgba } from './contrast';

export const T = {
  coreShrink: 0.2,
  overlapArea: 1,
  positionedGap: 2,
  lineMargin: 1,
  nodeMargin: 2,
  elementOverlap: 1,
  ownerGap: 6,
  ownerT: [0.2, 0.8] as const,
  crossingInflate: 4,
  throughNode: 3,
  parallelDeg: 8,
  parallelDist: 6,
  parallelOverlap: 10,
  incidentDeg: 12,
  concurrentEdge: 4,
  concurrentNode: 4,
  nodeGap: 4,
  containerTol: 1,
  windowTol: 0.5,
  clipTol: 1,
  minFont: 11,
};

export type Severity = 'critical' | 'minor';

/** What every measured thing carries. */
export interface Item {
  where: string;
  /** Union of its rectangles. */
  box: Box;
  /** Rules switched off by data-audit-allow (space separated). */
  allow: string;
  /** Nearest bordered/backgrounded or clipping ancestor: its padding box and the axes where content may not leave it. */
  container: { box: Box; x: boolean; y: boolean } | null;
  /** Some ancestor clips horizontally, so the window edge is judged on that ancestor instead. */
  clipX: boolean;
}

export interface TextItem extends Item {
  id: number;
  /** Core rectangles (line leading ignored). */
  boxes: Box[];
  kind: 'html' | 'svg';
  positioned: boolean;
  /** Effective font size, px. */
  size: number;
  bold: boolean;
  /** Ids of solids that contain this text. */
  inside: number[];
  area: 'md' | 'data' | 'graph' | 'chrome';
  /** Colour is the dim/faint token. */
  secondary: boolean;
  colors: { fg: Rgba; bg: Rgba } | null;
  /** A token wrapped over several lines: where, or null. */
  wrapped: 'cell' | 'code' | 'text' | null;
  renderError: boolean;
}

export interface Solid extends Item {
  id: number;
}

export interface GEdge {
  i: number;
  seg: Seg;
  stroke: number;
  /** Node indexes of the ends, -1 when none is found. */
  a: number;
  b: number;
}
export interface GNode {
  i: number;
  c: Pt;
  r: number;
}
export interface GLabel {
  /** Edge index. */
  i: number;
  box: Box;
}
export interface Graph {
  where: string;
  allow: string;
  edges: GEdge[];
  nodes: GNode[];
  labels: GLabel[];
}

export interface ElemFlags {
  where: string;
  box: Box;
  allow: string;
  clip?: { scrollW: number; clientW: number; scrollH: number; clientH: number };
  scrollX?: { scrollW: number; clientW: number; minor: boolean };
  empty?: 'statement' | 'graph' | 'table' | 'cell';
}

export interface Snapshot {
  innerWidth: number;
  scrollWidth: number;
  texts: TextItem[];
  solids: Solid[];
  graphs: Graph[];
  elems: ElemFlags[];
}

export interface Hit {
  rule: RuleId;
  severity: Severity;
  where: string;
  detail: string;
  box: [number, number, number, number];
}

// --- primitives -------------------------------------------------------------------------------------------------

export const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Text core box: the rectangle shrunk vertically by 20 % of its height per side. */
export const coreBox = (r: Box): Box => ({ x: r.x, y: r.y + r.h * T.coreShrink, w: r.w, h: r.h * (1 - 2 * T.coreShrink) });

export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export const inflate = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });

export function unionBox(boxes: readonly Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const WRAP_TOKEN = /^[\p{L}\p{N}.,:;+\-−·/_^₀-₉⁰-⁹²³¹]+$/u;
/** A token that must not break across lines (len ≥ 2). */
export const isWrapToken = (t: string): boolean => [...t].length >= 2 && WRAP_TOKEN.test(t);

const ERROR_TEXT = /Ошибка шаблона|\{\{|\bNaN\b|undefined|\[object Object\]/;
export const isRenderError = (text: string): boolean => ERROR_TEXT.test(text);

/** Text over a segment: label box (plate) closer than 1 + stroke/2. */
export const textOverLine = (label: Box, seg: Seg, stroke: number): boolean => boxSegDist(label, seg) < T.lineMargin + stroke / 2;
export const textOverNode = (label: Box, c: Pt, r: number): boolean => boxCircleDist(label, c, r) < T.nodeMargin;

/** Own line must be clearly the nearest one and the label must sit in the middle of it. */
export function labelOwned(centre: Pt, own: Seg, others: readonly Seg[]): boolean {
  const mine = segDist(centre, own);
  const other = others.length === 0 ? Infinity : Math.min(...others.map((s) => segDist(centre, s).d));
  return other - mine.d >= T.ownerGap && mine.t >= T.ownerT[0] && mine.t <= T.ownerT[1];
}

export function labelOnCrossing(label: Box, segs: readonly Seg[]): Pt | null {
  const zone = inflate(label, T.crossingInflate);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segCross(segs[i], segs[j]);
      if (p && p.x >= zone.x && p.x <= zone.x + zone.w && p.y >= zone.y && p.y <= zone.y + zone.h) return p;
    }
  }
  return null;
}

export const edgeThroughNode = (c: Pt, r: number, edge: Seg): boolean => segDist(c, edge).d < r + T.throughNode;

/** Two edges lying on top of each other, or incident edges almost in one direction. */
export function edgesOverlap(s: Seg, r: Seg, incident: boolean): boolean {
  const angle = segAngle(s, r);
  if (incident) return angle < T.incidentDeg;
  if (angle >= T.parallelDeg) return false;
  const dist = Math.min(segDist(r.a, s).d, segDist(r.b, s).d, segDist(s.a, r).d, segDist(s.b, r).d);
  if (dist >= T.parallelDist) return false;
  const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) || 1;
  const ux = (s.b.x - s.a.x) / len;
  const uy = (s.b.y - s.a.y) / len;
  const proj = (p: Pt) => (p.x - s.a.x) * ux + (p.y - s.a.y) * uy;
  const lo = Math.max(0, Math.min(proj(r.a), proj(r.b)));
  const hi = Math.min(len, Math.max(proj(r.a), proj(r.b)));
  return hi - lo > T.parallelOverlap;
}

export const nodesOverlap = (a: GNode, b: GNode): boolean => Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) < a.r + b.r + T.nodeGap;

export const contrastLow = (ratio: number, size: number, bold: boolean): boolean => ratio < requiredRatio(size, bold);

export const outsideContainer = (item: Box, c: { box: Box; x: boolean; y: boolean }): boolean =>
  (c.x && (item.x < c.box.x - T.containerTol || item.x + item.w > c.box.x + c.box.w + T.containerTol)) ||
  (c.y && (item.y < c.box.y - T.containerTol || item.y + item.h > c.box.y + c.box.h + T.containerTol));

export const outsideWindow = (b: Box, width: number): boolean => b.x + b.w > width + T.windowTol || b.x < -T.windowTol;

export const isClipped = (c: { scrollW: number; clientW: number; scrollH: number; clientH: number }): boolean =>
  c.scrollW > c.clientW + T.clipTol || c.scrollH > c.clientH + T.clipTol;

const arr = (b: Box): [number, number, number, number] => [b.x, b.y, b.w, b.h];

// --- evaluation -------------------------------------------------------------------------------------------------

export function evaluate(s: Snapshot): Hit[] {
  const out: Hit[] = [];
  const add = (rule: RuleId, allow: string, where: string, box: Box, detail: string, severity: Severity = 'critical') => {
    if (!allow.split(' ').includes(rule)) out.push({ rule, severity, where, detail, box: arr(box) });
  };

  // text vs text
  for (let i = 0; i < s.texts.length; i++) {
    for (let j = i + 1; j < s.texts.length; j++) {
      const a = s.texts[i];
      const b = s.texts[j];
      const loose = a.kind === 'svg' || b.kind === 'svg' || a.positioned || b.positioned;
      let worst: number | null = null;
      for (const p of a.boxes) {
        for (const q of b.boxes) {
          const v = loose ? boxGap(p, q) : -overlapArea(p, q);
          if (loose ? v < T.positionedGap : -v > T.overlapArea) worst = Math.min(worst ?? Infinity, v);
        }
      }
      if (worst !== null) add('text-overlap', a.allow + ' ' + b.allow, a.where, a.box, `t${a.id} vs t${b.id} ${loose ? 'margin' : 'area'} ${f1(loose ? worst : -worst)}${loose ? 'px' : 'px²'}`);
    }
  }

  for (const t of s.texts) {
    // text vs solid boxes
    for (const so of s.solids) {
      if (t.inside.includes(so.id)) continue;
      for (const c of t.boxes) {
        const w = Math.min(c.x + c.w, so.box.x + so.box.w) - Math.max(c.x, so.box.x);
        const h = Math.min(c.y + c.h, so.box.y + so.box.h) - Math.max(c.y, so.box.y);
        if (w > T.elementOverlap && h > T.elementOverlap) {
          add('text-over-element', t.allow + ' ' + so.allow, t.where, t.box, `t${t.id} in e${so.id} ${f1(w)}x${f1(h)}px`);
          break;
        }
      }
    }
    if (t.container && outsideContainer(t.box, t.container)) add('overflow-container', t.allow, t.where, t.box, `t${t.id} outside by ${f1(overshoot(t.box, t.container.box))}px`);
    if (!t.clipX && outsideWindow(t.box, s.innerWidth)) add('overflow-window', t.allow, t.where, t.box, `t${t.id} x ${f1(t.box.x)}..${f1(t.box.x + t.box.w)} of ${s.innerWidth}`);
    if (t.size < T.minFont) add('font-small', t.allow, t.where, t.box, `t${t.id} ${f1(t.size)}px`);
    if (t.colors) {
      const ratio = contrastRatio(t.colors.fg, t.colors.bg);
      if (contrastLow(ratio, t.size, t.bold)) {
        const minor = t.secondary || t.area === 'chrome';
        add('contrast', t.allow, t.where, t.box, `t${t.id} ratio ${f1(ratio)} need ${requiredRatio(t.size, t.bold)}`, minor ? 'minor' : 'critical');
      }
    }
    if (t.wrapped) add('bad-wrap', t.allow, t.where, t.box, `t${t.id} token wraps`, t.wrapped === 'text' ? 'minor' : 'critical');
    if (t.renderError) add('render-error', t.allow, t.where, t.box, `t${t.id}`);
  }

  for (const so of s.solids) {
    if (so.container && outsideContainer(so.box, so.container)) add('overflow-container', so.allow, so.where, so.box, `e${so.id} outside by ${f1(overshoot(so.box, so.container.box))}px`);
    if (!so.clipX && outsideWindow(so.box, s.innerWidth)) add('overflow-window', so.allow, so.where, so.box, `e${so.id} x ${f1(so.box.x)}..${f1(so.box.x + so.box.w)} of ${s.innerWidth}`);
  }

  for (const g of s.graphs) graphRules(g, add);

  for (const e of s.elems) {
    if (e.clip && isClipped(e.clip)) add('clipped-text', e.allow, e.where, e.box, `scroll ${e.clip.scrollW}x${e.clip.scrollH} client ${e.clip.clientW}x${e.clip.clientH}`);
    if (e.scrollX && e.scrollX.scrollW > e.scrollX.clientW + T.clipTol) {
      add('scroll-x-element', e.allow, e.where, e.box, `scroll ${e.scrollX.scrollW} client ${e.scrollX.clientW}`, e.scrollX.minor ? 'minor' : 'critical');
    }
    if (e.empty) add('empty-data', e.allow, e.where, e.box, e.empty);
  }

  if (s.scrollWidth > s.innerWidth) out.push({ rule: 'scroll-x-page', severity: 'critical', where: 'html', detail: `scroll ${s.scrollWidth} window ${s.innerWidth}`, box: [0, 0, s.scrollWidth, 0] });
  return out;
}

function overshoot(b: Box, c: Box): number {
  return Math.max(c.x - b.x, b.x + b.w - (c.x + c.w), c.y - b.y, b.y + b.h - (c.y + c.h));
}

type Add = (rule: RuleId, allow: string, where: string, box: Box, detail: string, severity?: Severity) => void;

function graphRules(g: Graph, add: Add): void {
  const { edges, nodes, labels, where, allow } = g;
  const segs = edges.map((e) => e.seg);

  for (const l of labels) {
    const own = edges.find((e) => e.i === l.i);
    if (!own) continue;
    const foreign = edges.filter((e) => e.i !== l.i);
    for (const e of foreign) {
      if (textOverLine(l.box, e.seg, e.stroke)) add('text-over-line', allow, where, l.box, `label ${l.i} vs edge ${e.i} dist ${f1(boxSegDist(l.box, e.seg))}px`);
    }
    for (const n of nodes) {
      if (n.i === own.a || n.i === own.b) continue;
      if (textOverNode(l.box, n.c, n.r)) add('text-over-node', allow, where, l.box, `label ${l.i} vs node ${n.i} dist ${f1(boxCircleDist(l.box, n.c, n.r))}px`);
    }
    const centre = { x: l.box.x + l.box.w / 2, y: l.box.y + l.box.h / 2 };
    if (!labelOwned(centre, own.seg, foreign.map((e) => e.seg))) {
      const mine = segDist(centre, own.seg);
      const other = foreign.length === 0 ? Infinity : Math.min(...foreign.map((e) => segDist(centre, e.seg).d));
      add('label-ownership', allow, where, l.box, `label ${l.i} own ${f1(mine.d)} other ${f1(other)} t ${f1(mine.t)}`);
    }
    const hit = labelOnCrossing(l.box, segs);
    if (hit) add('label-on-crossing', allow, where, l.box, `label ${l.i} crossing at ${f1(hit.x)},${f1(hit.y)}`);
  }

  for (const e of edges) {
    for (const n of nodes) {
      if (n.i === e.a || n.i === e.b) continue;
      if (edgeThroughNode(n.c, n.r, e.seg)) add('edge-through-node', allow, where, nodeBox(n), `edge ${e.i} vs node ${n.i} dist ${f1(segDist(n.c, e.seg).d)}px`);
    }
  }

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const s = edges[i];
      const r = edges[j];
      const incident = [s.a, s.b].some((x) => x >= 0 && (x === r.a || x === r.b));
      if (edgesOverlap(s.seg, r.seg, incident)) add('edges-overlap', allow, where, segBox(s.seg), `edge ${s.i} vs ${r.i} angle ${f1(segAngle(s.seg, r.seg))}`);
      const p = segCross(s.seg, r.seg);
      if (!p) continue;
      const third = edges.find((e, k) => k !== i && k !== j && segDist(p, e.seg).d < T.concurrentEdge);
      const near = nodes.find((n) => Math.hypot(n.c.x - p.x, n.c.y - p.y) < n.r + T.concurrentNode);
      if (third || near) {
        add('edges-concurrent', allow, where, { x: p.x - 4, y: p.y - 4, w: 8, h: 8 }, third ? `edges ${s.i},${r.i},${third.i} meet at ${f1(p.x)},${f1(p.y)}` : `edges ${s.i},${r.i} cross at node ${near!.i}`);
      }
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodesOverlap(nodes[i], nodes[j])) add('node-overlap', allow, where, nodeBox(nodes[i]), `nodes ${nodes[i].i},${nodes[j].i} dist ${f1(Math.hypot(nodes[i].c.x - nodes[j].c.x, nodes[i].c.y - nodes[j].c.y))}px`);
    }
  }
}

const nodeBox = (n: GNode): Box => ({ x: n.c.x - n.r, y: n.c.y - n.r, w: 2 * n.r, h: 2 * n.r });
const segBox = (s: Seg): Box => ({ x: Math.min(s.a.x, s.b.x), y: Math.min(s.a.y, s.b.y), w: Math.abs(s.a.x - s.b.x), h: Math.abs(s.a.y - s.b.y) });

/** Dedupe key of a defect: number × rule × path without :nth-*. */
export const dedupeKey = (n: number, rule: RuleId, where: string): string => `${n}|${rule}|${where.replace(/:nth-[a-z-]+\([^)]*\)/g, '')}`;
