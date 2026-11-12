import { describe, expect, it } from 'vitest';
import { evaluate } from '../invariants';
import { Sim } from '../kernel';
import { errCode, make, put, topic, val } from './harness';
import { KafkaModel } from './model';

const producer = { id: 'p', kind: 'producer', topic: 't', rate: 20, count: 40, message: { body: 'm{n}', key: 'k{n%4}' } };
const consumer = { id: 'c', kind: 'consumer', group: 'g', topics: ['t'], processMs: 5, config: { 'auto.offset.reset': 'earliest' } };

function scenario(extra: Record<string, unknown> = {}, seed = 1, partitions = 3) {
  const h = make({ actors: [producer, consumer], ...extra }, seed);
  topic(h.model, 't', partitions);
  return h;
}

describe('scenario actors', () => {
  it('delivers every message once and in key order', () => {
    const { sim, run } = scenario();
    run(20000);
    expect(evaluate({ kind: 'noLoss' }, sim).ok).toBe(true);
    expect(evaluate({ kind: 'noDuplicateProcessing', actor: 'c' }, sim).ok).toBe(true);
    expect(evaluate({ kind: 'orderedByKey', actor: 'c' }, sim).ok).toBe(true);
    expect(evaluate({ kind: 'processedAtLeast', actor: 'c', count: 40, byMs: 20000 }, sim).ok).toBe(true);
    expect(evaluate({ kind: 'allConfirmed' }, sim).ok).toBe(true);
    expect(evaluate({ kind: 'lagBelow', group: 'g', value: 0, byMs: 15000 }, sim).ok).toBe(true);
    expect(evaluate({ kind: 'latencyP95Below', ms: 10000 }, sim).ok).toBe(true);
  });

  it('same seed gives the same journal and metrics, another seed another run', () => {
    const go = (seed: number): string => {
      const h = make({ actors: [{ ...producer, message: { body: 'm{n}' } }, consumer] }, seed);
      topic(h.model, 't', 6);
      h.run(15000);
      return JSON.stringify({ j: h.sim.journal.entries(), m: h.sim.metrics.series() });
    };
    expect(go(4)).toBe(go(4));
    expect(go(4)).not.toBe(go(5));
  });

  it('runToIdle stops when everything is produced and consumed', () => {
    const { sim } = scenario();
    const r = sim.runToIdle();
    expect(r.stoppedBy).toBe('idle');
    expect(evaluate({ kind: 'processedAtLeast', actor: 'c', count: 40, byMs: sim.now }, sim).ok).toBe(true);
  });

  it('maxEvents ends the run with a sim.limit entry', () => {
    const model = new KafkaModel(undefined, { minSegmentBytes: 1 });
    const sim = new Sim(model, { seed: 1, maxEvents: 300 });
    model.setClock((ms) => void sim.runUntil(sim.now + ms));
    expect(sim.runUntil(500000).stoppedBy).toBe('maxEvents');
    expect(sim.journal.filter({ kinds: ['sim.limit'] })).toHaveLength(1);
  });

  it('a consumer crash after processing and before the commit reads the record again (duplicate)', () => {
    const faults = [{ at: 4000, kind: 'consumer.crash', actor: 'c', afterProcess: true }];
    const { sim, run } = scenario({ faults });
    run(120000);
    const r = evaluate({ kind: 'noDuplicateProcessing', actor: 'c' }, sim);
    expect(r.ok).toBe(false);
    expect(r.evidence.length).toBeGreaterThan(0);
    expect(evaluate({ kind: 'noLoss' }, sim).ok).toBe(true);
    expect(evaluate({ kind: 'processedAtLeast', actor: 'c', count: 40, byMs: 120000 }, sim).ok).toBe(true);
  });

  it('an idempotent consumer skips those duplicates', () => {
    const faults = [{ at: 4000, kind: 'consumer.crash', actor: 'c', afterProcess: true }];
    const { sim, run, model } = make({ actors: [producer, { ...consumer, config: { ...consumer.config, idempotent: true } }], faults });
    topic(model, 't', 3);
    run(120000);
    expect(evaluate({ kind: 'noDuplicateProcessing', actor: 'c' }, sim).ok).toBe(true);
  });

  it('ack.lost duplicates a record without idempotence and not with it', () => {
    const run1 = (idem: boolean): boolean => {
      const faults = [{ at: 300, kind: 'ack.lost', actor: 'p' }];
      const p = { ...producer, count: 20, config: { 'enable.idempotence': idem, 'request.timeout.ms': 1000 } };
      const h = make({ actors: [p, consumer], faults }, 3);
      topic(h.model, 't', 1);
      h.run(30000);
      return evaluate({ kind: 'noDuplicateProcessing', actor: 'c' }, h.sim).ok;
    };
    expect(run1(false)).toBe(false);
    expect(run1(true)).toBe(true);
  });

  it('broker crash and restart with acks=all and min.insync.replicas=2 lose nothing', () => {
    const faults = [
      { at: 700, kind: 'broker.crash', broker: 1 },
      { at: 5000, kind: 'broker.restart', broker: 1 },
    ];
    const h = make({ actors: [producer, consumer], faults });
    topic(h.model, 't', 3, 3, { 'min.insync.replicas': '2' });
    h.run(30000);
    expect(evaluate({ kind: 'noLoss' }, h.sim).ok).toBe(true);
    expect(evaluate({ kind: 'processedAtLeast', actor: 'c', count: 40, byMs: 30000 }, h.sim).ok).toBe(true);
    expect(h.sim.journal.filter({ kinds: ['leader'] }).length).toBeGreaterThan(0);
  });

  it('replica.stall shows up as a dip of the ISR metric', () => {
    const faults = [{ at: 1000, kind: 'replica.stall', broker: 2, ms: 40000 }];
    const h = make({ actors: [{ ...producer, count: 0 }], faults });
    topic(h.model, 't', 1);
    h.model.producer('x').send({ topic: 't', value: 'a' });
    h.run(1500);
    h.model.producer('y').send({ topic: 't', value: 'b' });
    h.run(60000);
    const pts = h.sim.metrics.get('isr.t-0')?.points.map((p) => p[1]) ?? [];
    expect(Math.min(...pts)).toBe(2);
    expect(pts[pts.length - 1]).toBe(3);
  });

  it('failEveryN makes the handler fail on every Nth record', () => {
    const { sim, run } = scenario({ actors: [producer, { ...consumer, failEveryN: 10 }] });
    run(20000);
    expect(sim.journal.filter({ kinds: ['handler.error'] })).toHaveLength(4);
    expect(sim.journal.filter({ kinds: ['process'] }).length).toBe(36);
  });

  it('a slow consumer beyond max.poll.interval.ms drops out of the group', () => {
    const faults = [{ at: 4000, kind: 'consumer.slow', actor: 'c', processMs: 20000 }];
    const h = make({ actors: [{ ...producer, rate: 50, count: 400 }, { ...consumer, config: { ...consumer.config, 'max.poll.interval.ms': 15000, 'max.poll.records': 20 } }], faults });
    topic(h.model, 't', 1);
    h.run(60000);
    expect(h.sim.journal.filter({ kinds: ['error'] }).some((e) => e.text.includes('max.poll.interval.ms'))).toBe(true);
  });
});

