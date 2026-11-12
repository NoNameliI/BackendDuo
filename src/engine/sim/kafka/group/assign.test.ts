import { describe, expect, it } from 'vitest';
import { createRng } from '../../../drill/rng';
import { chooseStrategy, cooperativeSticky, range, roundRobin, sticky, type Assignment, type Member, type TP } from './index';

const tp = (s: string): TP => ({ topic: s.slice(0, s.indexOf('p')), partition: Number(s.slice(s.indexOf('p') + 1)) });
const L = (...s: string[]): TP[] => s.map(tp);
const names = (a: Assignment): Record<string, string[]> =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.map((x) => `${x.topic}p${x.partition}`)]));

describe('partition assignors', () => {
  it('[range-example] early consumers accumulate extras', () => {
    const r = range([{ id: 'C1', topics: ['t0', 't1'] }, { id: 'C0', topics: ['t0', 't1'] }], { t0: 3, t1: 3 });
    expect(names(r)).toEqual({ C0: ['t0p0', 't0p1', 't1p0', 't1p1'], C1: ['t0p2', 't1p2'] });
  });

  it('[roundrobin-examples] equal and differing subscriptions', () => {
    const a = roundRobin([{ id: 'C0', topics: ['t0', 't1'] }, { id: 'C1', topics: ['t0', 't1'] }], { t0: 3, t1: 3 });
    expect(names(a)).toEqual({ C0: ['t0p0', 't0p2', 't1p1'], C1: ['t0p1', 't1p0', 't1p2'] });
    const b = roundRobin(
      [{ id: 'C0', topics: ['t0'] }, { id: 'C1', topics: ['t0', 't1'] }, { id: 'C2', topics: ['t0', 't1', 't2'] }],
      { t0: 1, t1: 2, t2: 3 },
    );
    expect(names(b)).toEqual({ C0: ['t0p0'], C1: ['t1p0'], C2: ['t1p1', 't2p0', 't2p1', 't2p2'] });
  });

  it('[sticky-goals] balance first, then keep owned (C1 leaves)', () => {
    const topics = ['t0', 't1', 't2', 't3'];
    const parts = { t0: 2, t1: 2, t2: 2, t3: 2 };
    const members: Member[] = [
      { id: 'C0', topics, owned: L('t0p0', 't1p1', 't3p0') },
      { id: 'C2', topics, owned: L('t1p0', 't2p1') },
    ];
    const r = sticky(members, parts);
    expect(names(r)).toEqual({ C0: ['t0p0', 't1p1', 't2p0', 't3p0'], C2: ['t0p1', 't1p0', 't2p1', 't3p1'] });
    const fresh = sticky([{ id: 'C0', topics }, { id: 'C1', topics }, { id: 'C2', topics }], parts);
    expect(Object.values(fresh).map((v) => v.length).sort()).toEqual([2, 3, 3]);
  });

  it('[coop-two-waves] revoke moved partitions first, target afterwards', () => {
    const topics = ['t0', 't1'];
    const members: Member[] = [
      { id: 'C0', topics, owned: L('t0p0', 't0p1', 't1p0', 't1p1') },
      { id: 'C1', topics },
    ];
    const { revoke, target } = cooperativeSticky(members, { t0: 2, t1: 2 });
    expect(Object.values(target).map((v) => v.length)).toEqual([2, 2]);
    expect(revoke.C0).toHaveLength(2);
    expect(revoke.C1).toEqual([]);
    for (const t of revoke.C0) expect(target.C1).toContainEqual(t);
    for (const t of target.C0) expect(revoke.C0).not.toContainEqual(t);
  });

  it('[default-strategy] [Range, CooperativeSticky] picks range', () => {
    expect(chooseStrategy([['range', 'cooperative-sticky'], ['range', 'cooperative-sticky']])).toBe('range');
    expect(chooseStrategy([['cooperative-sticky', 'sticky'], ['sticky']])).toBe('sticky');
    expect(chooseStrategy([['range'], ['sticky']])).toBeNull();
    expect(chooseStrategy([])).toBeNull();
  });

  it('property checks on 200 seeded random cases', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = createRng(seed);
      const topicNames = ['a', 'b', 'c', 'd'].slice(0, rng.int(1, 4));
      const parts: Record<string, number> = {};
      for (const t of topicNames) parts[t] = rng.int(1, 7);
      const n = rng.int(1, 6);
      const mixed: Member[] = Array.from({ length: n }, (_, i) => ({
        id: `m${i}`,
        topics: topicNames.filter(() => rng.chance(0.6)),
      }));
      const same: Member[] = Array.from({ length: n }, (_, i) => ({ id: `m${i}`, topics: topicNames }));
      const prev = sticky(same, parts);
      const withOwned: Member[] = same.slice(0, Math.max(1, n - 1)).map((m) => ({ ...m, owned: prev[m.id] }));
      const cases = [
        ['range', range, mixed, false],
        ['roundRobin', roundRobin, mixed, false],
        ['sticky', sticky, mixed, false],
        ['roundRobin', roundRobin, same, true],
        ['sticky', sticky, same, true],
        ['sticky owned', sticky, withOwned, true],
      ] as const;
      for (const [label, fn, ms, balanced] of cases) {
        const r = fn(ms, parts);
        const seen = new Set<string>();
        for (const m of ms) {
          expect(r[m.id], `${label} ${seed}`).toBeDefined();
          for (const x of r[m.id]) {
            expect(m.topics, `${label} ${seed}`).toContain(x.topic);
            const k = `${x.topic}/${x.partition}`;
            expect(seen.has(k), `${label} ${seed} dup`).toBe(false);
            seen.add(k);
          }
        }
        const expected = topicNames.filter((t) => ms.some((m) => m.topics.includes(t))).reduce((s, t) => s + parts[t], 0);
        expect(seen.size, `${label} ${seed}`).toBe(expected);
        if (balanced) {
          const sizes = ms.map((m) => r[m.id].length);
          expect(Math.max(...sizes) - Math.min(...sizes), `${label} ${seed}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
