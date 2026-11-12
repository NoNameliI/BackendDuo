import { describe, expect, it } from 'vitest';
import { make, topic } from './harness';

const values = (m: ReturnType<typeof make>['model']): (string | null)[] => m.partitionOf('t', 0)?.leaderLog?.all().map((r) => r.value) ?? [];

describe('idempotence', () => {
  it('[idempotent-dedupe] a lost acknowledgement is retried and the broker does not write the duplicate', () => {
    const { model, sim } = make();
    topic(model, 't');
    const p = model.producer('p', { 'request.timeout.ms': 1000, 'enable.idempotence': true });
    p.raw.lostAcks = 1;
    p.send({ topic: 't', value: 'a' });
    p.flush();
    expect(values(model)).toEqual(['a']);
    expect(p.results).toMatchObject([{ offset: 0, error: null, attempts: 2 }]);
    expect(sim.journal.filter({ kinds: ['produce'] }).some((e) => e.rule === 'idempotent-dedupe')).toBe(true);
  });

  it('[idempotent-dedupe] without idempotence the same retry writes the record twice', () => {
    const { model } = make();
    topic(model, 't');
    const p = model.producer('p', { 'request.timeout.ms': 1000, 'enable.idempotence': false });
    p.raw.lostAcks = 1;
    p.send({ topic: 't', value: 'a' });
    p.flush();
    expect(values(model)).toEqual(['a', 'a']);
  });

  it('[idempotent-dedupe] idempotence is on by default and a new producer gets a new PID', () => {
    const { model } = make();
    topic(model, 't');
    const a = model.producer('a');
    const b = model.producer('b');
    expect(a.raw.pid).toBeDefined();
    expect(b.raw.pid).not.toBe(a.raw.pid);
    expect(model.producer('c', { acks: 1 }).raw.pid).toBeUndefined();
    expect(() => model.producer('d', { acks: 1, 'enable.idempotence': true })).toThrow(/acks to all/);
  });

  it('[idempotent-dedupe] a new PID after a restart does not remove duplicates of the application', () => {
    const { model } = make();
    topic(model, 't');
    for (const id of ['p1', 'p2']) {
      const p = model.producer(id);
      p.send({ topic: 't', value: 'same' });
      p.close();
    }
    expect(values(model)).toEqual(['same', 'same']);
  });

  it('[idempotent-dedupe] state survives a leader change: the new leader rebuilds it from the log', () => {
    const { model } = make();
    topic(model, 't');
    const p = model.producer('p', { 'request.timeout.ms': 1000 });
    p.send({ topic: 't', value: 'a' });
    p.flush();
    model.crashBroker(1);
    p.raw.lostAcks = 1;
    p.send({ topic: 't', value: 'b' });
    p.flush();
    expect(values(model)).toEqual(['a', 'b']);
  });
});

describe('retries and order', () => {
  const abc = (cfg: Record<string, unknown>): (string | null)[] => {
    const { model } = make();
    topic(model, 't');
    const p = model.producer('p', { 'batch.size': 1, 'linger.ms': 0, ...cfg });
    p.raw.failNext = { code: 6, count: 1 };
    for (const v of ['A', 'B', 'C']) p.send({ topic: 't', value: v });
    p.flush();
    return values(model);
  };

  it('[retry-reorder] without idempotence and with several requests in flight the retried batch lands last', () => {
    expect(abc({ 'enable.idempotence': false })).toEqual(['B', 'C', 'A']);
  });

  it('[retry-reorder] one request in flight keeps the order', () => {
    expect(abc({ 'enable.idempotence': false, 'max.in.flight.requests.per.connection': 1 })).toEqual(['A', 'B', 'C']);
  });

  it('[retry-reorder] idempotence keeps the order with up to 5 requests in flight', () => {
    expect(abc({ 'enable.idempotence': true })).toEqual(['A', 'B', 'C']);
  });
});

describe('batching', () => {
  const batches = (cfg: Record<string, unknown>, vals: string[]) => {
    const { model, sim } = make();
    topic(model, 't');
    const p = model.producer('p', cfg);
    for (const v of vals) p.send({ topic: 't', value: v });
    p.flush();
    return sim.journal.filter({ kinds: ['produce'] }).filter((e) => e.rule === 'linger-batch');
  };

  it('[linger-batch] records arriving together share one batch (linger.ms=5)', () => {
    const b = batches({}, ['a', 'b', 'c']);
    expect(b).toHaveLength(1);
    expect(b[0].data?.records).toBe(3);
  });

  it('[linger-batch] a batch closes when the next record would exceed batch.size (key+value+headers bytes)', () => {
    const b = batches({ 'batch.size': 20 }, ['12345678', '12345678', '12345678']);
    expect(b.map((e) => e.data?.records)).toEqual([2, 1]);
    expect(b[0].data?.bytes).toBe(16);
  });

  it('[linger-batch] nothing is sent before linger.ms elapsed', () => {
    const { model } = make();
    topic(model, 't');
    const p = model.producer('p', { 'linger.ms': 1000 });
    p.send({ topic: 't', value: 'a' });
    model.advance(500);
    expect(values(model)).toEqual([]);
    model.advance(520);
    expect(values(model)).toEqual(['a']);
  });
});
