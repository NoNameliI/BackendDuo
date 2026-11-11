import { describe, expect, it } from 'vitest';
import { boxCircleDist, boxGap, boxSegDist, segAngle, segCross, segDist } from './plane';

const seg = (x1: number, y1: number, x2: number, y2: number) => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });

describe('plane', () => {
  it('segDist projects and clamps', () => {
    expect(segDist({ x: 5, y: 3 }, seg(0, 0, 10, 0))).toEqual({ d: 3, t: 0.5 });
    expect(segDist({ x: -4, y: 3 }, seg(0, 0, 10, 0))).toEqual({ d: 5, t: 0 });
    expect(segDist({ x: 14, y: 3 }, seg(0, 0, 10, 0))).toEqual({ d: 5, t: 1 });
    expect(segDist({ x: 3, y: 4 }, seg(0, 0, 0, 0)).d).toBe(5);
  });

  it('segCross finds proper crossings only', () => {
    expect(segCross(seg(0, 0, 10, 10), seg(0, 10, 10, 0))).toEqual({ x: 5, y: 5 });
    expect(segCross(seg(0, 0, 10, 0), seg(0, 5, 10, 5))).toBeNull(); // parallel
    expect(segCross(seg(0, 0, 10, 10), seg(0, 0, 10, 0))).toBeNull(); // shared endpoint
    expect(segCross(seg(0, 0, 10, 0), seg(5, 0, 5, 8))).toBeNull(); // T junction
    expect(segCross(seg(0, 0, 4, 4), seg(0, 10, 10, 0))).toBeNull(); // would meet beyond the end
  });

  it('segAngle is 0..90 and ignores orientation', () => {
    expect(segAngle(seg(0, 0, 10, 0), seg(0, 0, 0, 10))).toBeCloseTo(90);
    expect(segAngle(seg(0, 0, 10, 0), seg(10, 0, 0, 0))).toBeCloseTo(0);
    expect(segAngle(seg(0, 0, 10, 0), seg(0, 0, 10, 10))).toBeCloseTo(45);
    expect(segAngle(seg(0, 0, 10, 0), seg(0, 0, -10, 10))).toBeCloseTo(45);
  });

  it('boxGap is negative for overlap and zero when touching', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(boxGap(a, { x: 15, y: 0, w: 5, h: 5 })).toBe(5);
    expect(boxGap(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(0);
    expect(boxGap(a, { x: 8, y: 2, w: 5, h: 5 })).toBe(-2);
    expect(boxGap(a, { x: 13, y: 14, w: 5, h: 5 })).toBe(5);
  });

  it('boxSegDist is 0 for touching, crossing and contained segments', () => {
    const b = { x: 0, y: 0, w: 10, h: 10 };
    expect(boxSegDist(b, seg(-5, 5, 15, 5))).toBe(0);
    expect(boxSegDist(b, seg(2, 2, 4, 4))).toBe(0);
    expect(boxSegDist(b, seg(10, 12, 20, 12))).toBe(2);
    expect(boxSegDist(b, seg(13, 14, 20, 20))).toBe(5);
  });

  it('boxCircleDist measures to the circle edge', () => {
    const b = { x: 0, y: 0, w: 10, h: 10 };
    expect(boxCircleDist(b, { x: 20, y: 5 }, 4)).toBe(6);
    expect(boxCircleDist(b, { x: 13, y: 14 }, 2)).toBe(3);
    expect(boxCircleDist(b, { x: 12, y: 5 }, 4)).toBe(-2);
    expect(boxCircleDist(b, { x: 5, y: 5 }, 3)).toBe(-3);
  });
});
