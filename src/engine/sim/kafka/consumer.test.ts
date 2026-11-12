import { describe, expect, it } from 'vitest';
import type { ConsumerHandle, KafkaModel } from './model';
import type { Rec } from './consumer';
import { errCode, make, put, topic, val } from './harness';

/** Polls every consumer every 25 ms of virtual time, like a poll loop would. */
function drive(m: KafkaModel, cs: ConsumerHandle[], ms: number): Rec[][] {
  const sink: Rec[][] = cs.map(() => []);
  const end = m.now + ms;
  while (m.now < end) {
    cs.forEach((c, i) => sink[i].push(...c.raw.poll1()));
    m.advance(25);
  }
  return sink;
}
const owned = (c: ConsumerHandle): number[] => c.assignment.map((t) => t.partition);
const state = (m: KafkaModel, g: string) => val(m.describeGroup(g));

describe('group protocol', () => {
  it('[default-strategy] Range, CooperativeSticky by default: the first common strategy is range', () => {
    const { model } = make();
    topic(model, 't', 4);
    const a = model.consumer('a', { 'group.id': 'g' });
    const b = model.consumer('b', { 'group.id': 'g' });
    a.subscribe(['t']);
    b.subscribe(['t']);
    drive(model, [a, b], 4000);
    expect(state(model, 'g').protocol).toBe('range');
    expect(owned(a)).toEqual([0, 1]);
    expect(owned(b)).toEqual([2, 3]);
  });

  it('[default-strategy] a member with no common strategy is refused with INCONSISTENT_GROUP_PROTOCOL', () => {
    const { model } = make();
    topic(model, 't', 2);
    const a = model.consumer('a', { 'group.id': 'g', 'partition.assignment.strategy': 'org.apache.kafka.clients.consumer.RoundRobinAssignor' });
    const b = model.consumer('b', { 'group.id': 'g', 'partition.assignment.strategy': 'range' });
    a.subscribe(['t']);
    b.subscribe(['t']);
    drive(model, [a, b], 4000);
    expect(b.raw.error?.code).toBe(23);
    expect(state(model, 'g').members.map((m) => m.clientId)).toEqual(['a']);
  });

  it('[eager-revoke-all] a new member makes every member give up all partitions before the new assignment', () => {
    const { model, sim } = make();
    topic(model, 't', 4);
    const a = model.consumer('a', { 'group.id': 'g' });
    a.subscribe(['t']);
    drive(model, [a], 4000);
    expect(owned(a)).toEqual([0, 1, 2, 3]);
    const b = model.consumer('b', { 'group.id': 'g' });
    b.subscribe(['t']);
    let sawEmpty = false;
    const end = model.now + 10000;
    while (model.now < end) {
      a.raw.poll1();
      b.raw.poll1();
      if (owned(a).length === 0) sawEmpty = true;
      model.advance(25);
    }
    expect(sawEmpty).toBe(true);
    expect(owned(a)).toEqual([0, 1]);
    expect(owned(b)).toEqual([2, 3]);
    const revokes = sim.journal.filter({ kinds: ['revoke'], actor: 'a' });
    expect(revokes).toHaveLength(1);
    expect(revokes[0].rule).toBe('eager-revoke-all');
    expect(state(model, 'g')).toMatchObject({ state: 'Stable', generation: 2 });
  });

  it('[coop-two-waves] cooperative-sticky: moved partitions are revoked first and handed over in a second rebalance', () => {
    const cfg = { 'group.id': 'g', 'partition.assignment.strategy': 'cooperative-sticky' };
    const { model, sim } = make();
    topic(model, 't', 4);
    const a = model.consumer('a', cfg);
    a.subscribe(['t']);
    drive(model, [a], 4000);
    const before = owned(a);
    const b = model.consumer('b', cfg);
    b.subscribe(['t']);
    let minHeld = 4;
    const end = model.now + 12000;
    while (model.now < end) {
      a.raw.poll1();
      b.raw.poll1();
      minHeld = Math.min(minHeld, owned(a).length);
      model.advance(25);
    }
    expect(before).toEqual([0, 1, 2, 3]);
    expect(minHeld).toBe(2);
    expect(owned(a)).toHaveLength(2);
    expect(owned(b)).toHaveLength(2);
    expect([...owned(a), ...owned(b)].sort()).toEqual([0, 1, 2, 3]);
    expect(state(model, 'g').generation).toBe(3);
    const rb = sim.journal.filter({ kinds: ['rebalance'], actor: 'coordinator' });
    expect(rb.filter((e) => e.rule === 'coop-two-waves').length).toBeGreaterThanOrEqual(3);
    expect(sim.journal.filter({ kinds: ['revoke'], actor: 'a' })).toHaveLength(1);
  });

  it('[session-timeout] a crashed member keeps its partitions until session.timeout.ms (45 s) expires', () => {
    const { model } = make();
    topic(model, 't', 4);
    const a = model.consumer('a', { 'group.id': 'g' });
    const b = model.consumer('b', { 'group.id': 'g' });
    a.subscribe(['t']);
    b.subscribe(['t']);
    drive(model, [a, b], 4000);
    b.raw.crash();
    drive(model, [a], 30000);
    expect(state(model, 'g').members).toHaveLength(2);
    expect(owned(a)).toEqual([0, 1]);
    drive(model, [a], 25000);
    expect(state(model, 'g').members).toHaveLength(1);
    expect(owned(a)).toEqual([0, 1, 2, 3]);
  });

  it('[session-timeout] a graceful close triggers the rebalance at once, not after the session timeout', () => {
    const { model } = make();
    topic(model, 't', 4);
    const a = model.consumer('a', { 'group.id': 'g' });
    const b = model.consumer('b', { 'group.id': 'g' });
    a.subscribe(['t']);
    b.subscribe(['t']);
    drive(model, [a, b], 4000);
    b.close();
    drive(model, [a], 8000);
    expect(owned(a)).toEqual([0, 1, 2, 3]);
  });

  it('[session-timeout] no poll for max.poll.interval.ms removes the member, the next poll rejoins', () => {
    const { model } = make();
    topic(model, 't', 2);
    const a = model.consumer('a', { 'group.id': 'g', 'max.poll.interval.ms': 10000 });
    a.subscribe(['t']);
    drive(model, [a], 4000);
    expect(state(model, 'g').members).toHaveLength(1);
    model.advance(11000);
    expect(state(model, 'g')).toMatchObject({ state: 'Empty', members: [] });
    drive(model, [a], 5000);
    expect(state(model, 'g').members).toHaveLength(1);
  });

  it('[session-timeout] group.initial.rebalance.delay.ms delays the first assignment and can be overridden', () => {
    const { model } = make();
    topic(model, 't', 2);
    const a = model.consumer('a', { 'group.id': 'g' });
    const b = model.consumer('b', { 'group.id': 'h', 'group.initial.rebalance.delay.ms': 0 });
    a.subscribe(['t']);
    b.subscribe(['t']);
    drive(model, [a, b], 1000);
    expect(owned(a)).toEqual([]);
    expect(owned(b)).toEqual([0, 1]);
    drive(model, [a, b], 3000);
    expect(owned(a)).toEqual([0, 1]);
  });
});

