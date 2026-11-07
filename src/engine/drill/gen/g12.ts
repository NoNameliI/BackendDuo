/**
 * g12: executors with a fixed command set. Answer: int. Shapes: `rewrite`, `tape`.
 *
 * rewrite: a string editor. The program repeats "while some pattern is found: apply the first rule (in listed
 *   order) whose pattern is found, replacing its leftmost occurrence" and the answer is read off the final string:
 *   digit sum, number of a given digit, or total length.
 *   base: one family only, strings of 10..20 digits, 2 shrinking rules.
 *   core: shrinking rules, or a head symbol that walks right ('>d' becomes output + '>'), strings 30..60.
 *   hard: head walk plus 1-2 shrinking rules that are listed first, strings 80..200, any ask.
 *   solve: array-of-codes machine with manual matching; brute: plain string indexOf / slice.
 * tape: a Turing-style machine with states 1..k, symbols 0 1 2 and a blank (_). The head starts on the first
 *   symbol in state 1. A right-moving pass states set reads to the blank after the word, there the machine may
 *   write one symbol and turns left into the second pass states set, which runs left until a blank (it halts: next
 *   state 0). Answer: number of 1 on the tape, digit sum, or number of filled cells.
 *   base: 2+1 states, words of 8..12. core: 2+2 states, 15..30. hard: 3+3 states, 40..90.
 *
 * Reject: more than 100000 steps or 5000 characters; answer < 2; the answer equals the trivial extreme (all cells
 * ones / empty result); fewer than 3 rewrite steps.
 */
