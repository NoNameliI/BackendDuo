/**
 * g08: counting and numbering words of a fixed length over an ordered alphabet. Answer: int.
 * Shapes: `count`, `rank`, `first`.
 *
 * Words obey a list of rules: all letters different; no two equal neighbours; a letter occurs exactly / at most /
 * at least n times; some letters cannot be first / last; letter a is never directly followed by b.
 *   count: how many valid words exist.
 *   rank:  valid words are listed alphabetically; the place of a given word (1-based).
 *   first: the place of the first listed word that begins with a given letter.
 * solve: automaton over the rules with memoized completion counts (shared/words.ts); rank sums the completions
 * of every smaller letter at each position.
 *   base: 4-5 letters, length 4, one rule.  core: 5-6 letters, length 5, two rules.
 *   hard: 6-7 letters, length 6, three rules (words are listed by the brute force, so size^length <= 120000).
 *   Reject: fewer than 10 valid words, rules that remove nothing, no valid sample word, rank 1 or last place.
 */
import { Reject, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';
import { wordCounter, type Machine } from './shared/words';

export type Rule =
  | { kind: 'distinct' }
  | { kind: 'noRepeat' }
  | { kind: 'count'; op: 'eq' | 'le' | 'ge'; letter: number; n: number }
  | { kind: 'notFirst'; letters: number[] }
  | { kind: 'notLast'; letters: number[] }
  | { kind: 'noPair'; a: number; b: number };

export type P08 = {
  shape: 'count' | 'rank' | 'first';
  letters: string[];
  length: number;
  rules: Rule[];
  word: number[];
  target: number;
};

type St = { last: number; used: number; counts: number[] };

function machineOf(p: Pick<P08, 'letters' | 'length' | 'rules'>): Machine<St> {
  const counted = p.rules.filter((r): r is Extract<Rule, { kind: 'count' }> => r.kind === 'count');
  const has = (k: Rule['kind']) => p.rules.some((r) => r.kind === k);
  const trackLast = has('noRepeat') || has('noPair');
  const trackUsed = has('distinct');
  return {
    init: { last: -1, used: 0, counts: counted.map(() => 0) },
    step(s, c, pos) {
      for (const r of p.rules) {
        if (r.kind === 'noRepeat' && c === s.last) return null;
        if (r.kind === 'distinct' && (s.used >> c) & 1) return null;
        if (r.kind === 'notFirst' && pos === 0 && r.letters.includes(c)) return null;
        if (r.kind === 'notLast' && pos === p.length - 1 && r.letters.includes(c)) return null;
        if (r.kind === 'noPair' && s.last === r.a && c === r.b) return null;
      }
      const counts = s.counts.slice();
      for (let i = 0; i < counted.length; i++) {
        if (counted[i].letter === c) counts[i]++;
        if (counted[i].op !== 'ge' && counts[i] > counted[i].n) return null;
      }
      return { last: c, used: s.used | (1 << c), counts };
    },
    accept: (s) =>
      counted.every((r, i) => (r.op === 'eq' ? s.counts[i] === r.n : r.op === 'ge' ? s.counts[i] >= r.n : true)),
    key: (s) => `${trackLast ? s.last : 0}.${trackUsed ? s.used : 0}.${s.counts.join(',')}`,
  };
}

function solve08(p: P08): Solved {
  const size = p.letters.length;
  const counter = wordCounter(machineOf(p), size, p.length);
  const total = counter.count();
  if (total < 10) throw new Reject('too few words');
  if (total === size ** p.length) throw new Reject('rules remove nothing');
  if (p.shape === 'count') {
    const byFirst = p.letters.map((letter, c) => ({ letter, count: counter.prefix([c]) }));
    return { answer: String(total), steps: { byFirst, total } };
  }
  if (p.shape === 'first') {
    let before = 0;
    const smaller: { letter: string; count: number }[] = [];
    for (let c = 0; c < p.target; c++) {
      const k = counter.prefix([c]);
      before += k;
      smaller.push({ letter: p.letters[c], count: k });
    }
    if (counter.prefix([p.target]) === 0) throw new Reject('no word begins with the letter');
    if (before === 0) throw new Reject('trivial');
    return { answer: String(before + 1), steps: { smaller, smallerCounted: smaller.filter((x) => x.count > 0), before, total, targetCount: counter.prefix([p.target]) } };
  }
  const place = counter.rank(p.word);
  if (place === 0) throw new Reject('word is not valid');
  if (place === 1 || place === total) throw new Reject('trivial place');
  const m = machineOf(p);
  const perPosition: { pos: number; letter: string; smaller: string[]; parts: { letter: string; count: number }[]; hasParts: boolean; added: number }[] = [];
  let s: St = m.init;
  let before = 0;
  p.word.forEach((c, i) => {
    let added = 0;
    const smallerLetters: string[] = [];
    const parts: { letter: string; count: number }[] = [];
    for (let d = 0; d < c; d++) {
      const n = m.step(s, d, i);
      if (n !== null) {
        const k = counter.completions(n, i + 1);
        if (k > 0) {
          smallerLetters.push(p.letters[d]);
          parts.push({ letter: p.letters[d], count: k });
        }
        added += k;
      }
    }
    before += added;
    perPosition.push({ pos: i + 1, letter: p.letters[c], smaller: smallerLetters, parts, hasParts: parts.length > 0, added });
    s = m.step(s, c, i)!;
  });
  return { answer: String(place), steps: { perPosition, before, total, place } };
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function randomRule(rng: Rng, size: number, level: Level): Rule {
  const letter = () => rng.int(0, size - 1);
  const subset = () => rng.shuffle(Array.from({ length: size }, (_, i) => i)).slice(0, rng.int(1, 2)).sort((a, b) => a - b);
  const r = rng.next();
  if (r < 0.2) return { kind: 'noRepeat' };
  if (r < 0.5) {
    const op = level === 'base' ? rng.pick(['eq', 'le'] as const) : rng.pick(['eq', 'le', 'ge'] as const);
    return { kind: 'count', op, letter: letter(), n: op === 'ge' ? 1 : rng.int(1, 2) };
  }
  if (r < 0.65) return { kind: 'notFirst', letters: subset() };
  if (r < 0.8) return { kind: 'notLast', letters: subset() };
  if (r < 0.95) {
    const a = letter();
    let b = letter();
    while (b === a) b = letter();
    return { kind: 'noPair', a, b };
  }
  return { kind: 'distinct' };
}

function build(rng: Rng, level: Level, shape: P08['shape']): P08 {
  const size = level === 'base' ? rng.int(4, 5) : level === 'core' ? rng.int(5, 6) : rng.int(6, 7);
  const length = level === 'base' ? 4 : level === 'core' ? 5 : 6;
  const nRules = level === 'base' ? 1 : level === 'core' ? 2 : 3;
  const letters = rng.shuffle(ALPHABET.split('')).slice(0, size).sort();
  const rules: Rule[] = [];
  while (rules.length < nRules) {
    const r = randomRule(rng, size, level);
    if (r.kind === 'distinct' && (rules.length > 0 || length > size)) continue;
    if (rules.some((x) => x.kind === 'distinct' && (r.kind === 'noRepeat' || r.kind === 'count'))) continue;
    if (r.kind === 'count' && rules.some((x) => x.kind === 'count' && x.letter === r.letter)) continue;
    if (rules.some((x) => x.kind === r.kind && (r.kind === 'noRepeat' || r.kind === 'notFirst' || r.kind === 'notLast' || r.kind === 'distinct')))
      continue;
    rules.push(r);
  }
  const p: P08 = { shape, letters, length, rules, word: [], target: 0 };
  if (shape === 'rank') {
    const m = machineOf(p);
    for (let attempt = 0; attempt < 60 && p.word.length === 0; attempt++) {
      const w = Array.from({ length }, () => rng.int(0, size - 1));
      let s: St | null = m.init;
      for (let i = 0; i < length && s !== null; i++) s = m.step(s, w[i], i);
      if (s !== null && m.accept(s)) p.word = w;
    }
    if (p.word.length === 0) throw new Reject('no sample word');
  } else if (shape === 'first') {
    p.target = rng.int(1, size - 1);
  }
  return p;
}

export const g08: Generator<P08> = {
  id: 'g08',
  answer: { kind: 'int' },
  shapes: ['count', 'rank', 'first'],
  generate(rng, level, shape) {
    if (shape !== 'count' && shape !== 'rank' && shape !== 'first') throw new Error(`g08: unknown shape "${shape}"`);
    const p = build(rng, level, shape);
    solve08(p);
    return p;
  },
  solve: solve08,
  fields(p): Fields {
    const ch = (i: number) => p.letters[i];
    return {
      letters: p.letters,
      size: p.letters.length,
      length: p.length,
      rules: p.rules.map((r) => ({
        isDistinct: r.kind === 'distinct',
        isNoRepeat: r.kind === 'noRepeat',
        isCountEq: r.kind === 'count' && r.op === 'eq',
        isCountLe: r.kind === 'count' && r.op === 'le',
        isCountGe: r.kind === 'count' && r.op === 'ge',
        isNotFirst: r.kind === 'notFirst',
        isNotLast: r.kind === 'notLast',
        isNoPair: r.kind === 'noPair',
        letter: r.kind === 'count' ? ch(r.letter) : '',
        n: r.kind === 'count' ? r.n : 0,
        letters: r.kind === 'notFirst' || r.kind === 'notLast' ? r.letters.map(ch) : [],
        a: r.kind === 'noPair' ? ch(r.a) : '',
        b: r.kind === 'noPair' ? ch(r.b) : '',
      })),
      askCount: p.shape === 'count',
      askRank: p.shape === 'rank',
      askFirst: p.shape === 'first',
      word: p.shape === 'rank' ? p.word.map(ch).join('') : '',
      target: p.shape === 'first' ? ch(p.target) : '',
    };
  },
};