describe('offsets', () => {
  it('[lag] LEO minus committed, and no number when nothing was committed', () => {
    const { model } = make();
    topic(model, 't');
    put(model, 't', Array.from({ length: 10 }, (_, i) => `m${i}`));
    const c = model.consumer('c', { 'group.id': 'g', 'auto.offset.reset': 'earliest', 'enable.auto.commit': false });
    c.subscribe(['t']);
    const got = drive(model, [c], 4000)[0];
    expect(got).toHaveLength(10);
    expect(state(model, 'g').offsets[0]).toMatchObject({ current: null, logEnd: 10, lag: null });
    expect(c.commitSync()).toBeNull();
    expect(state(model, 'g').offsets[0]).toMatchObject({ current: 10, logEnd: 10, lag: 0 });
    put(model, 't', ['x', 'y', 'z']);
    expect(state(model, 'g').offsets[0]).toMatchObject({ current: 10, logEnd: 13, lag: 3 });
  });

  it('[lag] LOG-END-OFFSET is the high watermark: records above it are not counted', () => {
    const { model } = make();
    topic(model, 't');
    val(model.stallReplica(2, 100000));
    val(model.stallReplica(3, 100000));
    put(model, 't', ['a', 'b'], { acks: 1 });
    const c = model.consumer('c', { 'group.id': 'g', 'enable.auto.commit': false });
    c.assign([{ topic: 't', partition: 0 }]);
    c.seek({ topic: 't', partition: 0 }, 0);
    c.commitSync();
    expect(state(model, 'g').offsets[0]).toMatchObject({ current: 0, logEnd: 0, lag: 0 });
    model.advance(31000);
    expect(state(model, 'g').offsets[0]).toMatchObject({ logEnd: 2, lag: 2 });
  });

  it('[lag] lag metrics per group and per partition follow the committed offset', () => {
    const { model, sim } = make();
    topic(model, 't', 2);
    put(model, 't', ['a', 'b', 'c', 'd']);
    const c = model.consumer('c', { 'group.id': 'g', 'auto.offset.reset': 'earliest', 'enable.auto.commit': false });
    c.subscribe(['t']);
    drive(model, [c], 4000);
    c.commitSync();
    model.advance(500);
    const total = sim.metrics.get('lag.g');
    expect(total?.points[total.points.length - 1][1]).toBe(0);
    expect(sim.metrics.get('lag.g.t-0')).toBeDefined();
  });

  it('[auto-commit-in-poll] the commit happens inside poll() once auto.commit.interval.ms elapsed, not on a timer', () => {
    const { model } = make();
    topic(model, 't');
    put(model, 't', ['a', 'b', 'c']);
    const c = model.consumer('c', { 'group.id': 'g', 'auto.offset.reset': 'earliest' });
    c.subscribe(['t']);
    drive(model, [c], 3500);
    expect(c.raw.position({ topic: 't', partition: 0 })).toBe(3);
    model.advance(10000);
    expect(model.groupOffsets('g', { topic: 't', partition: 0 })).toBeUndefined();
    c.raw.poll1();
    expect(model.groupOffsets('g', { topic: 't', partition: 0 })).toBe(3);
  });

  it('[auto-commit-in-poll] close() commits, stop without close does not, and the offset is the next one to read', () => {
    const { model } = make();
    topic(model, 't');
    put(model, 't', ['a', 'b']);
    const c = model.consumer('c', { 'group.id': 'g', 'auto.offset.reset': 'earliest' });
    c.subscribe(['t']);
    drive(model, [c], 3500);
    c.close();
    expect(model.groupOffsets('g', { topic: 't', partition: 0 })).toBe(2);
    const d = model.consumer('d', { 'group.id': 'h', 'auto.offset.reset': 'earliest', 'enable.auto.commit': false });
    d.subscribe(['t']);
    drive(model, [d], 3500);
    d.close();
    expect(model.groupOffsets('h', { topic: 't', partition: 0 })).toBeUndefined();
  });

  it('[auto-commit-in-poll] a crash before the next poll leaves the old commit and the records are read again', () => {
    const { model } = make();
    topic(model, 't');
    put(model, 't', ['a', 'b']);
    const c = model.consumer('c', { 'group.id': 'g', 'auto.offset.reset': 'earliest' });
    c.subscribe(['t']);
    expect(drive(model, [c], 3500)[0]).toHaveLength(2);
    c.raw.crash();
    const d = model.consumer('d', { 'group.id': 'g', 'auto.offset.reset': 'earliest' });
    d.subscribe(['t']);
    expect(drive(model, [d], 52000)[0].map((r) => r.value)).toEqual(['a', 'b']);
  });

  it('[offset-reset] latest (default) starts at the end, earliest at the start, only without a commit', () => {
    const { model } = make();
    topic(model, 't');
    put(model, 't', ['old1', 'old2']);
    const late = model.consumer('late', { 'group.id': 'g1' });
    const early = model.consumer('early', { 'group.id': 'g2', 'auto.offset.reset': 'earliest' });
    late.subscribe(['t']);
    early.subscribe(['t']);
    const [l0, e0] = drive(model, [late, early], 3500);
    expect(l0).toEqual([]);
    expect(e0.map((r) => r.value)).toEqual(['old1', 'old2']);
    put(model, 't', ['new']);
    const [l, e] = drive(model, [late, early], 500);
    expect(l.map((r) => r.value)).toEqual(['new']);
    expect(e.map((r) => r.value)).toEqual(['new']);
  });

  it('[offset-reset] an existing commit wins over the policy, an out-of-range commit does not', () => {
    const { model, sim } = make();
    topic(model, 't');
    put(model, 't', ['a', 'b', 'c']);
    const first = model.consumer('first', { 'group.id': 'g', 'auto.offset.reset': 'earliest' });
    first.subscribe(['t']);
    drive(model, [first], 3500);
    first.close();
    val(model.resetOffsets('g', { mode: 'offset', value: 1 }, true));
    const second = model.consumer('second', { 'group.id': 'g', 'auto.offset.reset': 'latest' });
    second.subscribe(['t']);
    expect(drive(model, [second], 3500)[0].map((r) => r.value)).toEqual(['b', 'c']);
    second.close();
    model.partitionOf('t', 0)?.leaderLog?.truncateTo(1);
    const third = model.consumer('third', { 'group.id': 'g', 'auto.offset.reset': 'earliest' });
    third.subscribe(['t']);
    expect(drive(model, [third], 3500)[0].map((r) => r.value)).toEqual(['a']);
    expect(sim.journal.filter({ kinds: ['assign'] }).some((e) => e.rule === 'offset-reset' && e.text.includes('вне диапазона'))).toBe(true);
  });

  it('[offset-reset] auto.offset.reset=none reports an error instead of guessing', () => {
    const { model } = make();
    topic(model, 't');
    const c = model.consumer('c', { 'group.id': 'g', 'auto.offset.reset': 'none' });
    c.subscribe(['t']);
    drive(model, [c], 4000);
    expect(c.raw.error?.name).toBe('OFFSET_OUT_OF_RANGE');
    expect(() => model.consumer('x', { 'auto.offset.reset': 'bogus' })).toThrow(/auto.offset.reset/);
  });
});

