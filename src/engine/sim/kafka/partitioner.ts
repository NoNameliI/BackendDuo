import type { Rng } from '../../drill/types';
import { murmur2String, toPositive } from './murmur2';

/** Keyed records: toPositive(murmur2(key bytes)) % numPartitions. */
export function keyPartition(key: string, partitions: number): number {
  return toPositive(murmur2String(key)) % partitions;
}

/**
 * Built-in sticky partitioner for null keys: one partition until `batchSize` bytes went to it, then a random one.
 * Simplified: the switch happens as soon as the byte budget is spent (adaptive weighting is off).
 */
export class StickyPartitioner {
  private current = -1;
  private produced = 0;
  constructor(
    private readonly rng: Rng,
    private readonly batchSize: number,
  ) {}

  /** `available` lists partitions with a leader; falls back to all partitions when none is available. */
  next(partitions: number, bytes: number, available?: readonly number[]): number {
    const pool = available && available.length > 0 ? available : undefined;
    if (this.current < 0 || this.current >= partitions || (pool && !pool.includes(this.current))) {
      this.current = pool ? this.rng.pick(pool) : this.rng.int(0, partitions - 1);
      this.produced = 0;
    }
    const chosen = this.current;
    this.produced += bytes;
    if (this.produced >= this.batchSize) this.current = -1;
    return chosen;
  }
}
