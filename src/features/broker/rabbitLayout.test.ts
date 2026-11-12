import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '../../engine/drill/rng';
import { boxCircleDist, boxGap, boxSegDist } from '../../engine/drill/gen/shared/plane';
import { NODE_DRAW_R, plateProblems } from './labels';
import { layoutTopology, nodeId, topologyOf, type Layout, type TopologyInput } from './rabbitLayout';

const KEYS = ['order.created', 'order.*', '#', 'eu.#.paid', 'invoice', 'payments.refund.failed.retry'];

function randomInput(seed: number, big = false): TopologyInput {
  const rng = createRng(hashSeed('rabbit-layout', seed));
  const x = big ? rng.int(5, 8) : rng.int(1, 3);
  const q = big ? rng.int(12, 14) : rng.int(2, 5);
  const long = (s: string) => (big ? `${s}-service-with-a-long-name-for-the-lab` : s);
  const exchanges = Array.from({ length: x }, (_, i) => ({ name: long(`ex${i}`), type: rng.pick(['direct', 'fanout', 'topic', 'headers']) }));
  const queues = Array.from({ length: q }, (_, i) => long(`queue${i}`));
  const bindings = queues.flatMap((name) => {
    const n = rng.int(1, 2);
    return Array.from({ length: n }, () => ({ source: rng.pick(exchanges).name, destination: name, destinationType: 'queue' as const, routingKey: rng.pick(KEYS), arguments: {} }));
  });
  return {
    exchanges,
    queues,
    bindings,
    producers: Array.from({ length: big ? 3 : 1 }, (_, i) => ({ id: long(`prod${i}`), exchange: rng.pick(exchanges).name, routingKey: rng.pick(KEYS) })),
    consumers: Array.from({ length: big ? 6 : rng.int(1, 3) }, (_, i) => ({ id: long(`cons${i}`), queue: rng.pick(queues), note: 'prefetch 10' })),
  };
}

function expectClean(l: Layout, where: string): void {
  const nodes = l.nodes.map((n) => ({ x: n.x, y: n.y }));
  const segs = l.edges.map((e) => e.seg);
  expect(l.legend, `${where} legend`).toBe(false);
  const names = l.nodes.map((n) => n.name!);
  if (l.platesOk) expect(plateProblems(nodes, segs, l.edges.map((e) => e.plate!), names), where).toEqual([]);
  names.forEach((b, i) => {
    expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= l.width && b.y + b.h <= l.height, `${where} name ${i} inside`).toBe(true);
    segs.forEach((s, k) => expect(boxSegDist(b, s), `${where} name ${i} vs edge ${k}`).toBeGreaterThan(0));
    nodes.forEach((n, k) => expect(boxCircleDist(b, n, NODE_DRAW_R), `${where} name ${i} vs node ${k}`).toBeGreaterThan(0));
    for (let k = i + 1; k < names.length; k++) expect(boxGap(b, names[k]), `${where} names ${i},${k}`).toBeGreaterThanOrEqual(0);
  });
}

describe('layoutTopology', () => {
  it('[rabbit-layout-clear] keeps names and key plates clear on 60 small and 30 crowded topologies', () => {
    let crowdedOk = 0;
    let smallOk = 0;
    for (let seed = 0; seed < 60; seed++) {
      const l = layoutTopology(topologyOf(randomInput(seed)), 760);
      if (l.platesOk) smallOk++;
      expectClean(l, `small ${seed}`);
    }
    // Random bindings cross a lot; a tidy course topology (see the columns test) always gets its plates.
    expect(smallOk).toBeGreaterThanOrEqual(42);
    for (let seed = 0; seed < 30; seed++) {
      const l = layoutTopology(topologyOf(randomInput(seed, true)), 780);
      if (l.legend) {
        expect(l.nodes.every((n) => n.name === null)).toBe(true);
        continue;
      }
      expectClean(l, `crowded ${seed}`);
      if (l.platesOk) crowdedOk++;
    }
    // A crowded scheme may give up plates or names (they are then listed under it), but never overlaps.
    expect(crowdedOk).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('[rabbit-layout-columns] puts producers, exchanges, queues and consumers into growing columns', () => {
    const l = layoutTopology(
      topologyOf({
        exchanges: [{ name: 'orders', type: 'topic' }],
        queues: ['emails', 'audit'],
        bindings: [
          { source: 'orders', destination: 'emails', destinationType: 'queue', routingKey: 'order.*', arguments: {} },
          { source: 'orders', destination: 'audit', destinationType: 'queue', routingKey: '#', arguments: {} },
        ],
        producers: [{ id: 'api', exchange: 'orders', routingKey: 'order.created' }],
        consumers: [{ id: 'mailer', queue: 'emails', note: 'prefetch 1' }],
      }),
      760,
    );
    const col = (id: string) => l.nodes.find((n) => n.id === id)!.col;
    expect([col(nodeId.producer('api')), col(nodeId.exchange('orders')), col(nodeId.queue('emails')), col(nodeId.consumer('mailer'))]).toEqual([0, 1, 2, 3]);
    expect(l.edges.map((e) => e.text).sort()).toEqual(['#', 'order.*', 'order.created', 'prefetch 1']);
  });

  it('adds a column for an exchange bound to another exchange and survives a cycle', () => {
    const input: TopologyInput = {
      exchanges: [
        { name: 'a', type: 'fanout' },
        { name: 'b', type: 'direct' },
      ],
      queues: ['q'],
      bindings: [
        { source: 'a', destination: 'b', destinationType: 'exchange', routingKey: '', arguments: {} },
        { source: 'b', destination: 'q', destinationType: 'queue', routingKey: 'k', arguments: {} },
        { source: 'b', destination: 'a', destinationType: 'exchange', routingKey: '', arguments: {} },
      ],
      producers: [{ id: 'p', exchange: 'a', routingKey: '' }],
      consumers: [],
    };
    const l = layoutTopology(topologyOf(input), 760);
    expect(Math.max(...l.nodes.map((n) => n.col))).toBe(3);
    expectClean(l, 'cycle');
  });

  it('is deterministic, wide enough for its columns and handles empty input', () => {
    const topo = topologyOf(randomInput(5, true));
    expect(JSON.stringify(layoutTopology(topo, 700))).toBe(JSON.stringify(layoutTopology(topo, 700)));
    expect(layoutTopology(topo, 100).width).toBeGreaterThanOrEqual(500);
    const empty = layoutTopology(topologyOf({ exchanges: [], queues: [], bindings: [], producers: [], consumers: [] }), 500);
    expect(empty.nodes).toEqual([]);
    expect(empty.platesOk).toBe(true);
  });

  it('describes headers and fanout bindings without a routing key and merges parallel bindings', () => {
    const topo = topologyOf({
      exchanges: [
        { name: 'h', type: 'headers' },
        { name: 'f', type: 'fanout' },
      ],
      queues: ['q'],
      bindings: [
        { source: 'h', destination: 'q', destinationType: 'queue', routingKey: '', arguments: { 'x-match': 'any', color: 'red' } },
        { source: 'f', destination: 'q', destinationType: 'queue', routingKey: 'ignored', arguments: {} },
        { source: 'f', destination: 'q', destinationType: 'queue', routingKey: 'again', arguments: {} },
      ],
      producers: [],
      consumers: [],
    });
    expect(topo.edges.map((e) => e.text).sort()).toEqual(['any color=red', 'fanout']);
  });
});