describe('start and stop of scenario consumers', () => {
  const lagNow = (h: ReturnType<typeof scenario>): number => {
    const d = val(h.model.describeGroup('g'));
    return d.offsets.reduce((n, o) => n + (o.lag ?? 0), 0);
  };

  it('stopping the consumer lets the lag grow, starting it rebalances and the lag falls', () => {
    const h = make({ actors: [{ ...producer, count: 400, rate: 20 }, { ...consumer, config: { ...consumer.config, 'enable.auto.commit': true, 'auto.commit.interval.ms': 500 } }] });
    topic(h.model, 't', 1);
    h.run(10000);
    val(h.model.stopConsumer('c'));
    h.run(14000);
    h.run(18000);
    expect(val(h.model.describeGroup('g')).members).toHaveLength(0);
    const stopped = lagNow(h);
    expect(stopped).toBeGreaterThan(20);
    val(h.model.startConsumer('c'));
    h.run(40000);
    expect(val(h.model.describeGroup('g')).members).toHaveLength(1);
    expect(lagNow(h)).toBeLessThan(stopped);
    expect(h.sim.journal.filter({ kinds: ['rebalance'] }).length).toBeGreaterThan(2);
  });

  it('an unknown id lists the known consumers in Russian', () => {
    const h = scenario();
    const r = h.model.startConsumer('zzz');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.text).toBe('Нет потребителя «zzz» в сценарии. Известные: c');
    expect(errCode(h.model.stopConsumer('p'))).toBe(3);
  });
});