import { Reject, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';

export type Rule = { find: string; repl: string };
export type Row = { state: number; read: string; write: string; move: 'R' | 'L'; next: number };
export type P12 =
  | { shape: 'rewrite'; start: string; rules: Rule[]; ask: 'sum' | 'count' | 'length'; digit: number }
  | { shape: 'tape'; start: string; table: Row[]; ask: 'ones' | 'sum' | 'filled' };

type Rewrite = Extract<P12, { shape: 'rewrite' }>;
type Tape = Extract<P12, { shape: 'tape' }>;

const MAX_STEPS = 100_000;
const MAX_LEN = 5000;

// ---------------------------------------------------------------- rewrite

function indexOfCodes(s: number[], pat: number[]): number {
  outer: for (let i = 0; i + pat.length <= s.length; i++) {
    for (let j = 0; j < pat.length; j++) if (s[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}

function runRewrite(p: Rewrite): { text: string; steps: number } {
  const codes = (t: string) => Array.from(t, (c) => c.charCodeAt(0));
  const rules = p.rules.map((r) => ({ find: codes(r.find), repl: codes(r.repl) }));
  let s = codes(p.start);
  let steps = 0;
  for (;;) {
    let applied = false;
    for (const r of rules) {
      const at = indexOfCodes(s, r.find);
      if (at < 0) continue;
      s = [...s.slice(0, at), ...r.repl, ...s.slice(at + r.find.length)];
      applied = true;
      break;
    }
    if (!applied) break;
    if (++steps > MAX_STEPS || s.length > MAX_LEN) throw new Reject('runs too long');
  }
  return { text: String.fromCharCode(...s), steps };
}

function solveRewrite(p: Rewrite): Solved {
  const { text, steps } = runRewrite(p);
  const digits = [...text].filter((c) => c >= '0' && c <= '9');
  const value =
    p.ask === 'sum' ? digits.reduce((s, c) => s + Number(c), 0) : p.ask === 'count' ? digits.filter((c) => c === String(p.digit)).length : text.length;
  if (steps < 3 || value < 2) throw new Reject('trivial');
  return { answer: String(value), steps: { result: text, steps, value } };
}

const letters = (rng: Rng, n: number, alphabet: string): string => Array.from({ length: n }, () => rng.pick([...alphabet])).join('');

function buildRewrite(rng: Rng, level: Level): Rewrite {
  const alphabet = '123';
  const family = level === 'base' ? 'shrink' : level === 'core' ? rng.pick(['shrink', 'head']) : 'head';
  const rules: Rule[] = [];
  const seen = new Set<string>();
  const addShrink = (): void => {
    for (let guard = 0; guard < 20; guard++) {
      const find = letters(rng, rng.int(2, 3), alphabet);
      const repl = letters(rng, find.length - 1 - (find.length === 3 ? rng.int(0, 1) : 0), alphabet);
      if (seen.has(find)) continue;
      seen.add(find);
      rules.push({ find, repl });
      return;
    }
  };
  let start: string;
  if (family === 'shrink') {
    const count = level === 'hard' ? 3 : 2;
    for (let i = 0; i < count; i++) addShrink();
    const n = level === 'base' ? rng.int(10, 20) : rng.int(30, 60);
    start = rng.chance(0.5) ? letters(rng, n, alphabet.slice(0, 2)) : letters(rng, n, alphabet);
  } else {
    const shrinks = level === 'hard' ? rng.int(1, 2) : rng.int(0, 1);
    for (let i = 0; i < shrinks; i++) addShrink();
    for (const d of alphabet) rules.push({ find: `>${d}`, repl: `${letters(rng, rng.int(0, 3), alphabet)}>` });
    const n = level === 'hard' ? rng.int(80, 200) : rng.int(30, 60);
    start = `>${letters(rng, n, alphabet)}`;
  }
  const r = rng.next();
  const ask: Rewrite['ask'] = level === 'base' ? 'sum' : r < 0.4 ? 'sum' : r < 0.75 ? 'count' : 'length';
  return { shape: 'rewrite', start, rules, ask, digit: rng.int(1, 3) };
}

// ---------------------------------------------------------------- tape

function runTape(p: Tape): { tape: string; steps: number } {
  const cells = new Map<number, string>();
  [...p.start].forEach((c, i) => cells.set(i, c));
  const rows = new Map<string, Row>();
  for (const r of p.table) rows.set(`${r.state}${r.read}`, r);
  let pos = 0;
  let state = 1;
  let steps = 0;
  while (state !== 0) {
    const read = cells.get(pos) ?? '_';
    const row = rows.get(`${state}${read}`);
    if (!row) throw new Reject('no transition');
    if (row.write === '_') cells.delete(pos);
    else cells.set(pos, row.write);
    pos += row.move === 'R' ? 1 : -1;
    state = row.next;
    if (++steps > MAX_STEPS) throw new Reject('runs too long');
  }
  const keys = [...cells.keys()].sort((a, b) => a - b);
  const lo = keys[0] ?? 0;
  const hi = keys[keys.length - 1] ?? 0;
  let tape = '';
  for (let i = lo; i <= hi; i++) tape += cells.get(i) ?? '_';
  return { tape, steps };
}

function solveTape(p: Tape): Solved {
  const { tape, steps } = runTape(p);
  const filled = [...tape].filter((c) => c !== '_');
  const value = p.ask === 'ones' ? filled.filter((c) => c === '1').length : p.ask === 'sum' ? filled.reduce((s, c) => s + Number(c), 0) : filled.length;
  if (value < 2) throw new Reject('trivial');
  if (p.ask === 'filled' && value === p.start.length) throw new Reject('same size');
  return { answer: String(value), steps: { tape, steps, value } };
}

function buildTape(rng: Rng, level: Level): Tape {
  const [a, b] = level === 'base' ? [2, 1] : level === 'core' ? [2, 2] : [3, 3];
  const n = level === 'base' ? rng.int(8, 12) : level === 'core' ? rng.int(15, 30) : rng.int(40, 90);
  const sym = '012';
  const table: Row[] = [];
  for (let s = 1; s <= a; s++) {
    for (const read of sym) table.push({ state: s, read, write: rng.pick([...sym]), move: 'R', next: rng.int(1, a) });
    table.push({ state: s, read: '_', write: rng.chance(0.5) ? '_' : rng.pick([...sym]), move: 'L', next: a + rng.int(1, b) });
  }
  for (let s = a + 1; s <= a + b; s++) {
    for (const read of sym) table.push({ state: s, read, write: rng.pick([...sym]), move: 'L', next: a + rng.int(1, b) });
    table.push({ state: s, read: '_', write: '_', move: 'R', next: 0 });
  }
  const start = letters(rng, n, sym);
  const r = rng.next();
  const ask: Tape['ask'] = level === 'base' ? 'ones' : r < 0.4 ? 'ones' : r < 0.75 ? 'sum' : 'filled';
  return { shape: 'tape', start, table, ask };
}

// ---------------------------------------------------------------- generator

export const g12: Generator<P12> = {
  id: 'g12',
  answer: { kind: 'int' },
  shapes: ['rewrite', 'tape'],
  generate(rng, level, shape) {
    if (shape === 'rewrite') return buildRewrite(rng, level);
    if (shape === 'tape') return buildTape(rng, level);
    throw new Error(`g12: unknown shape "${shape}"`);
  },
  solve: (p) => (p.shape === 'rewrite' ? solveRewrite(p) : solveTape(p)),
  fields: (p): Fields =>
    p.shape === 'rewrite'
      ? {
          start: p.start,
          rules: p.rules.map((r, i) => ({ find: r.find, repl: r.repl, first: i === 0, last: i === p.rules.length - 1, isEmpty: r.repl === '' })),
          askSum: p.ask === 'sum',
          askCount: p.ask === 'count',
          askLength: p.ask === 'length',
          digit: p.digit,
        }
      : {
          start: p.start,
          length: p.start.length,
          states: Math.max(...p.table.map((r) => r.state)),
          rows: p.table.map((r) => ({
            state: r.state,
            read: r.read,
            write: r.write,
            move: r.move,
            moveRight: r.move === 'R',
            next: r.next,
            halt: r.next === 0,
            readBlank: r.read === '_',
            writeBlank: r.write === '_',
          })),
          askOnes: p.ask === 'ones',
          askSum: p.ask === 'sum',
          askFilled: p.ask === 'filled',
        },
};
