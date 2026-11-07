/**
 * g19: two-player heap game, first mover's unsuccessful first move. Answer: int. Shapes: `least`, `greatest`.
 *
 * The first mover cannot win at once, yet he has a first move after which the second mover wins at his first move.
 * least: the smallest such start; greatest: the largest such start not above the stated bound.
 * Rules come from shared/game.ts (retrograde plies table; a start qualifies when its plies are not 1 and some
 * successor has plies 1).
 *   base: one heap, two operations, limit 20..45.   core: one heap, three operations, limit 50..110.
 *   hard: two heaps (second one fixed), limit 40..64; `greatest` has a bound below the maximum start.
 *   Reject: no qualifying start; answer 1 (least) or equal to the bound (greatest); fewer than 3 qualifying starts.
 */
import { Reject, type Generator } from '../types';
import { drawGameParams, gameStatement, pliesRows, startsWhere, type GameParams } from './shared/game';

export type P19 = GameParams;

export const g19: Generator<P19> = {
  id: 'g19',
  answer: { kind: 'int' },
  shapes: ['least', 'greatest'],
  generate(rng, level, shape) {
    if (shape !== 'least' && shape !== 'greatest') throw new Error(`g19: unknown shape "${shape}"`);
    return drawGameParams(rng, level, shape, shape === 'greatest');
  },
  solve(p) {
    const good = startsWhere(p, (own, next) => own !== 1 && next.some((x) => x === 1));
    if (good.length < 3) throw new Reject('few starts');
    const answer = p.shape === 'least' ? good[0] : good[good.length - 1];
    if (answer === 1 || (p.shape === 'greatest' && answer === p.cap)) throw new Reject('trivial');
    return { answer: String(answer), steps: { rows: pliesRows(p, Math.min(answer + 1, 40)), matching: good.slice(0, 30), count: good.length } };
  },
  fields: (p) => ({ ...gameStatement(p), askLeast: p.shape === 'least', askGreatest: p.shape === 'greatest' }),
};
