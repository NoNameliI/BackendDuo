import { describe, expect, it } from 'vitest';
import { createKafkaSandbox } from '@/checker/broker';
import { brokerPills, groupModel, labelRows, layoutPartition, topicModels } from './kafkaLayout';

const BS = '--bootstrap-server localhost:9092';

function cluster(script: string) {
  const box = createKafkaSandbox();
  for (const r of box.run(script)) if (r.exit !== 0) throw new Error(`${r.line}: ${r.output}`);
  box.sim.runUntil(box.sim.now);
  return box;
}

const fed = () =>
  cluster(
    [
      `kafka-topics.sh ${BS} --create --topic orders --partitions 3 --replication-factor 3`,
      `kafka-console-producer.sh ${BS} --topic orders --property parse.key=true --property key.separator=: <<EOF\na:1\nb:2\nc:3\nd:4\ne:5\nEOF`,
    ].join('\n'),
  );

describe('layoutPartition', () => {
  it('draws the log from logStart to LEO with HW inside, replicas as chips', () => {
    const snap = fed().model.snapshot();
    const total = snap.topics[0].partitions.reduce((n, p) => n + p.leo, 0);
    expect(total).toBe(5);
    for (const p of snap.topics[0].partitions) {
      const t = layoutPartition(p, 600);
      expect(t.id).toBe(`orders-${p.partition}`);
      expect(t.hi - t.lo).toBe(p.leo - p.logStart);
      expect(t.replicas.map((r) => r.broker)).toEqual(p.replicas);
      expect(t.replicas.filter((r) => r.role === 'leader')).toHaveLength(1);
      expect(t.status).toBe('ok');
      for (const m of t.marks) {
        expect(m.x).toBeGreaterThanOrEqual(8);
        expect(m.x).toBeLessThanOrEqual(600 - 8 + 0.001);
      }
      expect(t.summary).toContain(`LEO ${p.leo}`);
    }
  });

  it('an empty log is marked empty and keeps its marks at one place', () => {
    const snap = cluster(`kafka-topics.sh ${BS} --create --topic idle --partitions 1`).model.snapshot();
    const t = layoutPartition(snap.topics[0].partitions[0], 400);
    expect(t.empty).toBe(true);
    expect(t.marks).toHaveLength(1);
    expect(t.marks[0].kinds).toEqual(['logStart', 'hw', 'leo']);
    expect(t.marks[0].text).toBe('начало = HW = LEO 0');
  });

  it('labels of marks never overlap: close marks go to other rows and stay inside the width', () => {
    const snap = fed().model.snapshot();
    const base = snap.topics[0].partitions.find((p) => p.leo >= 2)!;
    // HW below LEO and a log start above zero put three marks close to each other.
    const crowded = { ...base, logStart: 1, hw: 1, leo: base.leo + 1 };
    for (const width of [200, 320, 600]) {
      const t = layoutPartition(crowded, width);
      const boxes = t.marks.map((m) => {
        const w = m.text.length * 7.2;
        const from = m.anchor === 'start' ? m.labelX : m.anchor === 'end' ? m.labelX - w : m.labelX - w / 2;
        return { lane: m.lane, from, to: from + w };
      });
      for (const b of boxes) {
        expect(b.from).toBeGreaterThanOrEqual(-0.001);
        expect(b.to).toBeLessThanOrEqual(width + 0.001);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          if (boxes[i].lane === boxes[j].lane) expect(boxes[i].to <= boxes[j].from || boxes[j].to <= boxes[i].from).toBe(true);
        }
      }
      expect(labelRows(t)).toBe(Math.max(...t.marks.map((m) => m.lane)) + 1);
    }
  });

  it('a long log is not drawn offset by offset, a short one is', () => {
    const snap = fed().model.snapshot();
    const p = snap.topics[0].partitions.find((x) => x.leo >= 1)!;
    expect(layoutPartition(p, 800).perOffset).toBe(true);
    expect(layoutPartition({ ...p, leo: 5000 }, 800).perOffset).toBe(false);
  });

  it('a crashed broker leaves the ISR: shrunk ISR, a new leader, the replica is marked down and behind', () => {
    const box = fed();
    box.run('sim crash broker 2');
    box.run('sim run 40s');
    const snap = box.model.snapshot();
    const up = new Set(snap.brokers.filter((b) => b.up).map((b) => b.id));
    const parts = snap.topics[0].partitions.map((p) => layoutPartition(p, 600, up));
    expect(parts.every((t) => t.status === 'underReplicated')).toBe(true);
    const chip = parts[0].replicas.find((r) => r.broker === 2)!;
    expect(chip.role).toBe('out');
    expect(chip.up).toBe(false);
    expect(chip.text).toContain('остановлен');
    expect(parts.find((t) => t.partition === 1)!.leader).not.toBe(2);
    expect(brokerPills(snap).map((b) => b.text)).toContain('брокер 2: остановлен');
    expect(topicModels(snap)[0].underReplicated).toBe(3);
  });

  it('segments: records and gaps left by compaction are told apart', () => {
    const snap = fed().model.snapshot();
    const p = snap.topics[0].partitions.find((x) => x.leo >= 2)!;
    const leader = p.leader as number;
    const log = p.logs[leader];
    const compacted = { ...p, logs: { ...p.logs, [leader]: { ...log, segments: [{ base: 0, records: 1, bytes: 10, closed: true }, { base: p.leo, records: 0, bytes: 0, closed: false }] } } };
    const t = layoutPartition(compacted, 600);
    expect(t.segments[0].removed).toBe(p.leo - 1);
    expect(t.segments[1].removed).toBe(0);
  });
});

