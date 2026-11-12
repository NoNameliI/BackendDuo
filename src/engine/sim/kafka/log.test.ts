import { describe, expect, it } from 'vitest';
import { Log, recordSize } from './log';

const cfg = { segmentBytes: 30, segmentMs: 1e9 };
const rec = (ts: number, value = 'abcde', key: string | null = null) => ({ key, value, headers: [], timestamp: ts, size: recordSize(key, value, []), epoch: 0 });

describe('log', () => {
  it('[offset-monotonic] offsets grow by one, truncation does not reuse them for old data and the leader assigns them', () => {
    const log = new Log();
    const offs = [0, 1, 2, 3].map((i) => log.append(rec(i), cfg, i).offset);
    expect(offs).toEqual([0, 1, 2, 3]);
    expect(log.leo).toBe(4);
    expect(log.read(2, 10, 4).map((r) => r.offset)).toEqual([2, 3]);
    log.truncateTo(2);
    expect(log.leo).toBe(2);
    expect(log.append(rec(9), cfg, 9).offset).toBe(2);
  });

  it('[offset-monotonic] size of a record is key + value + headers in bytes', () => {
    expect(recordSize('ab', 'cde', [['h', 'xy']])).toBe(2 + 3 + 1 + 2);
    expect(recordSize(null, null, [])).toBe(0);
    expect(recordSize(null, 'я', [])).toBe(2);
  });

  it('[offset-monotonic] the active segment rolls by size and keeps base offsets', () => {
    const log = new Log();
    for (let i = 0; i < 14; i++) log.append(rec(i), cfg, i);
    expect(log.segments.map((s) => s.base)).toEqual([0, 6, 12]);
    expect(log.segments.map((s) => s.closed)).toEqual([true, true, false]);
  });

  it('[offset-monotonic] the active segment rolls by age (segment.ms)', () => {
    const log = new Log();
    const c = { segmentBytes: 1e9, segmentMs: 100 };
    log.append(rec(0), c, 0);
    log.append(rec(50), c, 50);
    log.append(rec(120), c, 120);
    expect(log.segments.map((s) => s.base)).toEqual([0, 2]);
  });
});
