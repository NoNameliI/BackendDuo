import { describe, expect, it } from 'vitest';
import { errCode, make, topic, val } from './harness';

const offsets = (m: ReturnType<typeof make>['model']): number[] => m.partitionOf('t', 0)?.leaderLog?.all().map((r) => r.offset) ?? [];

describe('retention', () => {
  it('[closed-segments-only] closed segments older than retention.ms go, the active one stays even when old', () => {
    const { model, sim } = make();
    topic(model, 't', 1, 3, { 'segment.bytes': '40', 'retention.ms': '10000' });
    val(model.produce('t', Array.from({ length: 10 }, (_, i) => ({ key: 'k', value: `${i}`.padStart(9, 'x') }))));
    expect(offsets(model)).toHaveLength(10);
    model.advance(20000);
    expect(offsets(model)).toEqual([8, 9]);
    expect(val(model.describeTopic('t')).partitions[0].logStart).toBe(8);
    expect(sim.journal.filter({ kinds: ['retention'] })[0].rule).toBe('closed-segments-only');
  });

  it('[closed-segments-only] retention.bytes deletes the oldest closed segments', () => {
    const { model } = make();
    topic(model, 't', 1, 3, { 'segment.bytes': '40', 'retention.bytes': '60' });
    val(model.produce('t', Array.from({ length: 10 }, (_, i) => ({ value: `${i}`.padStart(10, 'x') }))));
    model.advance(6000);
    // Segments of 4 records (40 bytes): [0-3] [4-7] [8-9 active]; 100 bytes in total, 60 allowed.
    expect(offsets(model)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it('[closed-segments-only] a segment goes only while the excess over retention.bytes covers it entirely', () => {
    const { model } = make();
    topic(model, 't', 1, 3, { 'segment.bytes': '40', 'retention.bytes': '50' });
    val(model.produce('t', Array.from({ length: 10 }, (_, i) => ({ value: `${i}`.padStart(10, 'x') }))));
    model.advance(6000);
    // 100 bytes, 50 allowed: excess 50 covers the first segment (40), the remaining 10 does not cover the second.
    expect(offsets(model)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it('[closed-segments-only] young segments stay and followers apply retention to their own copy', () => {
    const { model } = make();
    topic(model, 't', 1, 3, { 'segment.bytes': '40', 'retention.ms': '10000' });
    val(model.produce('t', Array.from({ length: 6 }, (_, i) => ({ value: `${i}`.padStart(10, 'x') }))));
    model.advance(5000);
    expect(offsets(model)).toHaveLength(6);
    model.advance(20000);
    expect(model.partitionOf('t', 0)?.reps.get(2)?.log.all().map((r) => r.offset)).toEqual([4, 5]);
  });

  it('[closed-segments-only] a consumer behind the log start follows auto.offset.reset', () => {
    const { model } = make();
    topic(model, 't', 1, 3, { 'segment.bytes': '40', 'retention.ms': '10000' });
    val(model.produce('t', Array.from({ length: 10 }, (_, i) => ({ value: `${i}`.padStart(10, 'x') }))));
    const r = val(model.consume({ topic: 't', partition: 0, offset: 0 }));
    expect(r.records).toHaveLength(10);
    model.advance(20000);
    const c = model.consumer('c', {});
    c.assign([{ topic: 't', partition: 0 }]);
    c.seek({ topic: 't', partition: 0 }, 1);
    expect(c.poll(100)).toEqual([]);
    expect(c.raw.position({ topic: 't', partition: 0 })).toBe(10);
  });
});

describe('compaction', () => {
  const cfg = { 'cleanup.policy': 'compact', 'segment.bytes': '12', 'min.cleanable.dirty.ratio': '0.01', 'delete.retention.ms': '10000' };
  const put = (m: ReturnType<typeof make>['model'], rows: [string, string | null][]): void => {
    val(m.produce('t', rows.map(([key, value]) => ({ key, value }))));
  };

  it('[compaction-last-value] the last record of each key survives, offsets do not change', () => {
    const { model, sim } = make();
    topic(model, 't', 1, 3, cfg);
    put(model, [['a', 'v1'], ['b', 'v1'], ['a', 'v2'], ['b', 'v2'], ['a', 'v3'], ['c', 'v1'], ['b', 'v3'], ['c', 'v2'], ['a', 'v4']]);
    model.advance(20000);
    expect(offsets(model)).toEqual([4, 6, 7, 8]);
    const kept = model.partitionOf('t', 0)?.leaderLog?.all().map((r) => `${r.key}:${r.value}`);
    expect(kept).toEqual(['a:v3', 'b:v3', 'c:v2', 'a:v4']);
    expect(sim.journal.filter({ kinds: ['compact'] })[0].rule).toBe('compaction-last-value');
    expect(val(model.describeTopic('t')).partitions[0].logStart).toBe(0);
  });

  it('[compaction-last-value] the active segment is not compacted and keyless records are refused', () => {
    const { model } = make();
    topic(model, 't', 1, 3, cfg);
    put(model, [['a', 'v1'], ['a', 'v2']]);
    model.advance(40000);
    expect(offsets(model)).toEqual([0, 1]);
    const r = val(model.produce('t', [{ value: 'nokey' }], { retries: 0 }));
    expect(r[0].error?.code).toBe(87);
  });

  it('[compaction-last-value] the cleaner waits for min.cleanable.dirty.ratio', () => {
    const { model } = make();
    topic(model, 't', 1, 3, { ...cfg, 'min.cleanable.dirty.ratio': '0.9' });
    put(model, [['a', 'v1'], ['b', 'v1'], ['a', 'v2'], ['b', 'v2'], ['a', 'v3']]);
    model.advance(20000);
    // Everything closed is still dirty (ratio 1.0 >= 0.9): compaction runs; a clean prefix would raise the bar next time.
    expect(offsets(model)).toEqual([2, 3, 4]);
    put(model, [['x', 'v1'], ['y', 'v1'], ['z', 'v1'], ['x', 'v2']]);
    model.advance(20000);
    expect(offsets(model).length).toBeGreaterThan(3);
  });

  it('[tombstone] a tombstone survives the first pass and disappears after delete.retention.ms', () => {
    const { model, sim } = make();
    topic(model, 't', 1, 3, cfg);
    put(model, [['a', 'v1'], ['a', null], ['b', 'v1'], ['c', 'v1'], ['d', 'v1']]);
    model.advance(16000);
    const live = model.partitionOf('t', 0)?.leaderLog?.all().map((r) => `${r.key}:${r.value}`);
    expect(live).toContain('a:null');
    expect(live).not.toContain('a:v1');
    model.advance(30000);
    const later = model.partitionOf('t', 0)?.leaderLog?.all().map((r) => `${r.key}:${r.value}`);
    expect(later).not.toContain('a:null');
    expect(sim.journal.filter({ kinds: ['compact'] }).some((e) => e.rule === 'tombstone')).toBe(true);
  });

  it('[tombstone] topic configs are validated', () => {
    const { model } = make();
    expect(errCode(model.createTopic({ name: 'bad', configs: { 'retention.ms': 'abc' } }))).toBe(40);
    expect(errCode(model.createTopic({ name: 'bad', configs: { nonsense: '1' } }))).toBe(40);
    expect(errCode(model.createTopic({ name: 'ok', configs: { 'cleanup.policy': 'compact' } }))).toBe(0);
  });
});
