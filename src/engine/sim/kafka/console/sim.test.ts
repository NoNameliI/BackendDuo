import { describe, expect, it } from 'vitest';
import { make, topic } from '../harness';
import { createSimCommand } from './sim';

const scenario = {
  actors: [
    { id: 'p', kind: 'producer', topic: 't', rate: 20, count: 100, message: { body: 'm{n}' } },
    { id: 'c', kind: 'consumer', group: 'g', topics: ['t'], processMs: 5, config: { 'auto.offset.reset': 'earliest' } },
  ],
};

describe('sim consumer', () => {
  it('stops and starts a scenario consumer with [sim] lines', () => {
    const { model, sim } = make(scenario);
    topic(model, 't', 1);
    const cmd = createSimCommand(model);
    sim.runUntil(8000);
    const stop = cmd.run(['consumer', 'stop', 'c'], undefined as never);
    expect(stop.lines[0].text).toBe('[sim] потребитель c остановлен и вышел из группы');
    sim.runUntil(sim.now + 5000);
    expect(model.describeGroup('g').ok && (model.describeGroup('g') as { value: { members: unknown[] } }).value.members).toHaveLength(0);
    const start = cmd.run(['consumer', 'start', 'c'], undefined as never);
    expect(start.lines[0].text).toContain('[sim] потребитель c запущен');
    sim.runUntil(sim.now + 10000);
    expect((model.describeGroup('g') as { value: { members: unknown[] } }).value.members).toHaveLength(1);
  });

  it('reports unknown ids and bad usage', () => {
    const { model } = make(scenario);
    const cmd = createSimCommand(model);
    expect(cmd.run(['consumer', 'stop', 'zzz'], undefined as never).exit).toBe(1);
    expect(cmd.run(['consumer', 'stop', 'zzz'], undefined as never).lines[0].text).toContain('Известные: c');
    expect(cmd.run(['consumer', 'pause', 'c'], undefined as never).exit).toBe(2);
  });
});
