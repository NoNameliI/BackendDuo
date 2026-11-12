import { describe, expect, it } from 'vitest';
import { evaluate } from '../invariants';
import { errCode, make, put, topic, val } from './harness';

const info = (m: ReturnType<typeof make>['model'], t = 't', p = 0) => val(m.describeTopic(t)).partitions[p];

describe('placement and leaders', () => {
  it('[placement] partition p lives on brokers (p+i) mod 3 + 1, the first one leads', () => {
    const { model } = make();
    topic(model, 't', 4, 3);
    topic(model, 'two', 3, 2);
    const d = val(model.describeTopic('t')).partitions;
    expect(d.map((p) => p.replicas)).toEqual([[1, 2, 3], [2, 3, 1], [3, 1, 2], [1, 2, 3]]);
    expect(d.map((p) => p.leader)).toEqual([1, 2, 3, 1]);
    expect(val(model.describeTopic('two')).partitions.map((p) => p.replicas)).toEqual([[1, 2], [2, 3], [3, 1]]);
  });

  it('[placement] topic ids come from the topicId stream and are stable for one seed', () => {
    const a = make(undefined, 5);
    const b = make(undefined, 5);
    const c = make(undefined, 6);
    topic(a.model, 'x');
    topic(b.model, 'x');
    topic(c.model, 'x');
    const id = (m: typeof a.model): string => val(m.describeTopic('x')).topicId;
    expect(id(a.model)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(id(a.model)).toBe(id(b.model));
    expect(id(a.model)).not.toBe(id(c.model));
  });

  it('[placement] replication factor beyond live brokers is refused', () => {
    const { model } = make();
    val(model.crashBroker(3));
    expect(errCode(model.createTopic({ name: 'x', partitions: 1, replicationFactor: 3 }))).toBe(38);
    expect(errCode(model.createTopic({ name: 'x', partitions: 1, replicationFactor: 2 }))).toBe(0);
    expect(errCode(model.createTopic({ name: 'x' }))).toBe(36);
  });

  it('[leader-election] the first live replica of the ISR in replica order takes over, the old leader returns as follower', () => {
    const { model, sim } = make();
    topic(model, 't');
    put(model, 't', ['a', 'b']);
    val(model.crashBroker(1));
    expect(info(model)).toMatchObject({ leader: 2, isr: [2, 3] });
    val(model.restartBroker(1));
    model.advance(1000);
    expect(info(model)).toMatchObject({ leader: 2, replicas: [1, 2, 3] });
    expect([...info(model).isr].sort()).toEqual([1, 2, 3]);
    expect(sim.journal.filter({ kinds: ['leader'] })[0].rule).toBe('leader-election');
  });
});

describe('ISR and high watermark', () => {
  it('[hw-min-isr] HW is the minimum LEO of the ISR: a stalled follower holds it back until it leaves the ISR', () => {
    const { model } = make();
    topic(model, 't');
    val(model.stallReplica(2, 100000));
    val(model.stallReplica(3, 100000));
    put(model, 't', ['a', 'b'], { acks: 1 });
    expect(info(model)).toMatchObject({ leo: 2, hw: 0, isr: [1, 2, 3] });
    const c = model.consumer('c', { 'group.id': 'g', 'auto.offset.reset': 'earliest' });
    c.subscribe(['t']);
    expect(c.poll(5000)).toEqual([]);
    model.advance(30000);
    expect(info(model)).toMatchObject({ hw: 2, isr: [1] });
    expect(c.poll(2000).map((r) => r.value)).toEqual(['a', 'b']);
  });

  it('[hw-min-isr] without a stall every follower copies the data and HW follows', () => {
    const { model } = make();
    topic(model, 't');
    put(model, 't', ['a', 'b', 'c']);
    expect(info(model)).toMatchObject({ leo: 3, hw: 3 });
    expect(model.partitionOf('t', 0)?.snapshot().logs[2].leo).toBe(3);
  });

  it('[hw-min-isr] HW does not move while the ISR is below the effective min.insync.replicas', () => {
    const { model } = make();
    topic(model, 't', 1, 3, { 'min.insync.replicas': '2' });
    val(model.crashBroker(2));
    val(model.crashBroker(3));
    put(model, 't', ['x'], { acks: 1 });
    expect(info(model)).toMatchObject({ isr: [1], leo: 1, hw: 0 });
  });

  it('[isr-shrink] a follower that stays behind longer than replica.lag.time.max.ms leaves the ISR', () => {
    const { model, sim } = make();
    topic(model, 't');
    val(model.stallReplica(3, 60000));
    put(model, 't', ['a'], { acks: 1 });
    model.advance(25000);
    expect(info(model).isr).toEqual([1, 2, 3]);
    model.advance(7000);
    expect(info(model).isr).toEqual([1, 2]);
    expect(sim.journal.filter({ kinds: ['isr'] })[0]).toMatchObject({ rule: 'isr-shrink' });
  });

  it('[isr-shrink] a caught-up follower is never out of sync, even when stalled', () => {
    const { model } = make();
    topic(model, 't');
    put(model, 't', ['a']);
    val(model.stallReplica(3, 100000));
    model.advance(60000);
    expect(info(model).isr).toEqual([1, 2, 3]);
  });

  it('[isr-shrink] replica.lag.time.max.ms can be changed with kafka-configs', () => {
    const { model } = make();
    topic(model, 't');
    val(model.alterConfigs('brokers', '', { 'replica.lag.time.max.ms': '2000' }));
    val(model.stallReplica(3, 60000));
    put(model, 't', ['a'], { acks: 1 });
    model.advance(3000);
    expect(info(model).isr).toEqual([1, 2]);
  });

  it('[isr-expand] the follower returns to the ISR after it caught up', () => {
    const { model, sim } = make();
    topic(model, 't');
    val(model.stallReplica(3, 40000));
    put(model, 't', ['a', 'b'], { acks: 1 });
    model.advance(35000);
    expect(info(model).isr).toEqual([1, 2]);
    model.advance(10000);
    expect([...info(model).isr].sort()).toEqual([1, 2, 3]);
    expect(sim.journal.filter({ kinds: ['isr'] }).map((e) => e.rule)).toEqual(['isr-shrink', 'isr-expand']);
  });
});

describe('acks', () => {
  it('[acks-loss] acks=0 does not wait and reports offset -1', () => {
    const { model } = make();
    topic(model, 't');
    const r = put(model, 't', ['a'], { acks: 0 });
    expect(r[0]).toMatchObject({ offset: -1, error: null });
    expect(info(model).leo).toBe(1);
  });

  it('[acks-loss] acks=1 answers after the leader wrote; a leader crash before the followers fetched loses the record', () => {
    const { model, sim } = make();
    topic(model, 't');
    val(model.stallReplica(2, 100000));
    val(model.stallReplica(3, 100000));
    const r = put(model, 't', ['important'], { acks: 1 });
    expect(r[0]).toMatchObject({ offset: 0, error: null });
    val(model.crashBroker(1));
    expect(info(model)).toMatchObject({ leader: 2, leo: 0 });
    const drops = sim.journal.filter({ kinds: ['drop'] });
    expect(drops).toHaveLength(1);
    expect(drops[0].rule).toBe('acks-loss');
    expect(evaluate({ kind: 'noLoss' }, sim).ok).toBe(false);
  });

  it('[acks-loss] acks=all waits for the high watermark and survives a leader crash', () => {
    const { model, sim } = make();
    topic(model, 't', 1, 3, { 'min.insync.replicas': '2' });
    const r = put(model, 't', ['important'], { acks: 'all' });
    expect(r[0]).toMatchObject({ offset: 0, error: null });
    val(model.crashBroker(1));
    expect(info(model)).toMatchObject({ leader: 2, leo: 1, hw: 1 });
    expect(sim.journal.filter({ kinds: ['drop'] })).toHaveLength(0);
  });

  it('[acks-loss] the old leader truncates its divergent suffix when it returns', () => {
    const { model } = make();
    topic(model, 't');
    val(model.stallReplica(2, 100000));
    val(model.stallReplica(3, 100000));
    put(model, 't', ['lost'], { acks: 1 });
    val(model.crashBroker(1));
    put(model, 't', ['new-a', 'new-b'], { acks: 1 });
    val(model.restartBroker(1));
    model.advance(500);
    expect(model.partitionOf('t', 0)?.reps.get(1)?.log.all().map((r) => r.value)).toEqual(['new-a', 'new-b']);
  });
});

describe('min.insync.replicas', () => {
  it('[not-enough-replicas] below min ISR acks=all fails with 19 before anything is written', () => {
    const { model } = make();
    topic(model, 't', 1, 3, { 'min.insync.replicas': '2' });
    val(model.crashBroker(2));
    val(model.crashBroker(3));
    const r = put(model, 't', ['a'], { acks: 'all', retries: 0 });
    expect(r[0].error?.code).toBe(19);
    expect(info(model).leo).toBe(0);
  });

  it('[not-enough-replicas] acks=1 ignores min.insync.replicas', () => {
    const { model } = make();
    topic(model, 't', 1, 3, { 'min.insync.replicas': '2' });
    val(model.crashBroker(2));
    val(model.crashBroker(3));
    const r = put(model, 't', ['a'], { acks: 1 });
    expect(r[0].error).toBeNull();
    expect(info(model).leo).toBe(1);
  });

  it('[not-enough-replicas] the ISR shrinking after the append gives 20 and the record stays in the leader log', () => {
    const { model } = make();
    topic(model, 't', 1, 3, { 'min.insync.replicas': '2' });
    val(model.stallReplica(2, 100000));
    val(model.stallReplica(3, 100000));
    const r = put(model, 't', ['a'], { acks: 'all', retries: 0, 'request.timeout.ms': 60000 });
    expect(r[0].error?.code).toBe(20);
    expect(info(model)).toMatchObject({ leo: 1, isr: [1] });
  });

  it('[not-enough-replicas] a retry after error 20 with idempotence does not duplicate the record', () => {
    const { model } = make();
    topic(model, 't', 1, 3, { 'min.insync.replicas': '2' });
    val(model.stallReplica(2, 40000));
    val(model.stallReplica(3, 40000));
    const r = put(model, 't', ['a'], { acks: 'all', 'enable.idempotence': true });
    expect(r[0].error).toBeNull();
    expect(info(model).leo).toBe(1);
  });

  it('[not-enough-replicas] request.timeout.ms ends a wait that never completes with error 7', () => {
    const { model } = make();
    topic(model, 't', 1, 3, { 'min.insync.replicas': '2' });
    val(model.stallReplica(2, 100000));
    val(model.stallReplica(3, 100000));
    const r = put(model, 't', ['a'], { acks: 'all', retries: 0, 'request.timeout.ms': 5000 });
    expect(r[0].error?.code).toBe(7);
  });
});

describe('unavailable partitions', () => {
  it('[unclean-election] without the flag the partition stays offline until an ISR member returns', () => {
    const { model } = make();
    topic(model, 't');
    val(model.crashBroker(2));
    val(model.crashBroker(3));
    put(model, 't', ['a', 'b'], { acks: 1 });
    val(model.crashBroker(1));
    expect(info(model)).toMatchObject({ leader: null, isr: [1] });
    expect(val(model.describeTopic('t', 'unavailable')).partitions).toHaveLength(1);
    val(model.restartBroker(2));
    expect(info(model).leader).toBeNull();
    val(model.restartBroker(1));
    expect(info(model).leader).toBe(1);
    expect(info(model).leo).toBe(2);
  });

  it('[unclean-election] with the flag an out-of-ISR replica leads and acknowledged records are lost', () => {
    const { model, sim } = make();
    topic(model, 't', 1, 3, { 'unclean.leader.election.enable': 'true' });
    val(model.crashBroker(2));
    val(model.crashBroker(3));
    put(model, 't', ['a', 'b'], { acks: 1 });
    val(model.crashBroker(1));
    expect(info(model).leader).toBeNull();
    val(model.restartBroker(2));
    expect(info(model)).toMatchObject({ leader: 2, isr: [2], leo: 0 });
    expect(sim.journal.filter({ kinds: ['drop'] })).toHaveLength(2);
    expect(sim.journal.filter({ kinds: ['leader'] }).some((e) => e.rule === 'unclean-election')).toBe(true);
  });

  it('[unclean-election] changing the flag at runtime elects a leader for an offline partition', () => {
    const { model } = make();
    topic(model, 't');
    val(model.crashBroker(2));
    val(model.crashBroker(3));
    val(model.crashBroker(1));
    val(model.restartBroker(2));
    expect(info(model).leader).toBeNull();
    val(model.alterConfigs('topics', 't', { 'unclean.leader.election.enable': 'true' }));
    expect(info(model).leader).toBe(2);
  });

  it('[hw-min-isr] describe filters: under-replicated, under-min-isr, at-min-isr', () => {
    const { model } = make();
    topic(model, 't', 2, 3, { 'min.insync.replicas': '2' });
    val(model.crashBroker(3));
    expect(val(model.describeTopic('t', 'underReplicated')).partitions).toHaveLength(2);
    expect(val(model.describeTopic('t', 'atMinIsr')).partitions).toHaveLength(2);
    expect(val(model.describeTopic('t', 'underMinIsr')).partitions).toHaveLength(0);
    val(model.crashBroker(2));
    expect(val(model.describeTopic('t', 'underMinIsr')).partitions).toHaveLength(2);
  });
});
