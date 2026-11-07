/** Lattice geometry helpers: polygons with integer vertices, Pick's theorem, simplicity test. Pure, no task text. */

export type Pt = { x: number; y: number };
export type Box = { x0: number; y0: number; x1: number; y1: number };

export const gcd = (a: number, b: number): number => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};

export function bbox(poly: readonly Pt[]): Box {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Twice the unsigned area. */
export function area2(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s);
}

/** Lattice points on the boundary of a closed polygon. */
export function boundaryPoints(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += gcd(b.x - a.x, b.y - a.y);
  }
  return s;
}

/** Pick's theorem for a simple polygon: points strictly inside, on the boundary, and in total (closed region). */
export function pick(poly: readonly Pt[]): { inside: number; boundary: number; closed: number; area2: number } {
  const a2 = area2(poly);
  const boundary = boundaryPoints(poly);
  const inside = (a2 - boundary + 2) / 2;
  return { inside, boundary, closed: inside + boundary, area2: a2 };
}

const orient = (a: Pt, b: Pt, c: Pt): number => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
const within = (a: Pt, b: Pt, c: Pt): boolean =>
  Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);

/** Do the closed segments ab and cd share a point? */
export function segmentsMeet(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && within(a, b, c)) || (o2 === 0 && within(a, b, d)) || (o3 === 0 && within(c, d, a)) || (o4 === 0 && within(c, d, b));
}

/** Simple closed polygon: at least 3 vertices, no zero-length edge, edges meet only at shared consecutive vertices. */
export function isSimple(poly: readonly Pt[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (a.x === b.x && a.y === b.y) return false;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const c = poly[j];
      const d = poly[(j + 1) % n];
      if (j === i + 1) {
        // neighbours: only the common vertex b may be shared (reject folding back)
        if (orient(a, b, d) === 0 && within(a, b, d)) return false;
        if (orient(c, d, a) === 0 && within(c, d, a)) return false;
      } else if (i === 0 && j === n - 1) {
        if (orient(c, d, b) === 0 && within(c, d, b)) return false;
        if (orient(a, b, c) === 0 && within(a, b, c)) return false;
      } else if (segmentsMeet(a, b, c, d)) return false;
    }
  }
  return true;
}

export const boxesApart = (p: Box, q: Box): boolean => p.x1 < q.x0 || q.x1 < p.x0 || p.y1 < q.y0 || q.y1 < p.y0;
