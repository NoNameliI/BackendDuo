import { describe, expect, it } from 'vitest';
import { draw } from '../../instance';
import { createRng } from '../../rng';
import { LEVELS } from '../../types';
import { drawing, g01, type P01 } from '../g01';
import { layoutGraph, layoutProblems, NODE_R, placeLabels, type LayoutEdge } from './graphLayout';
import { boxCircleDist, boxGap, boxSegDist, segCross, segDist, type Box, type Pt } from './plane';

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

interface Drawn {
  nodes: Pt[];
  edges: LayoutEdge[];
  labels: Box[];
  fallback: boolean;
  ms: number;
}

function drawn(p: P01): Drawn {
  const edges = p.edges.map((e) => ({ a: e.a, b: e.b, text: String(e.w) }));
  const t0 = performance.now();
  const f = drawing(p) as { nodes: { x: number; y: number }[]; edges: { lx: number; ly: number }[] };
  const ms = performance.now() - t0;
  const labels = edges.map((e, i) => {
    const w = 7.8 * e.text.length + 8;
    return { x: f.edges[i].lx - w / 2, y: f.edges[i].ly - 9, w, h: 18 };
  });
  return { nodes: f.nodes, edges, labels, fallback: false, ms };
}

describe('g01 picture invariants', { timeout: 120000 }, () => {
  const times: number[] = [];
  for (const level of LEVELS) {
    for (const shape of g01.shapes) {
      it(`${level}/${shape}: valid layout on ${SEEDS.length} seeds`, () => {
        for (const seed of SEEDS) {
          const r = draw(g01, { seed, level, shape, vocab: {} });
          const d = drawn(r.params);
          times.push(d.ms);
          const ctx = `${level}/${shape}/seed ${seed}`;
          expect(layoutProblems(d.nodes, d.edges, d.labels), ctx).toEqual([]);
          const segs = d.edges.map((e) => ({ a: d.nodes[e.a], b: d.nodes[e.b] }));
          d.labels.forEach((b, i) => {
            segs.forEach((s, k) => {
              if (k !== i) expect(boxSegDist(b, s), `${ctx} plate ${i} vs edge ${k}`).toBeGreaterThan(1.75);
            });
            d.nodes.forEach((c, k) => expect(boxCircleDist(b, c, NODE_R), `${ctx} plate ${i} vs node ${k}`).toBeGreaterThanOrEqual(2));
            d.labels.forEach((o, k) => k > i && expect(boxGap(b, o), `${ctx} plates ${i},${k}`).toBeGreaterThanOrEqual(2));
          });
          // no three edges through one crossing
          for (let i = 0; i < segs.length; i++)
            for (let j = i + 1; j < segs.length; j++) {
              const c = segCross(segs[i], segs[j]);
              if (c) segs.forEach((s, k) => k !== i && k !== j && expect(segDist(c, s).d, `${ctx} concurrent`).toBeGreaterThanOrEqual(4));
            }
        }
      });
    }
  }
  it('is deterministic and fast', () => {
    const p = draw(g01, { seed: 7, level: 'hard', shape: 'path', vocab: {} }).params;
    expect(JSON.stringify(drawing(p))).toBe(JSON.stringify(drawing(p)));
    times.sort((x, y) => x - y);
    expect(times[Math.floor(times.length * 0.95)], 'p95 ms').toBeLessThanOrEqual(40);
    expect(times[times.length - 1], 'max ms').toBeLessThanOrEqual(400);
  });
});

describe('layoutGraph', () => {
  const run = (n: number, pairs: [number, number][]) => {
    const edges = pairs.map(([a, b], i) => ({ a, b, text: String(10 + i) }));
    const lay = layoutGraph(n, edges, createRng(5));
    return { edges, lay };
  };
  it('hexagon with chords and rim', () => {
    const { edges, lay } = run(6, [[0, 1], [2, 4], [5, 3], [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]].filter((_, i) => i !== 3) as [number, number][]);
    expect(lay.fallback).toBe(false);
    expect(layoutProblems(lay.nodes, edges, lay.labels)).toEqual([]);
  });
  it('K4 needs one crossing at most', () => {
    const { edges, lay } = run(4, [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]);
    expect(lay.fallback).toBe(false);
    expect(lay.crossings).toBeLessThanOrEqual(1);
    expect(layoutProblems(lay.nodes, edges, lay.labels)).toEqual([]);
  });
  it('9 nodes, 14 edges', () => {
    const { edges, lay } = run(9, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 0], [0, 4], [1, 5], [2, 6], [3, 7], [8, 4]]);
    expect(lay.fallback).toBe(false);
    expect(layoutProblems(lay.nodes, edges, lay.labels)).toEqual([]);
    expect(placeLabels(lay.nodes, edges)).not.toBeNull();
  });
  it('reports problems for crowded nodes', () => {
    const nodes = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(layoutProblems(nodes, [{ a: 0, b: 1, text: '5' }], null).length).toBeGreaterThan(0);
  });
});
