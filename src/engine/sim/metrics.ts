import type { Metrics, Ms, Series } from './types';

export const MAX_POINTS = 6000;

interface Track {
  id: string;
  points: [Ms, number][];
  stride: number;
  count: number;
  at: Ms;
  max: number;
}

export interface MetricsWriter extends Metrics {
  record(at: Ms, values: Record<string, number>): void;
}

/**
 * Series are capped at MAX_POINTS: on overflow neighbouring points merge pairwise into their maximum
 * and the sampling stride doubles, so spikes survive thinning.
 */
export function createMetrics(): MetricsWriter {
  const tracks = new Map<string, Track>();
  const push = (t: Track, at: Ms, v: number): void => {
    if (t.count === 0) {
      t.at = at;
      t.max = v;
    } else if (v > t.max) t.max = v;
    t.count++;
    if (t.count < t.stride) return;
    t.points.push([t.at, t.max]);
    t.count = 0;
    if (t.points.length >= MAX_POINTS) {
      const merged: [Ms, number][] = [];
      for (let i = 0; i < t.points.length; i += 2) {
        const a = t.points[i];
        const b = t.points[i + 1];
        merged.push(b ? [a[0], Math.max(a[1], b[1])] : a);
      }
      t.points = merged;
      t.stride *= 2;
    }
  };
  return {
    series: (): Series[] => [...tracks.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((t) => ({ id: t.id, points: t.points })),
    get: (id) => {
      const t = tracks.get(id);
      return t ? { id, points: t.points } : undefined;
    },
    record(at, values) {
      for (const id of Object.keys(values).sort()) {
        let t = tracks.get(id);
        if (!t) tracks.set(id, (t = { id, points: [], stride: 1, count: 0, at: 0, max: 0 }));
        push(t, at, values[id]);
      }
    },
  };
}

/** Events per second over a sliding window (default 1 s). */
export function createRateMeter(windowMs: Ms = 1000): { mark(at: Ms, n?: number): void; perSecond(at: Ms): number } {
  const marks: [Ms, number][] = [];
  return {
    mark: (at, n = 1) => void marks.push([at, n]),
    perSecond(at) {
      while (marks.length && marks[0][0] <= at - windowMs) marks.shift();
      let sum = 0;
      for (const m of marks) if (m[0] <= at) sum += m[1];
      return (sum * 1000) / windowMs;
    },
  };
}

/** Nearest-rank percentile, p in (0, 1]. 0 for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}
