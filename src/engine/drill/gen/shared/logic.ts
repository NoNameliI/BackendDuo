/**
 * Boolean expressions: AST, evaluation (two- and three-valued), random read-once trees, printing as tokens.
 * Pure helpers; no task text. Leaves are numbered; what a leaf means (a variable, a predicate) is up to the caller.
 */
import type { Rng } from '../../types';

export type Bin = 'and' | 'or' | 'imp' | 'eq';
export type Expr = { k: 'leaf'; i: number } | { k: 'not'; a: Expr } | { k: Bin; a: Expr; b: Expr };

export const leaf = (i: number): Expr => ({ k: 'leaf', i });
export const not = (a: Expr): Expr => ({ k: 'not', a });
export const bin = (k: Bin, a: Expr, b: Expr): Expr => ({ k, a, b });

export function evalExpr(e: Expr, v: (i: number) => boolean): boolean {
  switch (e.k) {
    case 'leaf':
      return v(e.i);
    case 'not':
      return !evalExpr(e.a, v);
    case 'and':
      return evalExpr(e.a, v) && evalExpr(e.b, v);
    case 'or':
      return evalExpr(e.a, v) || evalExpr(e.b, v);
    case 'imp':
      return !evalExpr(e.a, v) || evalExpr(e.b, v);
    case 'eq':
      return evalExpr(e.a, v) === evalExpr(e.b, v);
  }
}

export type Tri = 0 | 1 | null;

/** Kleene evaluation: null = not known yet. A definite result is the value under every completion. */
export function evalTri(e: Expr, v: (i: number) => Tri): Tri {
  switch (e.k) {
    case 'leaf':
      return v(e.i);
    case 'not': {
      const a = evalTri(e.a, v);
      return a === null ? null : ((1 - a) as 0 | 1);
    }
    case 'and': {
      const a = evalTri(e.a, v);
      const b = evalTri(e.b, v);
      return a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : null;
    }
    case 'or': {
      const a = evalTri(e.a, v);
      const b = evalTri(e.b, v);
      return a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : null;
    }
    case 'imp': {
      const a = evalTri(e.a, v);
      const b = evalTri(e.b, v);
      return a === 0 || b === 1 ? 1 : a === 1 && b === 0 ? 0 : null;
    }
    case 'eq': {
      const a = evalTri(e.a, v);
      const b = evalTri(e.b, v);
      return a === null || b === null ? null : a === b ? 1 : 0;
    }
  }
}

export function leavesOf(e: Expr, out: number[] = []): number[] {
  if (e.k === 'leaf') out.push(e.i);
  else if (e.k === 'not') leavesOf(e.a, out);
  else {
    leavesOf(e.a, out);
    leavesOf(e.b, out);
  }
  return out;
}

export function size(e: Expr): number {
  return e.k === 'leaf' ? 1 : e.k === 'not' ? 1 + size(e.a) : 1 + size(e.a) + size(e.b);
}

export interface TreeOptions {
  ops: readonly Bin[];
  /** Probability that a leaf is negated. */
  negLeaf: number;
  /** Probability that a compound subtree is negated. */
  negTree?: number;
  /** Operator forced at the root. */
  rootOp?: Bin;
}

/** Random tree in which every given leaf occurs exactly once, in random order. */
export function randomTree(rng: Rng, leaves: readonly number[], o: TreeOptions): Expr {
  const build = (xs: readonly number[], root: boolean): Expr => {
    if (xs.length === 1) {
      const l = leaf(xs[0]);
      return rng.chance(o.negLeaf) ? not(l) : l;
    }
    const cut = rng.int(1, xs.length - 1);
    const op = root && o.rootOp ? o.rootOp : rng.pick(o.ops);
    const t = bin(op, build(xs.slice(0, cut), false), build(xs.slice(cut), false));
    return !root && rng.chance(o.negTree ?? 0) ? not(t) : t;
  };
  return build(rng.shuffle(leaves), true);
}

// ---------------------------------------------------------------- printing

export type TokenKind = 'leaf' | 'not' | 'and' | 'or' | 'imp' | 'eq' | 'lp' | 'rp';
export interface Token {
  [k: string]: string | number;
  kind: TokenKind;
  text: string;
  /** Leaf number, -1 for operators and brackets. */
  leaf: number;
}

const SYMBOL: Record<Exclude<TokenKind, 'leaf'>, string> = {
  not: '¬',
  and: '∧',
  or: '∨',
  imp: '→',
  eq: '≡',
  lp: '(',
  rp: ')',
};
const PREC: Record<Bin, number> = { eq: 0, imp: 1, or: 2, and: 3 };

const isBin = (e: Expr): e is Extract<Expr, { a: Expr; b: Expr }> => e.k !== 'leaf' && e.k !== 'not';

/** Brackets around every compound operand of another operator, except a chain of the same and/or. */
function wrap(parent: Bin, child: Expr): boolean {
  if (!isBin(child)) return false;
  if (child.k === parent && (parent === 'and' || parent === 'or')) return false;
  return true;
}

export function printTokens(e: Expr, leafText: (i: number) => string): Token[] {
  const out: Token[] = [];
  const op = (kind: Exclude<TokenKind, 'leaf'>) => out.push({ kind, text: SYMBOL[kind], leaf: -1 });
  const go = (x: Expr, parent: Bin | null) => {
    if (x.k === 'leaf') {
      out.push({ kind: 'leaf', text: leafText(x.i), leaf: x.i });
    } else if (x.k === 'not') {
      op('not');
      if (x.a.k === 'leaf' || x.a.k === 'not') go(x.a, null);
      else {
        op('lp');
        go(x.a, null);
        op('rp');
      }
    } else {
      const brackets = parent !== null && wrap(parent, x);
      if (brackets) op('lp');
      go(x.a, x.k);
      op(x.k);
      go(x.b, x.k);
      if (brackets) op('rp');
    }
  };
  go(e, null);
  return out;
}

/** Tokens joined with spaces, none after an opening bracket or a negation, none before a closing one. */
export function tokensText(tokens: readonly Token[]): string {
  let s = '';
  let tight = true;
  for (const t of tokens) {
    if (t.kind === 'rp') s += t.text;
    else s += (tight ? '' : ' ') + t.text;
    tight = t.kind === 'lp' || t.kind === 'not';
  }
  return s;
}

export { PREC as precedence };
