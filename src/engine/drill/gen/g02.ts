/**
 * g02: truth tables. Answer: word (the variable of each column, left to right). Shapes: `fragment`, `full`.
 *
 * A read-once expression over 3-4 variables is given together with some rows of its truth table whose columns are
 * unlabeled; the learner finds which variable stands in which column. Columns are a hidden permutation of variables.
 *   fragment: a few rows with the value of F in each (complete = false).
 *   full: ALL rows on which F has the value fValue (complete = true; fValue is the rarer value).
 *   base: 3 variables, 3 rows / 1-3 listed rows. core: 4 variables. hard: 4 variables with equivalence, fewer rows.
 * solve: backtracking over columns with three-valued evaluation of F on the rows (a partial assignment is cut as soon
 *   as a row is already decided the wrong way). Reject: several or no assignments, wrong number of listed rows.
 */
import { Reject, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';
import { evalExpr, evalTri, printTokens, randomTree, tokensText, type Bin, type Expr, type Tri } from './shared/logic';

export interface P02 {
  shape: 'fragment' | 'full';
  names: string[]; // variable i has name names[i]; leaf i of expr is variable i
  expr: Expr;
  rows: number[][]; // rows[r][col] in 0/1
  f: number[]; // value of F in each row
  complete: boolean;
}

const POOLS = ['XYZW', 'ABCD', 'PQRS'];

function solveColumns(p: P02): string[] {
  const n = p.names.length;
  const found: string[] = [];
  const colVar: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  const consistent = (): boolean => {
    for (let r = 0; r < p.rows.length; r++) {
      const val = new Array<Tri>(n).fill(null);
      for (let c = 0; c < colVar.length; c++) val[colVar[c]] = p.rows[r][c] as 0 | 1;
      const got = evalTri(p.expr, (i) => val[i]);
      if (got !== null && got !== p.f[r]) return false;
    }
    return true;
  };
  const go = () => {
    if (colVar.length === n) {
      found.push(colVar.map((v) => p.names[v]).join(''));
      return;
    }
    for (let v = 0; v < n; v++) {
      if (used[v]) continue;
      used[v] = true;
      colVar.push(v);
      if (consistent()) go();
      colVar.pop();
      used[v] = false;
    }
  };
  go();
  return found;
}

function countValue(expr: Expr, n: number, value: number): number {
  let c = 0;
  for (let m = 0; m < 1 << n; m++) if (Number(evalExpr(expr, (i) => ((m >> i) & 1) === 1)) === value) c++;
  return c;
}

function build(rng: Rng, level: Level, shape: 'fragment' | 'full'): P02 {
  const n = level === 'base' ? 3 : 4;
  const names = rng.pick(POOLS).slice(0, n).split('');
  const ops: Bin[] = level === 'hard' ? ['and', 'or', 'imp', 'imp', 'eq'] : ['and', 'or', 'imp'];
  const leaves = Array.from({ length: n }, (_, i) => i);
  const total = 1 << n;

  for (let attempt = 0; attempt < 40; attempt++) {
    const expr = randomTree(rng, leaves, { ops, negLeaf: level === 'base' ? 0.4 : 0.35, negTree: level === 'hard' ? 0.15 : 0 });
    const ones = countValue(expr, n, 1);
    const colVar = rng.shuffle(leaves); // column c holds variable colVar[c]
    const rowOf = (m: number) => colVar.map((v) => (m >> v) & 1);
    const fOf = (m: number) => Number(evalExpr(expr, (i) => ((m >> i) & 1) === 1));

    if (shape === 'full') {
      const value = ones <= total - ones ? 1 : 0;
      const k = value === 1 ? ones : total - ones;
      const lo = level === 'base' ? 2 : 3;
      if (k < lo || k > (level === 'base' ? 3 : 6)) continue;
      const ms = rng.shuffle(Array.from({ length: total }, (_, m) => m).filter((m) => fOf(m) === value));
      const p: P02 = { shape, names, expr, rows: ms.map(rowOf), f: ms.map(fOf), complete: true };
      if (solveColumns(p).length === 1) return p;
    } else {
      if (ones === 0 || ones === total) continue;
      const k = level === 'base' ? 3 : level === 'core' ? 4 : 4;
      for (let tries = 0; tries < 12; tries++) {
        const ms = rng.shuffle(Array.from({ length: total }, (_, m) => m)).slice(0, k);
        const fs = ms.map(fOf);
        if (fs.every((x) => x === fs[0])) continue;
        const p: P02 = { shape, names, expr, rows: ms.map(rowOf), f: fs, complete: false };
        if (solveColumns(p).length === 1) return p;
      }
    }
  }
  throw new Reject('no unique table');
}

function solve(p: P02): Solved {
  const n = p.names.length;
  if (p.rows.length < 2 || p.rows.some((r) => r.length !== n)) throw new Reject('bad rows');
  if (p.complete) {
    // The listed rows must be all rows with this value of F: counts agree whatever the order of columns.
    const value = p.f[0];
    if (p.f.some((x) => x !== value)) throw new Reject('mixed values');
    if (new Set(p.rows.map((r) => r.join(''))).size !== p.rows.length) throw new Reject('repeated row');
    if (countValue(p.expr, n, value) !== p.rows.length) throw new Reject('rows are not complete');
  }
  const found = solveColumns(p);
  if (found.length !== 1) throw new Reject('not unique');
  const word = found[0];
  const varOfCol = word.split('');
  const forced = varOfCol
    .map((letter, i) => ({ col: i + 1, letter, value: p.rows[0][i], same: p.rows.every((r) => r[i] === p.rows[0][i]) }))
    .filter((x) => x.same)
    .map(({ col, letter, value }) => ({ col, letter, value, isZero: value === 0, isOne: value === 1 }));
  return {
    answer: word,
    steps: {
      forced,
      hasForced: forced.length > 0,
      order: varOfCol,
      columns: varOfCol.map((name, i) => ({ col: i + 1, name, ones: p.rows.filter((r) => r[i] === 1).length })),
      rows: p.rows.map((cells, r) => ({ cells, f: p.f[r] })),
    },
  };
}

function fields(p: P02): Fields {
  const tokens = printTokens(p.expr, (i) => p.names[i]);
  return {
    expr: tokensText(tokens),
    tokens,
    names: p.names,
    n: p.names.length,
    rows: p.rows.map((cells, r) => ({ cells, f: p.f[r] })),
    complete: p.complete,
    fValue: p.f[0],
    rowCount: p.rows.length,
  };
}

export const g02: Generator<P02> = {
  id: 'g02',
  answer: { kind: 'word', latin: true },
  shapes: ['fragment', 'full'],
  generate: (rng, level, shape) => {
    if (shape !== 'fragment' && shape !== 'full') throw new Error(`g02: unknown shape "${shape}"`);
    return build(rng, level, shape);
  },
  solve,
  fields,
};
