import { utf8 } from './murmur2';

export type Header = [string, string];

export interface KRecord {
  offset: number;
  key: string | null;
  value: string | null;
  headers: Header[];
  timestamp: number;
  /** key + value + headers in bytes */
  size: number;
  /** Leader epoch the record was written in. */
  epoch: number;
  /** Journal id of the produced message. */
  msg?: string;
  /** Producer-side message number (scenario actors). */
  n?: number;
  pid?: number;
  seq?: number;
  /** Tombstone: time after which the cleaner may drop it. */
  horizon?: number;
}

export interface Segment {
  base: number;
  records: KRecord[];
  bytes: number;
  closed: boolean;
  firstTs: number;
  /** Largest record timestamp in the segment. */
  maxTs: number;
}

export interface RollCfg {
  segmentBytes: number;
  segmentMs: number;
}

export function recordSize(key: string | null, value: string | null, headers: Header[]): number {
  let n = (key === null ? 0 : utf8(key).length) + (value === null ? 0 : utf8(value).length);
  for (const [k, v] of headers) n += utf8(k).length + utf8(v).length;
  return n;
}

const fresh = (base: number): Segment => ({ base, records: [], bytes: 0, closed: false, firstTs: 0, maxTs: 0 });

/** One replica's partition log: segments, log start offset, log end offset. Offsets are never reused. */
export class Log {
  segments: Segment[] = [fresh(0)];
  leo = 0;
  /** Everything below this offset went through the cleaner. */
  cleanedTo = 0;

  /** First offset still readable; moves only by retention (compaction keeps it). */
  logStart = 0;
  get active(): Segment {
    return this.segments[this.segments.length - 1];
  }

  /** Appends at the end; the leader assigns the offset. Rolls the active segment by size or age first. */
  append(rec: Omit<KRecord, 'offset'>, cfg: RollCfg, now: number, offset?: number): KRecord {
    if (offset !== undefined && offset > this.leo) this.leo = offset;
    let seg = this.active;
    if (seg.records.length > 0 && (seg.bytes + rec.size > cfg.segmentBytes || now - seg.firstTs >= cfg.segmentMs)) {
      seg.closed = true;
      seg = fresh(this.leo);
      this.segments.push(seg);
    }
    const r: KRecord = { ...rec, offset: this.leo };
    if (seg.records.length === 0) {
      seg.firstTs = rec.timestamp;
      seg.maxTs = rec.timestamp;
    } else if (rec.timestamp > seg.maxTs) seg.maxTs = rec.timestamp;
    seg.records.push(r);
    seg.bytes += rec.size;
    this.leo = r.offset + 1;
    return r;
  }

  /** Empties the log and restarts it at `offset` (a follower far behind the leader's log start). */
  resetTo(offset: number): void {
    this.segments = [fresh(offset)];
    this.leo = offset;
    this.logStart = offset;
    this.cleanedTo = offset;
  }

  /** Records with offset >= from and < limit, at most `max`. */
  read(from: number, max: number, limit: number): KRecord[] {
    const out: KRecord[] = [];
    for (const s of this.segments) {
      if (s.records.length === 0) continue;
      if (s.records[s.records.length - 1].offset < from) continue;
      for (const r of s.records) {
        if (r.offset < from) continue;
        if (r.offset >= limit || out.length >= max) return out;
        out.push(r);
      }
    }
    return out;
  }

  all(): KRecord[] {
    return this.segments.flatMap((s) => s.records);
  }

  totalBytes(): number {
    return this.segments.reduce((n, s) => n + s.bytes, 0);
  }

  /** Drops records at offset >= `offset` (follower truncation); returns them. */
  truncateTo(offset: number): KRecord[] {
    if (offset >= this.leo) return [];
    const removed: KRecord[] = [];
    for (const s of this.segments) {
      const keep = s.records.filter((r) => r.offset < offset);
      removed.push(...s.records.filter((r) => r.offset >= offset));
      s.records = keep;
      s.bytes = keep.reduce((n, r) => n + r.size, 0);
    }
    while (this.segments.length > 1 && (this.active.records.length === 0 || this.active.base >= offset)) this.segments.pop();
    this.active.closed = false;
    this.leo = offset;
    if (this.logStart > offset) this.logStart = offset;
    if (this.cleanedTo > offset) this.cleanedTo = offset;
    return removed;
  }

  lastEpoch(): number {
    const a = this.all();
    return a.length ? a[a.length - 1].epoch : -1;
  }

  /** End offset of `epoch`: first offset of a later epoch, or the log end (KIP-101 truncation point). */
  endOffsetForEpoch(epoch: number): number {
    for (const r of this.all()) if (r.epoch > epoch) return r.offset;
    return this.leo;
  }

  /** First offset with timestamp >= ts, or leo. */
  offsetForTime(ts: number): number {
    for (const r of this.all()) if (r.timestamp >= ts) return r.offset;
    return this.leo;
  }

  /** Removes empty closed segments and recomputes statistics after retention or compaction. */
  tidy(): void {
    this.segments = this.segments.filter((s, i) => i === this.segments.length - 1 || s.records.length > 0);
    for (const s of this.segments) s.bytes = s.records.reduce((n, r) => n + r.size, 0);
  }

  snapshot(): LogSnapshot {
    return {
      logStart: this.logStart,
      leo: this.leo,
      segments: this.segments.map((s) => ({ base: s.base, records: s.records.length, bytes: s.bytes, closed: s.closed })),
    };
  }
}

export interface LogSnapshot {
  logStart: number;
  leo: number;
  segments: { base: number; records: number; bytes: number; closed: boolean }[];
}
