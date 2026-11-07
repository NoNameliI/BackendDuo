import type { Brute } from '../types';
import type { P06 } from './g06';

type Flat = { t: 'f' | 'r' | 'l' | 'u' | 'd'; v: number };
type Point = [number, number];

/** Direct simulation, then a raster count over every lattice point of the bounding box. */
export const brute: Brute<P06> = (p) => {
  // expand the repeats into a flat list
  const flat: Flat[] = [];
  const stack: { cs: P06['program']; i: number; left: number }[] = [{ cs: p.program, i: 0, left: 1 }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (top.i >= top.cs.length) {
      top.left--;
      top.i = 0;
      if (top.left <= 0) stack.pop();
      continue;
    }
    const c = top.cs[top.i++];
    if (c.op === 'fwd') flat.push({ t: 'f', v: c.n });
    else if (c.op === 'right') flat.push({ t: 'r', v: c.a });
    else if (c.op === 'left') flat.push({ t: 'l', v: c.a });
    else if (c.op === 'up') flat.push({ t: 'u', v: 0 });
    else if (c.op === 'down') flat.push({ t: 'd', v: 0 });
    else if (c.k > 0) stack.push({ cs: c.body, i: 0, left: c.k });
  }

  let x = 0;
  let y = 0;
  let angle = 90; // degrees, counter-clockwise from +x; facing +y
  let down = true;
  let run: Point[] = [[0, 0]];
  const runs: Point[][] = [];
  for (const c of flat) {
    if (c.t === 'f') {
      const rad = (angle * Math.PI) / 180;
      x += c.v * Math.round(Math.cos(rad));
      y += c.v * Math.round(Math.sin(rad));
      if (down) run.push([x, y]);
    } else if (c.t === 'r') angle = (((angle - c.v) % 360) + 360) % 360;
    else if (c.t === 'l') angle = (angle + c.v) % 360;
    else if (c.t === 'u') {
      if (down) runs.push(run);
      down = false;
    } else if (!down) {
      down = true;
      run = [[x, y]];
    }
  }
  if (down) runs.push(run);

  const polys: Point[][] = [];
  for (const r of runs) {
    const first = r[0];
    const last = r[r.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) return [];
    polys.push(r.slice(0, -1));
  }
  if (polys.length === 0) return [];

  const onEdge = (poly: Point[], px: number, py: number): boolean => {
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      if (cross === 0 && px >= Math.min(ax, bx) && px <= Math.max(ax, bx) && py >= Math.min(ay, by) && py <= Math.max(ay, by)) return true;
    }
    return false;
  };
  const insideOpen = (poly: Point[], px: number, py: number): boolean => {
    if (onEdge(poly, px, py)) return false;
    let wn = 0;
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      if (ay <= py && by > py && cross > 0) wn++;
      else if (ay > py && by <= py && cross < 0) wn--;
    }
    return wn !== 0;
  };

  const all = polys.flat();
  const xs = all.map((q) => q[0]);
  const ys = all.map((q) => q[1]);
  let count = 0;
  for (let px = Math.min(...xs); px <= Math.max(...xs); px++) {
    for (let py = Math.min(...ys); py <= Math.max(...ys); py++) {
      const strict = polys.map((q) => insideOpen(q, px, py));
      const closed = polys.map((q, i) => strict[i] || onEdge(q, px, py));
      const flags = p.ask === 'closed' ? closed : strict;
      if (p.shape === 'region' ? flags.some(Boolean) : flags.every(Boolean)) count++;
    }
  }
  return [String(count)];
};
