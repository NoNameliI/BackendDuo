/** Plane geometry on plain numbers: points, segments, boxes. Shared by the graph layout and the visual audit rules. */
export interface Pt {
  x: number;
  y: number;
}
export interface Seg {
  a: Pt;
  b: Pt;
}
/** Top-left corner and size, in pixels or user units. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EPS = 1e-9;

/** Distance from `p` to the segment and the clamped projection parameter t in [0, 1]. */
export function segDist(p: Pt, s: Seg): { d: number; t: number } {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 < EPS ? 0 : Math.min(1, Math.max(0, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2));
  return { d: Math.sqrt((p.x - (s.a.x + t * dx)) ** 2 + (p.y - (s.a.y + t * dy)) ** 2), t };
}

/** Proper crossing point of two segments; touching at an endpoint (shared or not) is not a crossing. */
export function segCross(s: Seg, r: Seg): Pt | null {
  const dx1 = s.b.x - s.a.x;
  const dy1 = s.b.y - s.a.y;
  const dx2 = r.b.x - r.a.x;
  const dy2 = r.b.y - r.a.y;
  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < EPS) return null;
  const u = ((r.a.x - s.a.x) * dy2 - (r.a.y - s.a.y) * dx2) / den;
  const v = ((r.a.x - s.a.x) * dy1 - (r.a.y - s.a.y) * dx1) / den;
  if (u <= EPS || u >= 1 - EPS || v <= EPS || v >= 1 - EPS) return null;
  return { x: s.a.x + u * dx1, y: s.a.y + u * dy1 };
}

/** Angle between the directions of two segments in degrees, 0..90 (a line has no orientation). */
export function segAngle(s: Seg, r: Seg): number {
  const a1 = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
  const a2 = Math.atan2(r.b.y - r.a.y, r.b.x - r.a.x);
  let d = Math.abs(a1 - a2) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return (d * 180) / Math.PI;
}

/** Gap between two boxes; negative = overlap (the smaller penetration depth). */
export function boxGap(a: Box, b: Box): number {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (dx <= 0 && dy <= 0) return Math.max(dx, dy);
  if (dx > 0 && dy > 0) return Math.hypot(dx, dy);
  return Math.max(dx, dy);
}

const inside = (b: Box, p: Pt): boolean => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/** Distance from a box to a segment; 0 when they touch or the segment lies inside. */
export function boxSegDist(b: Box, s: Seg): number {
  if (inside(b, s.a) || inside(b, s.b)) return 0;
  const c: Pt[] = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const side: Seg = { a: c[i], b: c[(i + 1) % 4] };
    if (segCross(s, side)) return 0;
    best = Math.min(best, segDist(c[i], s).d, segDist(s.a, side).d, segDist(s.b, side).d);
  }
  return best;
}

/** Distance from a box to a circle; negative = overlap. */
export function boxCircleDist(b: Box, c: Pt, r: number): number {
  const dx = Math.max(b.x - c.x, 0, c.x - (b.x + b.w));
  const dy = Math.max(b.y - c.y, 0, c.y - (b.y + b.h));
  return Math.hypot(dx, dy) - r;
}
