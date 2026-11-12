import { describe, expect, it } from 'vitest';
import { parseConfigList, parseDatetime, parseDuration, parseIsoDuration, parseOpts, renderColumns, SIM_EPOCH_MS, UsageError, type OptDef } from './format';

const defs: OptDef[] = [
  { key: 'topic', long: '--topic', kind: 'value' },
  { key: 'topics-with-overrides', long: '--topics-with-overrides', kind: 'switch' },
  { key: 'shift-by', long: '--shift-by', kind: 'value' },
  { key: 'execute', long: '--execute', kind: 'switch' },
];

describe('parseOpts', () => {
  it('takes values, = form, negative numbers, switches and keeps other words', () => {
    const { opts, rest } = parseOpts(['--topic=a', '--shift-by', '-2', '--execute', 'word'], defs);
    expect(opts.value('topic')).toBe('a');
    expect(opts.value('shift-by')).toBe('-2');
    expect(opts.has('execute')).toBe(true);
    expect(rest).toEqual(['word']);
  });
  it('exact name beats a longer one, unique prefix works, errors read like jopt', () => {
    expect(parseOpts(['--topic', 'x'], defs).opts.value('topic')).toBe('x');
    expect(parseOpts(['--exe'], defs).opts.has('execute')).toBe(true);
    expect(() => parseOpts(['--nope'], defs)).toThrow('nope is not a recognized option');
    expect(() => parseOpts(['--topic'], defs)).toThrow('Option [topic] requires an argument');
    expect(() => parseOpts(['--topic', 'a'], defs).opts.required('shift-by')).toThrow(UsageError);
  });
});

describe('helpers', () => {
  it('config lists keep bracketed commas', () => {
    expect(parseConfigList('a=1,b=[x,y],c=')).toEqual([
      ['a', '1'],
      ['b', 'x,y'],
      ['c', ''],
    ]);
    expect(() => parseConfigList('oops')).toThrow(UsageError);
  });
  it('durations and dates', () => {
    expect(parseDuration('10s')).toBe(10000);
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('x')).toBeNull();
    expect(parseIsoDuration('PT1H30M')).toBe(5400000);
    expect(parseIsoDuration('P1DT2S')).toBe(86402000);
    expect(parseIsoDuration('PT')).toBeNull();
    expect(parseDatetime('2026-01-01T00:00:01.500')).toBe(1500);
    expect(parseDatetime('2026-01-01T01:00:00.000+01:00')).toBe(0);
    expect(parseDatetime('yesterday')).toBeNull();
    expect(SIM_EPOCH_MS).toBe(Date.UTC(2026, 0, 1));
  });
  it('columns grow with data and the last one is not padded', () => {
    expect(renderColumns(['A', 'B'], [['xxxxx', '1']], [3, 0])).toEqual(['A     B', 'xxxxx 1']);
  });
});
