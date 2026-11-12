import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '../../engine/drill/rng';
import type { Box, Pt, Seg } from '../../engine/drill/gen/shared/plane';
import { labelSize } from '../../engine/drill/gen/shared/graphLayout';
import { contrastRatio, parseCssColor } from '../../audit/contrast';
import { labelOnCrossing, labelOwned } from '../../audit/rules';
import { nearestEdge, placePlates, placeWithShortening, plateProblems, shortenKey } from './labels';

const KEYS = ['order.created', 'order.*', '#', 'eu.#.paid', 'x-match=all', 'invoice', 'a', 'payments.refund.failed'];

/** Four columns like the scheme: producer, exchange, queue, consumer. */
function randomLayout(seed: number) {
  const rng = createRng(hashSeed('labels', seed));
  const counts = [rng.int(1, 3), rng.int(1, 3), rng.int(2, 5), rng.int(1, 3)];
  const nodes: Pt[] = [];
  const cols: number[][] = counts.map(() => []);
  counts.forEach((n, c) => {
    for (let r = 0; r < n; r++) {
      cols[c].push(nodes.length);
      nodes.push({ x: 60 + c * 190 + rng.int(-8, 8), y: 50 + r * 80 + rng.int(-6, 6) });
    }
  });
  const segs: Seg[] = [];
  for (let c = 0; c < 3; c++) {
    for (const a of cols[c]) {
      const b = rng.pick(cols[c + 1]);
      segs.push({ a: nodes[a], b: nodes[b] });
    }
  }
  const texts = segs.map(() => rng.pick(KEYS));
  return { nodes, segs, texts };
}

function expectOwned(segs: readonly Seg[], boxes: readonly Box[], where: string): void {
  boxes.forEach((b, i) => {
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    expect(labelOwned(c, segs[i], segs.filter((_, k) => k !== i)), `${where} plate ${i}`).toBe(true);
    expect(labelOnCrossing(b, segs), `${where} plate ${i} crossing`).toBeNull();
  });
}

describe('placePlates', () => {
  it('[plates-clear] keeps plates apart from each other, edges and nodes on 200 layouts', () => {
    let placed = 0;
    for (let seed = 0; seed < 200; seed++) {
      const { nodes, segs, texts } = randomLayout(seed);
      const res = placeWithShortening(nodes, segs, texts);
      if (!res) continue;
      placed++;
      expect(plateProblems(nodes, segs, res.boxes), `seed ${seed}`).toEqual([]);
      expectOwned(segs, res.boxes, `seed ${seed}`);
      res.boxes.forEach((b, i) => {
        const { w, h } = labelSize(res.texts[i]);
        expect([b.w, b.h]).toEqual([w, h]);
      });
    }
    expect(placed).toBeGreaterThanOrEqual(120);
  });

  it('[plates-extra] stays clear of reserved boxes and is deterministic', () => {
    const { nodes, segs, texts } = randomLayout(3);
    const extra: Box[] = nodes.map((n) => ({ x: n.x - 30, y: n.y + 20, w: 60, h: 18 }));
    const a = placePlates(nodes, segs, texts, extra);
    expect(a).toEqual(placePlates(nodes, segs, texts, extra));
    if (a) expect(plateProblems(nodes, segs, a, extra)).toEqual([]);
  });

  it('[plates-owner] puts a plate nearest to its own edge in an uncrowded picture', () => {
    const nodes: Pt[] = [
      { x: 40, y: 40 },
      { x: 300, y: 40 },
      { x: 40, y: 200 },
      { x: 300, y: 200 },
    ];
    const segs: Seg[] = [
      { a: nodes[0], b: nodes[1] },
      { a: nodes[2], b: nodes[3] },
    ];
    const boxes = placePlates(nodes, segs, ['a.b', 'c.d'])!;
    expect(boxes.map((b) => nearestEdge(b, segs))).toEqual([0, 1]);
  });

  it('returns null when there is no room and shortens keys with an ellipsis', () => {
    const nodes: Pt[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ];
    const segs: Seg[] = [{ a: nodes[0], b: nodes[1] }];
    expect(placePlates(nodes, segs, ['x'.repeat(40)], [{ x: -500, y: -500, w: 1000, h: 1000 }])).toBeNull();
    expect(shortenKey('payments.refund.failed', 10)).toBe('payments.…');
    expect(shortenKey('abc', 10)).toBe('abc');
  });

  it('[plates-dense] places 12+ nodes with long names unambiguously or gives up', () => {
    let placed = 0;
    for (let seed = 0; seed < 40; seed++) {
      const rng = createRng(hashSeed('dense', seed));
      const nodes: Pt[] = [];
      const cols: number[][] = [[], [], [], []];
      [3, 3, 5, 3].forEach((n, c) => {
        for (let r = 0; r < n; r++) {
          cols[c].push(nodes.length);
          nodes.push({ x: 50 + c * 170 + rng.int(-6, 6), y: 40 + r * 60 + rng.int(-5, 5) });
        }
      });
      const segs: Seg[] = [];
      for (let c = 0; c < 3; c++) for (const a of cols[c]) segs.push({ a: nodes[a], b: nodes[rng.pick(cols[c + 1])] });
      const texts = segs.map(() => rng.pick(['payments.refund.failed.retry', 'eu.#.paid.invoice.created', 'order.*', 'x-match=all']));
      const res = placeWithShortening(nodes, segs, texts);
      if (!res) continue;
      placed++;
      expect(plateProblems(nodes, segs, res.boxes), `seed ${seed}`).toEqual([]);
      expectOwned(segs, res.boxes, `seed ${seed}`);
    }
    expect(placed).toBeGreaterThan(0);
  });

  it('[light-contrast] accent text used on narrow columns passes 4.5:1 in light and dark', () => {
    const mix = (nav: string, fg: string, bg: string) => {
      const [a, b, c] = [nav, fg, bg].map((x) => parseCssColor(x)!);
      const m = { r: a.r * 0.7 + b.r * 0.3, g: a.g * 0.7 + b.g * 0.3, b: a.b * 0.7 + b.b * 0.3, a: 1 };
      return contrastRatio(m, c);
    };
    expect(mix('#0a64be', '#19191c', '#eae8e2')).toBeGreaterThanOrEqual(4.5);
    expect(mix('#5cb8ff', '#e8e6e1', '#1a1a1e')).toBeGreaterThanOrEqual(4.5);
  });
});
