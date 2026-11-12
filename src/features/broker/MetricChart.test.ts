import { describe, expect, it } from 'vitest';
import { niceStep, reduceSeries, valueAxis } from './MetricChart';

describe('MetricChart helpers', () => {
  it('[chart-reduce] keeps spikes and bounds the point count', () => {
    const pts: [number, number][] = Array.from({ length: 6000 }, (_, i) => [i * 100, i === 3001 ? 500 : i % 7]);
    const out = reduceSeries(pts, 300, 0, 600000);
    expect(out.length).toBeLessThanOrEqual(600);
    expect(Math.max(...out.map((p) => p[1]))).toBe(500);
    expect(reduceSeries(pts.slice(0, 5), 300, 0, 1000)).toHaveLength(5);
  });

  it('[chart-axis] picks round steps', () => {
    expect(niceStep(97, 4)).toBe(50);
    expect(niceStep(10, 5)).toBe(2);
  });

  it('[chart-axis] keeps every value tick inside the box, also for all-zero data', () => {
    for (const max of [0, 0.3, 1, 7, 97, 1234]) {
      const a = valueAxis(max);
      expect(a.top).toBeGreaterThanOrEqual(max);
      expect(a.ticks[0]).toBe(0);
      expect(a.ticks.at(-1)).toBeCloseTo(a.top);
      expect(a.ticks.every((v) => v <= a.top * (1 + 1e-9))).toBe(true);
    }
    expect(valueAxis(0)).toMatchObject({ step: 1, top: 1, ticks: [0, 1] });
  });
});
