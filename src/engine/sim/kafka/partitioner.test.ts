import { describe, expect, it } from 'vitest';
import { createRng } from '../../drill/rng';
import { keyPartition, StickyPartitioner } from './partitioner';
import { make, topic, val } from './harness';

describe('partitioner', () => {
  it('[key-partition] key to partition table for 3 and 6 partitions', () => {
    const table: [string, number, number][] = [
      ['abc', 0, 3],
      ['user-1', 2, 2],
      ['order-42', 0, 0],
      ['hello', 0, 3],
      ['user-2', 2, 2],
      ['a', 1, 4],
      ['key1', 2, 2],
      ['', 0, 3],
    ];
    for (const [key, p3, p6] of table) {
      expect(keyPartition(key, 3), key).toBe(p3);
      expect(keyPartition(key, 6), key).toBe(p6);
    }
  });

  it('[key-partition] a keyed record lands in the partition of its key', () => {
    const { model } = make();
    topic(model, 't', 3);
    const r = val(model.produce('t', [{ key: 'abc', value: 'x' }, { key: 'user-2', value: 'y' }]));
    expect(r.map((x) => x.partition)).toEqual([0, 2]);
  });

  it('[sticky-null] null keys stay on one partition until batch.size bytes, then move', () => {
    const p = new StickyPartitioner(createRng(7), 100);
    const seq: number[] = [];
    for (let i = 0; i < 40; i++) seq.push(p.next(6, 10));
    // 10 records of 10 bytes fill a 100-byte budget: runs of ten.
    for (let i = 0; i < 40; i += 10) expect(new Set(seq.slice(i, i + 10)).size).toBe(1);
    expect(new Set(seq).size).toBeGreaterThan(1);
  });

  it('[sticky-null] the choice comes from a seeded stream: same seed, same partitions', () => {
    const run = (seed: number): number[] => {
      const p = new StickyPartitioner(createRng(seed), 20);
      return Array.from({ length: 30 }, () => p.next(6, 10));
    };
    expect(run(3)).toEqual(run(3));
    expect(run(3)).not.toEqual(run(4));
  });

  it('[add-partitions] a key can move after the partition count grows, the count cannot shrink', () => {
    const { model } = make();
    topic(model, 't', 3);
    expect(keyPartition('a', 3)).toBe(1);
    val(model.alterPartitions('t', 6));
    expect(keyPartition('a', 6)).toBe(4);
    const r = val(model.produce('t', [{ key: 'a', value: 'x' }]));
    expect(r[0].partition).toBe(4);
    expect(model.alterPartitions('t', 4).ok).toBe(false);
    expect(model.alterPartitions('t', 6).ok).toBe(false);
  });
});