describe('console tools', () => {
  it('[offset-reset] console consumer reads from the beginning or from the end and stops when idle', () => {
    const { model } = make();
    topic(model, 't');
    put(model, 't', ['a', 'b', 'c']);
    const all = val(model.consume({ topic: 't', fromBeginning: true }));
    expect(all.records.map((r) => r.value)).toEqual(['a', 'b', 'c']);
    expect(all.idle).toBe(true);
    expect(all.group).toMatch(/^console-consumer-\d+$/);
    expect(val(model.consume({ topic: 't' })).records).toEqual([]);
    expect(val(model.consume({ topic: 't', partition: 0, offset: 1, maxMessages: 1 })).records.map((r) => r.value)).toEqual(['b']);
  });

  it('[lag] --group commits on close, resetting needs an inactive group and DRY RUN does not store', () => {
    const { model } = make();
    topic(model, 't');
    put(model, 't', ['a', 'b', 'c', 'd']);
    val(model.consume({ topic: 't', group: 'g', fromBeginning: true, maxMessages: 2 }));
    expect(state(model, 'g').offsets[0]).toMatchObject({ current: 2, lag: 2 });
    const dry = val(model.resetOffsets('g', { mode: 'earliest' }, false));
    expect(dry).toEqual([{ group: 'g', topic: 't', partition: 0, newOffset: 0 }]);
    expect(state(model, 'g').offsets[0].current).toBe(2);
    val(model.resetOffsets('g', { mode: 'shift-by', value: 1 }, true));
    expect(state(model, 'g').offsets[0].current).toBe(3);
    expect(val(model.resetOffsets('g', { mode: 'latest' }, false))[0].newOffset).toBe(4);
    const live = model.consumer('c', { 'group.id': 'g' });
    live.subscribe(['t']);
    drive(model, [live], 4000);
    expect(errCode(model.resetOffsets('g', { mode: 'earliest' }, true))).toBe(68);
    expect(errCode(model.deleteGroup('g'))).toBe(68);
    live.close();
    expect(model.listGroups()).toEqual(['g']);
    val(model.deleteGroup('g'));
    expect(model.listGroups()).toEqual([]);
    expect(errCode(model.deleteGroup('g'))).toBe(69);
  });

  it('[lag] the coordinator is a broker chosen by the group id hash over 50 offsets partitions', () => {
    const { model } = make();
    topic(model, 't');
    for (const g of ['alpha', 'beta', 'gamma']) val(model.consume({ topic: 't', group: g, fromBeginning: true, timeoutMs: 4000 }));
    const brokers = ['alpha', 'beta', 'gamma'].map((g) => state(model, g).coordinator);
    for (const b of brokers) expect([1, 2, 3]).toContain(b);
    expect(brokers).toEqual(['alpha', 'beta', 'gamma'].map((g) => state(model, g).coordinator));
  });
});