describe('admin api', () => {
  it('validates topic creation', () => {
    const { model } = make();
    expect(errCode(model.createTopic({ name: 'bad name' }))).toBe(17);
    expect(errCode(model.createTopic({ name: 'x', partitions: 0 }))).toBe(37);
    expect(errCode(model.createTopic({ name: 'x', replicationFactor: 4 }))).toBe(38);
    val(model.createTopic({ name: 'x' }));
    expect(model.listTopics()).toEqual(['x']);
    expect(errCode(model.deleteTopic('nope'))).toBe(3);
    val(model.deleteTopic('x'));
    expect(model.listTopics()).toEqual([]);
  });

  it('alters and describes topic and broker configs', () => {
    const { model } = make();
    topic(model, 't');
    val(model.alterConfigs('topics', 't', { 'retention.ms': '1000', 'min.insync.replicas': '2' }));
    expect(val(model.describeTopic('t')).configs).toEqual({ 'retention.ms': '1000', 'min.insync.replicas': '2' });
    expect(val(model.describeConfigs('topics', 't')).map((e) => `${e.name}=${e.value}:${e.source}`)).toEqual([
      'retention.ms=1000:DYNAMIC_TOPIC_CONFIG',
      'min.insync.replicas=2:DYNAMIC_TOPIC_CONFIG',
    ]);
    val(model.alterConfigs('topics', 't', {}, ['retention.ms']));
    expect(val(model.describeTopic('t')).configs).toEqual({ 'min.insync.replicas': '2' });
    expect(val(model.describeConfigs('topics', 't', true)).find((e) => e.name === 'segment.ms')?.source).toBe('DEFAULT_CONFIG');
    expect(errCode(model.alterConfigs('topics', 't', { nonsense: '1' }))).toBe(40);
    val(model.alterConfigs('brokers', '', { 'min.insync.replicas': '2' }));
    expect(val(model.describeConfigs('brokers', '')).map((e) => e.name)).toEqual(['min.insync.replicas']);
    expect(errCode(model.alterConfigs('brokers', '9', {}))).toBe(3);
  });

  it('a broker-level min.insync.replicas applies to topics without an override', () => {
    const { model } = make();
    topic(model, 't');
    val(model.alterConfigs('brokers', '', { 'min.insync.replicas': '2' }));
    val(model.crashBroker(2));
    val(model.crashBroker(3));
    expect(put(model, 't', ['a'], { acks: 'all', retries: 0 })[0].error?.code).toBe(19);
  });

  it('a deleted topic is gone for producers and consumers when auto-creation is off', () => {
    const { model } = make();
    topic(model, 't');
    put(model, 't', ['a']);
    val(model.deleteTopic('t'));
    val(model.alterConfigs('brokers', '', { 'auto.create.topics.enable': 'false' }));
    expect(errCode(model.consume({ topic: 't' }))).toBe(3);
    expect(val(model.produce('t', [{ value: 'x' }], { retries: 0 }))[0].error?.code).toBe(3);
    expect(model.listTopics()).toEqual([]);
  });

  it('[auto-create] a produce to a missing topic creates it with 1 partition and RF 1', () => {
    const { model, sim } = make();
    const r = val(model.produce('orderz', [{ value: 'x' }]));
    expect(r[0]).toMatchObject({ offset: 0, error: null });
    expect(val(model.describeTopic('orderz'))).toMatchObject({ partitionCount: 1, replicationFactor: 1 });
    expect(sim.journal.filter({ kinds: ['fault'] }).some((e) => e.rule === 'auto-create')).toBe(true);
  });

  it('[auto-create] subscribing to a missing topic creates it unless allow.auto.create.topics=false', () => {
    const { model } = make();
    model.consumer('a', { 'group.id': 'g' }).subscribe(['typo']);
    expect(model.listTopics()).toEqual(['typo']);
    model.consumer('b', { 'group.id': 'g', 'allow.auto.create.topics': false }).subscribe(['other']);
    expect(model.listTopics()).toEqual(['typo']);
  });

  it('[auto-create] auto.create.topics.enable=false answers UNKNOWN_TOPIC_OR_PARTITION', () => {
    const { model } = make();
    val(model.alterConfigs('brokers', '', { 'auto.create.topics.enable': 'false' }));
    expect(val(model.produce('nope', [{ value: 'x' }]))[0].error?.code).toBe(3);
  });

  it('uses the exact texts of the controller and the topic name check', () => {
    const { model } = make();
    topic(model, 't', 3);
    const e = (r: { ok: boolean; error?: { text: string } }): string => (r.ok ? '' : (r.error?.text as string));
    expect(e(model.alterPartitions('t', 2))).toBe('The topic t currently has 3 partition(s); 2 would not be an increase.');
    expect(e(model.alterPartitions('t', 3))).toBe('Topic already has 3 partition(s).');
    expect(e(model.createTopic({ name: '' }))).toBe('Topic name is invalid: the empty string is not allowed');
    expect(e(model.createTopic({ name: '..' }))).toBe("Topic name is invalid: '..' is not allowed");
    expect(e(model.createTopic({ name: 'a b' }))).toBe("Topic name is invalid: 'a b' contains one or more characters other than ASCII alphanumerics, '.', '_' and '-'");
  });

  it('[metadata-refresh] new partitions are noticed after metadata.max.age.ms and the group rebalances', () => {
    const { model, sim } = make();
    topic(model, 't', 2);
    const c = model.consumer('c', { 'group.id': 'g', 'metadata.max.age.ms': 10000 });
    c.subscribe(['t']);
    const poll = (ms: number): void => {
      const end = model.now + ms;
      while (model.now < end) {
        c.raw.poll1();
        model.advance(25);
      }
    };
    poll(4000);
    val(model.alterPartitions('t', 4));
    poll(5000);
    expect(c.assignment).toHaveLength(2);
    poll(10000);
    expect(c.assignment).toHaveLength(4);
    expect(sim.journal.filter({ kinds: ['rebalance'] }).some((e) => e.rule === 'metadata-refresh')).toBe(true);
  });

  it('records keep key, value, headers and timestamp through the console consumer', () => {
    const { model } = make();
    topic(model, 't');
    val(model.produce('t', [{ key: 'k', value: 'v', headers: [['h', '1']] }]));
    const r = val(model.consume({ topic: 't', fromBeginning: true })).records[0];
    expect(r).toMatchObject({ key: 'k', value: 'v', headers: [['h', '1']], offset: 0, partition: 0 });
    expect(typeof r.timestamp).toBe('number');
  });

  it('snapshot is plain JSON', () => {
    const { model } = make();
    topic(model, 't', 2);
    put(model, 't', ['a']);
    const s = model.snapshot();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(s.topics[0].partitions).toHaveLength(2);
    expect(s.brokers).toHaveLength(3);
  });
});
