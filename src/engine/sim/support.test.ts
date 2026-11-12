import { describe, expect, it } from 'vitest';
import { createJournal, JOURNAL_CAP } from './journal';
import { createMetrics, createRateMeter, MAX_POINTS, percentile } from './metrics';
import { rulesMarkdown } from './rules';

describe('journal', () => {
  it('numbers entries, filters and caps with one sim.limit', () => {
    const j = createJournal();
    j.add(5, { kind: 'publish', actor: 'a', msg: 'm1', subject: 'q', text: 'x' });
    j.add(9, { kind: 'drop', actor: 'b', msg: 'm2', text: 'y' });
    expect(j.entries().map((e) => e.seq)).toEqual([0, 1]);
    expect(j.filter({ msg: 'm2' })).toHaveLength(1);
    expect(j.filter({ kinds: ['publish'], actor: 'a', subject: 'q', from: 5, to: 5 })).toHaveLength(1);
    expect(j.filter({ important: true }).map((e) => e.kind)).toEqual(['drop']);
    for (let i = 0; i < JOURNAL_CAP + 10; i++) j.add(i, { kind: 'route', actor: 'a', text: 'z' });
    expect(j.entries()).toHaveLength(JOURNAL_CAP + 1);
    expect(j.entries()[JOURNAL_CAP].kind).toBe('sim.limit');
  });
});

describe('metrics', () => {
  it('thins to at most MAX_POINTS keeping spikes', () => {
    const m = createMetrics();
    for (let i = 0; i < 30_000; i++) m.record(i * 100, { x: i === 12_345 ? 99 : 1 });
    const s = m.get('x');
    expect(s?.points.length).toBeLessThan(MAX_POINTS);
    expect(Math.max(...(s?.points.map((p) => p[1]) ?? []))).toBe(99);
  });
  it('lists series sorted by id', () => {
    const m = createMetrics();
    m.record(0, { b: 1, a: 2 });
    expect(m.series().map((s) => s.id)).toEqual(['a', 'b']);
  });
  it('rate meter counts a sliding window', () => {
    const r = createRateMeter();
    for (const t of [0, 100, 200, 1500]) r.mark(t);
    const early = createRateMeter();
    for (const t of [0, 100, 200]) early.mark(t);
    expect(early.perSecond(300)).toBe(3);
    expect(r.perSecond(1500)).toBe(1);
  });
  it('percentile is nearest-rank', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe('rules', () => {
  it('renders a sorted markdown table', () => {
    const md = rulesMarkdown({ b: { url: 'u2', ru: 'второе', status: 'simplified' }, a: { url: 'u1', ru: 'первое', status: 'exact' } });
    expect(md.split('\n').slice(2)).toEqual(['| `a` | первое | точно | u1 |', '| `b` | второе | упрощено | u2 |']);
  });
});
