import { describe, expect, it } from 'vitest';
import { normalizeAnswer, sameAnswer, type AnswerSpec } from './answer';
import { fileName, toCsv, toText } from './data';
import { setSeeds } from './instance';
import { renderTemplate, TemplateError } from './render';
import { createRng, hashSeed, parseSeedHex, seedHex } from './rng';

const cp = String.fromCodePoint;
const BOM = cp(0xfeff);
const THIN = cp(0x2009);
const MINUS = cp(0x2212);
const int: AnswerSpec = { kind: 'int' };
const value = (input: string, spec: AnswerSpec) => {
  const n = normalizeAnswer(input, spec);
  return n.ok ? n.value : n.problem;
};

describe('rng', () => {
  it('is deterministic and forks are independent streams', () => {
    const a = createRng(7);
    const b = createRng(7);
    expect([a.next(), a.next(), a.int(1, 100)]).toEqual([b.next(), b.next(), b.int(1, 100)]);
    expect(createRng(7).fork('x').next()).toBe(createRng(7).fork('x').next());
    expect(createRng(7).fork('x').next()).not.toBe(createRng(7).fork('y').next());
  });

  it('draws unbiased integers within bounds and shuffles permutations', () => {
    const rng = createRng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rng.int(-3, 3));
    expect([...seen].sort((x, y) => x - y)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    expect(rng.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(() => rng.int(2, 1)).toThrow();
  });

  it('hashes seeds and shows them as 8 hex digits', () => {
    expect(hashSeed('a', 1)).toBe(hashSeed('a', 1));
    expect(hashSeed('a', 1)).not.toBe(hashSeed('a', 2));
    expect(seedHex(255)).toBe('000000ff');
    expect(parseSeedHex('000000FF')).toBe(255);
    expect(parseSeedHex('xyz')).toBeNull();
    const seeds = setSeeds(5, [1, 2]);
    expect(seeds[1]).toBe(hashSeed(5, 1));
  });
});

describe('answers', () => {
  it('normalizes integers', () => {
    expect(value('  12 ', int)).toBe('12');
    expect(value('012', int)).toBe('12');
    expect(value('1 000', int)).toBe('1000');
    expect(value('1 00', int)).toBe('format');
    expect(value(`${cp(0x2212)}5`, int)).toBe('-5');
    expect(value('-0', int)).toBe('0');
    expect(value('   ', int)).toBe('empty');
  });

  it('normalizes decimals, words and pairs', () => {
    expect(value('0,50', { kind: 'decimal' })).toBe('0.5');
    expect(value('5.', { kind: 'decimal' })).toBe('5');
    expect(value('x y z', { kind: 'word' })).toBe('XYZ');
    expect(value(String.fromCodePoint(0x425, 0x423) + 'Z', { kind: 'word', latin: true })).toBe('XYZ');
    expect(value('12;7', { kind: 'pair' })).toBe('12 7');
    expect(value('12', { kind: 'pair' })).toBe('format');
  });

  it('compares with null for a format problem', () => {
    expect(sameAnswer(' 007 ', '7', int)).toBe(true);
    expect(sameAnswer('8', '7', int)).toBe(false);
    expect(sameAnswer('abc', '7', int)).toBeNull();
  });
});

describe('templates', () => {
  const scope = {
    n: 3,
    big: '12345678',
    name: 'ab',
    list: [1, 2, 3],
    items: [{ c: 3, b: 16, e: 2020 }, { c: -1, b: 1, e: 0 }, { c: -5, b: 1, e: 0 }],
    rows: [{ k: 'x' }, { k: 'y' }],
    empty: [] as string[],
  };

  it('prints paths and every filter', () => {
    expect(renderTemplate('{{n}} {{list.1}} {{name|code}}', scope)).toBe('3 2 `ab`');
    expect(renderTemplate('{{n|sub}} {{n|sup}} {{n|radix:2}} {{big|num}}', scope)).toBe([cp(0x2083), cp(0xb3), '11', ['12', '345', '678'].join(THIN)].join(' '));
    expect(renderTemplate('{{list|join:", "}}', scope)).toBe('1, 2, 3');
    expect(renderTemplate('{{n|plural:one,few,many}} {{big|plural:one,few,many}}', scope)).toBe('few many');
    expect(renderTemplate('{{items|expr}}', scope)).toBe(`3${cp(0xb7)}16${[0xb2, 0x2070, 0xb2, 0x2070].map((c) => cp(c)).join('')} ${MINUS} 1 ${MINUS} 5`);
  });

  it('handles blocks', () => {
    expect(renderTemplate('{{#each rows}}{{@n}}={{k}};{{/each}}', scope)).toBe('1=x;2=y;');
    expect(renderTemplate('{{#each list}}{{.}}{{/each}}', scope)).toBe('123');
    expect(renderTemplate('{{#if empty}}a{{else}}b{{/if}}{{#unless n}}c{{else}}d{{/unless}}', scope)).toBe('bd');
    expect(renderTemplate('{{#each rows}}{{n}}{{k}}{{/each}}', scope)).toBe('3x3y');
  });

  it('is strict', () => {
    for (const bad of ['{{nope}}', '{{n.deep}}', '{{n|nope}}', '{{#if n}}x', '{{/if}}', '{{list}}', '{{else}}', '{{.}}', '{{n|radix:99}}']) {
      expect(() => renderTemplate(bad, scope), bad).toThrow(TemplateError);
    }
  });
});

describe('data files', () => {
  it('writes CSV with BOM, CRLF, quoting and decimal commas', () => {
    const csv = toCsv({ key: 't1', columns: ['c1', 'c2'], rows: [['a;b', 1.5], ['say "hi"', 2], ['two\nlines', 3]] }, { 't1.c1': 'Name' });
    expect(csv).toBe(`${BOM}Name;c2\r\n"a;b";1,5\r\n"say ""hi""";2\r\n"two\nlines";3\r\n`);
  });

  it('writes plain text and names files', () => {
    expect(toText(`${BOM}a\r\nb\rc`)).toBe('a\nb\nc');
    expect(fileName(14, 255, 'csv', 't2')).toBe('14_000000ff_t2.csv');
    expect(fileName(14, 255, 'txt')).toBe('14_000000ff.txt');
  });
});
