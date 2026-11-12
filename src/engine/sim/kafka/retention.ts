import type { KRecord, Log } from './log';

export interface RetentionCfg {
  /** -1 = unlimited */
  retentionMs: number;
  /** -1 = unlimited, per partition */
  retentionBytes: number;
}

export interface RetentionResult {
  segments: number;
  records: number;
  bytes: number;
  logStart: number;
  reason: 'time' | 'bytes' | 'both';
}

/**
 * Deletes whole closed segments, oldest first: by the segment's largest timestamp (retention.ms) or while the
 * partition is above retention.bytes. The active segment is never touched.
 */
export function applyRetention(log: Log, now: number, cfg: RetentionCfg): RetentionResult | null {
  let timeCut = 0;
  let byteCut = 0;
  let records = 0;
  let bytes = 0;
  const drop = (): void => {
    const s = log.segments.shift();
    if (!s) return;
    records += s.records.length;
    bytes += s.bytes;
  };
  const closed = (): boolean => log.segments.length > 1;
  if (cfg.retentionMs >= 0) {
    while (closed() && log.segments[0].records.length > 0 && log.segments[0].maxTs < now - cfg.retentionMs) {
      drop();
      timeCut++;
    }
  }
  if (cfg.retentionBytes >= 0) {
    // UnifiedLog.deleteRetentionSizeBreachedSegments: a segment goes only if the partition stays at or above retention.bytes without it.
    let diff = log.totalBytes() - cfg.retentionBytes;
    while (diff > 0 && closed() && diff - log.segments[0].bytes >= 0) {
      diff -= log.segments[0].bytes;
      drop();
      byteCut++;
    }
  }
  if (timeCut + byteCut === 0) return null;
  log.logStart = Math.max(log.logStart, log.segments[0].base);
  return { segments: timeCut + byteCut, records, bytes, logStart: log.logStart, reason: timeCut && byteCut ? 'both' : timeCut ? 'time' : 'bytes' };
}

export interface CompactCfg {
  minCleanableDirtyRatio: number;
  minCompactionLagMs: number;
  /** Infinity = unlimited */
  maxCompactionLagMs: number;
  deleteRetentionMs: number;
}

export interface CompactResult {
  removed: number;
  tombstonesRemoved: number;
  tombstonesMarked: number;
  cleanedTo: number;
}

/**
 * One cleaner pass: in the cleanable closed segments only the last record per key survives; offsets do not change.
 * Tombstones stay for delete.retention.ms after the pass that first found them. Returns null when the log is not due.
 * Timing of the real cleaner thread is simplified: the model calls this on a fixed interval.
 */
export function compactLog(log: Log, now: number, cfg: CompactCfg): CompactResult | null {
  let end = 0;
  while (end < log.segments.length - 1) {
    const s = log.segments[end];
    if (cfg.minCompactionLagMs > 0 && s.maxTs > now - cfg.minCompactionLagMs) break;
    end++;
  }
  const cleanable = log.segments.slice(0, end);
  if (cleanable.length === 0) return null;
  let dirty = 0;
  let clean = 0;
  let oldestDirty = Infinity;
  for (const s of cleanable) {
    if (s.base >= log.cleanedTo) {
      dirty += s.bytes;
      oldestDirty = Math.min(oldestDirty, s.firstTs);
    } else clean += s.bytes;
  }
  const dueTomb = cleanable.some((s) => s.records.some((r) => r.horizon !== undefined && now >= r.horizon));
  if (dirty === 0 && !dueTomb) return null;
  const forced = dueTomb || (Number.isFinite(cfg.maxCompactionLagMs) && oldestDirty < now - cfg.maxCompactionLagMs);
  if (!forced && dirty / (clean + dirty) < cfg.minCleanableDirtyRatio) return null;

  const last = new Map<string, number>();
  for (const s of cleanable) for (const r of s.records) if (r.key !== null) last.set(r.key, r.offset);
  let removed = 0;
  let tombstonesRemoved = 0;
  let tombstonesMarked = 0;
  for (const s of cleanable) {
    const keep: KRecord[] = [];
    for (const r of s.records) {
      if (r.key !== null && last.get(r.key) !== r.offset) {
        removed++;
        continue;
      }
      if (r.key !== null && r.value === null) {
        if (r.horizon === undefined) {
          r.horizon = now + cfg.deleteRetentionMs;
          tombstonesMarked++;
        }
        if (now >= r.horizon) {
          removed++;
          tombstonesRemoved++;
          continue;
        }
      }
      keep.push(r);
    }
    s.records = keep;
  }
  const to = log.segments[end].base;
  log.tidy();
  log.cleanedTo = to;
  return { removed, tombstonesRemoved, tombstonesMarked, cleanedTo: log.cleanedTo };
}
