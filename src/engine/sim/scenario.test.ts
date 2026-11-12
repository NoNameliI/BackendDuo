import { describe, expect, it } from 'vitest';
import { Sim } from './kernel';
import { applyProperties, expandTemplate, parseScenario, scheduleFaults } from './scenario';
import type { KernelApi, Model, SimEvent } from './types';

const base = {
  sim: 'rabbit',
  seed: 7,
  durationMs: 60000,
  setup: 'x',
  actors: [
    { id: 'orders-api', kind: 'producer', rate: 20, count: 200, message: { body: 'order {n}', key: 'customer-{n%5}' }, config: { confirms: true } },
    { id: 'mailer', kind: 'consumer', queue: 'emails', processMs: 50, config: { prefetch_count: 10 } },
  ],
  faults: [{ at: 10000, kind: 'consumer.crash', actor: 'mailer', afterProcess: true }],
  expect: [{ kind: 'noLoss' }, { kind: 'noDuplicateProcessing', actor: 'mailer' }],
};

describe('scenario', () => {
  it('parses the spec example and keeps extra fault fields', () => {
    const sc = parseScenario(base);
    expect(sc.actors).toHaveLength(2);
    expect(sc.faults[0]).toMatchObject({ afterProcess: true });
  });
  it('rejects unknown invariant kinds and bad flavors', () => {
    expect(() => parseScenario({ ...base, expect: [{ kind: 'nope' }] })).toThrow();
    expect(() => parseScenario({ ...base, sim: 'nats' })).toThrow();
  });
  it('expands {n} and {n%K}', () => {
    expect(expandTemplate('order {n} for customer-{n%5}', 12)).toBe('order 12 for customer-2');
  });
  it('applies actor and topic overrides over config', () => {
    const sc = parseScenario({
      ...base,
      actors: [
        { id: 'p', kind: 'producer', topic: 'orders', config: { acks: '1' } },
        { id: 'c', kind: 'consumer', group: 'g', topics: ['orders'] },
      ],
    });
    const { scenario, errors } = applyProperties(sc, ['p.enable.idempotence=true', 'topic.orders.max.poll.records=5', 'p.acks=all', '# note', 'x.y=1', 'bad']);
    expect(scenario.actors[0].config).toEqual({ acks: 'all', 'enable.idempotence': true, 'max.poll.records': 5 });
    expect(scenario.actors[1].config).toEqual({ 'max.poll.records': 5 });
    expect(errors).toHaveLength(2);
    expect(sc.actors[0].config).toEqual({ acks: '1' });
  });
  it('schedules faults as class-0 events', () => {
    const seen: SimEvent[] = [];
    const sc = parseScenario(base);
    const model: Model<null> = {
      flavor: 'rabbit',
      attach: (k: KernelApi) => scheduleFaults(sc, k),
      handle: (e) => void seen.push(e),
      sample: () => ({}),
      snapshot: () => null,
      quiet: () => false,
    };
    new Sim(model, { seed: 1 }).runUntil(20000);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ at: 10000, cls: 0, kind: 'consumer.crash', data: { actor: 'mailer', afterProcess: true } });
  });
});
