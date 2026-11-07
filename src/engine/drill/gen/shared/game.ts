/**
 * One game model for the two-player heap games (19, 20, 21) and a retrograde solver. Pure, no task text.
 *
 * A position is a list of heap sizes. A move picks one heap and applies one of the operations (add k, multiply
 * by k); heaps never shrink, so the total strictly grows. The player whose move makes the total reach `limit`
 * wins. Values are plies: for a position with the move, `plies` is odd when the mover wins (fewest plies he
 * needs against best resistance) and even when he loses (most plies he can hold out); a finished position
 * counts as a lost one with 0 plies.
 */
import { Reject, type Fields, type Level, type Rng } from '../../types';

export type Op = { kind: 'add' | 'mul'; k: number };
export interface Game {
  heaps: 1 | 2;
  ops: Op[];
  limit: number;
}

export const total = (st: readonly number[]): number => st.reduce((s, x) => s + x, 0);
export const isEnd = (g: Game, st: readonly number[]): boolean => total(st) >= g.limit;

export function successors(g: Game, st: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < st.length; i++) {
    for (const op of g.ops) {
      const next = st.slice();
      next[i] = op.kind === 'add' ? st[i] + op.k : st[i] * op.k;
      out.push(next);
    }
  }
  return out;
}

export interface GameSolution {
  /** Plies of a position (see the module comment); finished positions give 0. */
  plies(st: readonly number[]): number;
  /** The mover forces a win using at most `k` of his own moves. */
  winsWithin(st: readonly number[], k: number): boolean;
}

/** Solves every position of the box: first heap 1.., second heap (if any) from `tail`, total below the limit. */
export function solveGame(g: Game, tail = 1): GameSolution {
  const L = g.limit;
  const index = (st: readonly number[]) => (g.heaps === 1 ? st[0] : st[0] * L + st[1]);
  const table = new Map<number, number>();
  const plies = (st: readonly number[]): number => (isEnd(g, st) ? 0 : (table.get(index(st)) as number));

  const states: number[][] = [];
  if (g.heaps === 1) for (let a = 1; a < L; a++) states.push([a]);
  else for (let a = 1; a < L; a++) for (let b = tail; a + b < L; b++) states.push([a, b]);
  states.sort((x, y) => total(y) - total(x));

  for (const st of states) {
    const ps = successors(g, st).map(plies);
    const lost = ps.filter((p) => p % 2 === 0);
    table.set(index(st), lost.length > 0 ? 1 + Math.min(...lost) : 1 + Math.max(...ps));
  }
  return {
    plies,
    winsWithin: (st, k) => {
      const p = plies(st);
      return p % 2 === 1 && (p + 1) / 2 <= k;
    },
  };
}

/** Statement fields of the rules, shared by 19-21. */
export function gameFields(g: Game, tail: number): Fields {
  return {
    twoHeaps: g.heaps === 2,
    extra: tail,
    limit: g.limit,
    ops: g.ops.map((o) => ({ isAdd: o.kind === 'add', isMul: o.kind === 'mul', k: o.k })),
  };
}

export interface GameParams {
  shape: string;
  game: Game;
  /** Starting size of the second heap (two heaps only), else 1. */
  tail: number;
  /** Largest start the statement allows. */
  cap: number;
}

/** Rules for a level: base one heap and two operations, core one heap and three, hard two heaps. */
export function drawGameParams(rng: Rng, level: Level, shape: string, bounded: boolean, hardHeaps: 1 | 2 = 2, richBase = false): GameParams {
  let game: Game;
  let tail = 1;
  if (level === 'base' && richBase) {
    const a = rng.int(1, 3);
    const ops: Op[] = [{ kind: 'add', k: a }, { kind: 'add', k: a + rng.int(1, 3) }, { kind: 'mul', k: rng.int(2, 3) }];
    game = { heaps: 1, ops: rng.shuffle(ops), limit: rng.int(40, 70) };
  } else if (level === 'base') {
    const a = rng.int(1, 3);
    const ops: Op[] = rng.chance(0.75) ? [{ kind: 'add', k: a }, { kind: 'mul', k: 2 }] : [{ kind: 'add', k: a }, { kind: 'add', k: a + rng.int(1, 3) }];
    game = { heaps: 1, ops, limit: rng.int(20, 45) };
  } else if (level === 'core') {
    const a = rng.int(1, 3);
    const ops: Op[] = [{ kind: 'add', k: a }, { kind: 'add', k: a + rng.int(1, 3) }, { kind: 'mul', k: rng.int(2, 3) }];
    game = { heaps: 1, ops: rng.shuffle(ops), limit: rng.int(50, 110) };
  } else if (hardHeaps === 1) {
    const a = rng.int(1, 3);
    const ops: Op[] = [{ kind: 'add', k: a }, { kind: 'add', k: a + rng.int(1, 3) }, { kind: 'mul', k: 2 }, { kind: 'mul', k: 3 }];
    game = { heaps: 1, ops: rng.shuffle(ops), limit: rng.int(90, 160) };
  } else {
    const ops: Op[] = [{ kind: 'add', k: rng.int(1, 2) }, { kind: 'mul', k: 2 }];
    if (rng.chance(0.4)) ops.push({ kind: 'add', k: rng.int(3, 4) });
    game = { heaps: 2, ops: rng.shuffle(ops), limit: rng.int(40, 64) };
    tail = rng.int(3, 9);
  }
  const top = game.limit - 1 - (game.heaps === 2 ? tail : 0);
  const cap = bounded ? rng.int(Math.ceil(top * 0.55), top) : top;
  return { shape, game, tail, cap };
}

/** Starts 1..cap for which `test(plies of start, plies of each successor)` holds, using the solver. */
export function startsWhere(p: GameParams, test: (own: number, next: number[]) => boolean): number[] {
  const sol = solveGame(p.game, p.tail);
  const out: number[] = [];
  for (let s = 1; s <= p.cap; s++) {
    const st = p.game.heaps === 1 ? [s] : [s, p.tail];
    const next = successors(p.game, st).map((x) => sol.plies(x));
    if (test(sol.plies(st), next)) out.push(s);
  }
  return out;
}

/** Plies table for the explanation: starts 1..upTo. */
export function pliesRows(p: GameParams, upTo: number): { s: number; plies: number; mover: boolean }[] {
  const sol = solveGame(p.game, p.tail);
  const rows: { s: number; plies: number; mover: boolean }[] = [];
  for (let s = 1; s <= Math.min(upTo, p.cap); s++) {
    const n = sol.plies(p.game.heaps === 1 ? [s] : [s, p.tail]);
    rows.push({ s, plies: n, mover: n % 2 === 1 });
  }
  return rows;
}

export function gameStatement(p: GameParams): Fields {
  return { ...gameFields(p.game, p.tail), maxS: p.cap, bounded: p.cap < p.game.limit - 1 - (p.game.heaps === 2 ? p.tail : 0) };
}

export function checkSizes(p: GameParams): void {
  if (p.cap < 4) throw new Reject('range too small');
}
