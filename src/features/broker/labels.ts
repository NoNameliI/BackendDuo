/**
 * Label plates for the broker scheme: one plate per edge (binding key), placed beside its edge so that no plate
 * touches another plate, an edge, a node or a reserved box. Geometry comes from the shared plane helpers and the
 * plate size from the graph layout; the search is greedy and deterministic.
 */
import { labelSize, NODE_R } from '../../engine/drill/gen/shared/graphLayout';
import { boxCircleDist, boxGap, boxSegDist, segCross, segDist, type Box, type Pt, type Seg } from '../../engine/drill/gen/shared/plane';

/** Node circles are drawn with this radius (stroke included). */
export const NODE_DRAW_R = NODE_R + 2;
const PLATE_GAP = 2;
const EDGE_GAP = 2;
const NODE_GAP = 3;
const OFFSETS = [12, 16, 20, 26, 32, 40, 50, 62, 76, 92].flatMap((d) => [d, -d]);
const TS = Array.from({ length: 13 }, (_, i) => 0.5 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.05);
/** The audit's ownership rule: own edge nearer than any other by this much, projection inside [T0, T1], no crossing near the plate. */
const OWNER_GAP = 6;
const OWNER_T = [0.2, 0.8] as const;
const CROSS_INFLATE = 4;

/** Plate candidates along an edge, nearest to its middle and its line first. */
function candidates(seg: Seg, text: string): Box[] {
  const { w, h } = labelSize(text);
  const dx = seg.b.x - seg.a.x;
  const dy = seg.b.y - seg.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const list: { d: number; t: number }[] = [];
  for (const d of OFFSETS) for (const t of TS) list.push({ d, t });
  list.sort((p, q) => Math.abs(p.d) - Math.abs(q.d) || Math.abs(p.t - 0.5) - Math.abs(q.t - 0.5) || q.d - p.d);
  return list.map(({ d, t }) => {
    const cx = Math.round(seg.a.x + t * dx - (d * dy) / len);
    const cy = Math.round(seg.a.y + t * dy + (d * dx) / len);
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  });
}

/** The plate is clearly its own edge's: nearest by the margin, beside the middle part, away from crossings. */
function owned(box: Box, own: number, segs: readonly Seg[]): boolean {
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const mine = segDist(c, segs[own]);
  if (mine.t < OWNER_T[0] || mine.t > OWNER_T[1]) return false;
  for (let k = 0; k < segs.length; k++) if (k !== own && segDist(c, segs[k]).d - mine.d < OWNER_GAP) return false;
  const zone = { x: box.x - CROSS_INFLATE, y: box.y - CROSS_INFLATE, w: box.w + 2 * CROSS_INFLATE, h: box.h + 2 * CROSS_INFLATE };
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segCross(segs[i], segs[j]);
      if (p && p.x >= zone.x && p.x <= zone.x + zone.w && p.y >= zone.y && p.y <= zone.y + zone.h) return false;
    }
  }
  return true;
}

function clear(box: Box, nodes: readonly Pt[], segs: readonly Seg[], extra: readonly Box[]): boolean {
  for (const n of nodes) if (boxCircleDist(box, n, NODE_DRAW_R) < NODE_GAP) return false;
  for (const s of segs) if (boxSegDist(box, s) < EDGE_GAP) return false;
  for (const e of extra) if (boxGap(box, e) < PLATE_GAP) return false;
  return true;
}

/**
 * Plates by edge index, most constrained edge first. `extra` are boxes that stay free (node name plates).
 * Null when some edge has no place: the caller shortens the keys (`shortenKey`) and tries again.
 */
export function placePlates(nodes: readonly Pt[], segs: readonly Seg[], texts: readonly string[], extra: readonly Box[] = []): Box[] | null {
  const options = segs.map((s, i) => candidates(s, texts[i]).filter((b) => owned(b, i, segs) && clear(b, nodes, segs, extra)));
  const order = segs.map((_, i) => i).sort((x, y) => options[x].length - options[y].length || x - y);
  const placed: (Box | null)[] = segs.map(() => null);
  for (const i of order) {
    const box = options[i].find((b) => placed.every((q) => !q || boxGap(b, q) >= PLATE_GAP));
    if (!box) return null;
    placed[i] = box;
  }
  return placed as Box[];
}

/** Cuts a key to `max` characters with an ellipsis; the full text belongs in `<title>`. */
export function shortenKey(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

/** Placement with progressively shorter keys; `texts` in the result are what to draw. */
export function placeWithShortening(
  nodes: readonly Pt[],
  segs: readonly Seg[],
  texts: readonly string[],
  extra: readonly Box[] = [],
): { boxes: Box[]; texts: string[] } | null {
  for (const max of [Infinity, 24, 16, 10, 6]) {
    const cut = texts.map((t) => shortenKey(t, max));
    const boxes = placePlates(nodes, segs, cut, extra);
    if (boxes) return { boxes, texts: cut };
  }
  return null;
}

/** Every broken rule as text; empty = valid. Used by tests and the visual audit fixtures. */
export function plateProblems(nodes: readonly Pt[], segs: readonly Seg[], boxes: readonly Box[], extra: readonly Box[] = []): string[] {
  const out: string[] = [];
  boxes.forEach((b, i) => {
    for (let k = 0; k < nodes.length; k++) if (boxCircleDist(b, nodes[k], NODE_DRAW_R) < 0) out.push(`plate ${i} touches node ${k}`);
    segs.forEach((s, k) => {
      if (boxSegDist(b, s) <= 0) out.push(`plate ${i} touches edge ${k}`);
    });
    extra.forEach((e, k) => {
      if (boxGap(b, e) < 0) out.push(`plate ${i} overlaps box ${k}`);
    });
    for (let k = i + 1; k < boxes.length; k++) if (boxGap(b, boxes[k]) < 0) out.push(`plates ${i},${k} overlap`);
  });
  return out;
}

/** Which edge a plate belongs to is clear when its own edge is the nearest one. */
export function nearestEdge(box: Box, segs: readonly Seg[]): number {
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  let best = -1;
  let bd = Infinity;
  segs.forEach((s, i) => {
    const d = segDist(c, s).d;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}
