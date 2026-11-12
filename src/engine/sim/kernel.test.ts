import { describe, expect, it } from 'vitest';
import { Sim } from './kernel';
import type { EventClass, KernelApi, Model, SimEvent } from './types';
import { createPingPong } from './testModel';

const run = (seed: number) => {
  const sim = new Sim(createPingPong(30), { seed });
  sim.runUntil(3000);
  return JSON.stringify([sim.journal.entries(), sim.metrics.series(), sim.snapshot()]);
};

/** Model that records the order in which scripted events arrive. */
function recorder(script: [number, EventClass, string][]) {
  const seen: SimEvent[] = [];
  let k!: KernelApi;
  const model: Model<null> = {
    flavor: 'kafka',
    attach: (kernel) => {
      k = kernel;
      for (const [d, c, kind] of script) k.schedule(d, c, kind);
    },
    handle: (ev) => void seen.push(ev),
    sample: () => ({}),
    snapshot: () => null,
    quiet: () => false,
  };
  return { model, seen, api: () => k };
}

describe('Sim determinism', () => {
  it('same seed gives identical journal and metrics JSON', () => {
    expect(run(7)).toBe(run(7));
  });
  it('different seed gives a different run', () => {
    expect(run(7)).not.toBe(run(8));
  });
  it('seek back equals a forward run', () => {
    const a = new Sim(createPingPong(30), { seed: 3 });
    a.runUntil(2000);
    const fresh = new Sim(createPingPong(30), { seed: 3 });
    fresh.runUntil(2000);
    expect(JSON.stringify(fresh.journal.entries())).toBe(JSON.stringify(a.journal.entries()));
    const b = new Sim(createPingPong(30), { seed: 3 });
    b.runUntil(3000);
    const c = new Sim(createPingPong(30), { seed: 3 });
    c.runUntil(2000);
    expect(JSON.stringify(c.metrics.series())).toBe(JSON.stringify(a.metrics.series()));
  });
});

describe('Sim ordering', () => {
  it('orders events by (at, cls, id)', () => {
    const { model, seen } = recorder([
      [10, 3, 'c3-first'],
      [10, 0, 'c0'],
      [5, 4, 'early'],
      [10, 3, 'c3-second'],
      [10, 1, 'c1'],
    ]);
    new Sim(model, { seed: 1 }).runUntil(20);
    expect(seen.map((e) => e.kind)).toEqual(['early', 'c0', 'c1', 'c3-first', 'c3-second']);
    const keys = seen.map((e) => [e.at, e.cls, e.id]);
    expect(keys).toEqual([...keys].sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]));
  });
  it('skips cancelled events and rejects negative delays', () => {
    const { model, seen, api } = recorder([[5, 3, 'a']]);
    const sim = new Sim(model, { seed: 1 });
    const id = api().schedule(6, 3, 'b');
    api().schedule(7, 3, 'c');
    api().cancel(id);
    expect(() => api().schedule(-1, 3, 'x')).toThrow(RangeError);
    sim.runUntil(10);
    expect(seen.map((e) => e.kind)).toEqual(['a', 'c']);
  });
  it('step returns events one by one and now follows them', () => {
    const { model } = recorder([[5, 3, 'a']]);
    const sim = new Sim(model, { seed: 1 });
    expect(sim.step()?.kind).toBe('sim.sample');
    expect(sim.step()?.kind).toBe('a');
    expect(sim.now).toBe(5);
  });
  it('rng streams are cached per name and independent of each other', () => {
    const sim = new Sim(createPingPong(), { seed: 5 });
    expect(sim.rng('a')).toBe(sim.rng('a'));
    const other = new Sim(createPingPong(), { seed: 5 });
    other.rng('b').next();
    expect(other.rng('a').next()).toBe(new Sim(createPingPong(), { seed: 5 }).rng('a').next());
  });
});

describe('Sim limits and run modes', () => {
  it('maxEvents stops the run with stoppedBy and one sim.limit entry', () => {
    const sim = new Sim(createPingPong(1000), { seed: 1, maxEvents: 50 });
    const r = sim.runUntil(100_000);
    expect(r.stoppedBy).toBe('maxEvents');
    expect(r.events).toBe(50);
    sim.runUntil(100_000);
    expect(sim.journal.filter({ kinds: ['sim.limit'] })).toHaveLength(1);
  });
  it('horizon stops without throwing', () => {
    const sim = new Sim(createPingPong(100_000), { seed: 1, horizonMs: 1000 });
    const r = sim.runUntil(5000);
    expect(r.stoppedBy).toBe('horizon');
    expect(sim.now).toBe(1000);
    expect(sim.journal.filter({ kinds: ['sim.limit'] })).toHaveLength(1);
  });
  it('runUntil reports time and advances the clock', () => {
    const sim = new Sim(createPingPong(5), { seed: 1 });
    expect(sim.runUntil(10).stoppedBy).toBe('time');
    expect(sim.now).toBe(10);
  });
  it('runToIdle stops when the model is quiet', () => {
    const sim = new Sim(createPingPong(5), { seed: 1 });
    const r = sim.runToIdle();
    expect(r.stoppedBy).toBe('idle');
    expect(sim.snapshot()).toEqual({ sent: 5, received: 5, inFlight: 0 });
  });
  it('samples metrics every sampleMs', () => {
    const sim = new Sim(createPingPong(5), { seed: 1, sampleMs: 100 });
    sim.runUntil(1000);
    expect(sim.metrics.get('q.pong.ready')?.points.map((p) => p[0])).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  });
});