describe('groupModel', () => {
  const grouped = () => {
    const box = cluster(
      [
        `kafka-topics.sh ${BS} --create --topic orders --partitions 3 --replication-factor 3`,
        `kafka-console-producer.sh ${BS} --topic orders --property parse.key=true --property key.separator=: <<EOF\na:1\nb:2\nc:3\nEOF`,
        `kafka-console-consumer.sh ${BS} --topic orders --group readers --from-beginning --max-messages 1`,
      ].join('\n'),
    );
    return box.model.snapshot();
  };

  it('a group without members shows its partitions as orphans with the lag', () => {
    const g = groupModel(grouped().groups[0]);
    expect(g.id).toBe('readers');
    expect(g.lanes).toEqual([]);
    expect(g.orphans.map((o) => o.tp)).toEqual(['orders-0', 'orders-1', 'orders-2']);
    expect(g.totalLag).toBe(g.orphans.reduce((n, o) => n + (o.lag ?? 0), 0));
    expect(g.rebalancing).toBe(false);
    expect(g.stateText).toBe('нет участников');
  });

  it('members become lanes holding their partitions; the lag adds up', () => {
    const desc = grouped().groups[0];
    const member = { memberId: 'c1-1', clientId: 'c1', host: '/127.0.0.1', assignment: [{ topic: 'orders', partition: 0 }, { topic: 'orders', partition: 2 }] };
    const idle = { memberId: 'c2-1', clientId: 'c2', host: '/127.0.0.1', assignment: [] };
    const g = groupModel({
      ...desc,
      state: 'Stable',
      members: [member, idle],
      offsets: desc.offsets.map((o) => ({ ...o, memberId: o.partition === 1 ? null : 'c1-1', lag: 2, current: 1, logEnd: 3 })),
    });
    expect(g.lanes.map((l) => [l.title, l.items.map((i) => i.tp)])).toEqual([
      ['c1', ['orders-0', 'orders-2']],
      ['c2', []],
    ]);
    expect(g.lanes[0].lag).toBe(4);
    expect(g.orphans.map((o) => o.tp)).toEqual(['orders-1']);
    expect(g.totalLag).toBe(6);
    expect(g.lanes[0].items[0].done).toBeCloseTo(1 / 3);
    expect(groupModel({ ...desc, state: 'PreparingRebalance' }).rebalancing).toBe(true);
  });

  it('a partition assigned but not yet committed still appears, with an unknown lag', () => {
    const desc = grouped().groups[0];
    const g = groupModel({ ...desc, offsets: [], members: [{ memberId: 'm', clientId: '', host: 'h', assignment: [{ topic: 'orders', partition: 1 }] }] });
    expect(g.lanes[0].title).toBe('m');
    expect(g.lanes[0].items).toEqual([{ tp: 'orders-1', committed: null, logEnd: 0, lag: null, done: 0 }]);
    expect(g.totalLag).toBeNull();
  });
});
