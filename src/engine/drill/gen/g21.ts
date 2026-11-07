/**
 * g21: two-player heap game, second mover wins within two moves. Answer: int. Shapes: `least`, `greatest`.
 *
 * A start qualifies when, whatever the first mover does, the second mover wins with his first or second move, but
 * the second mover cannot guarantee a win with his first move alone (the first mover never wins at once). In the
 * shared retrograde table this is plies equal to 4 for the start.
 * least: the smallest qualifying start; greatest: the largest one not above the stated bound.
 *   base: one heap, three operations, limit 40..70.   core: one heap, three operations, limit 50..110.
 *   hard: one heap, four operations (two additions, doubling, tripling), limit 90..160; `greatest` has a bound below the maximum start.
 *   Reject: fewer than 3 qualifying starts; answer 1 (least) or equal to the bound (greatest).
 */
import { Reject, type Generator } from '../types';
import { drawGameParams, gameStatement, pliesRows, startsWhere, type GameParams } from './shared/game';

export type P21 = GameParams;

export const g21: Generator<P21> = {
  id: 'g21',
  answer: { kind: 'int' },
  shapes: ['least', 'greatest'],
  generate(rng, level, shape) {
    if (shape !== 'least' && shape !== 'greatest') throw new Error(`g21: unknown shape "${shape}"`);
    return drawGameParams(rng, level, shape, shape === 'greatest', 1, true);
  },
  solve(p) {
    const good = startsWhere(p, (own) => own === 4);
    if (good.length < 3) throw new Reject('few starts');
    const answer = p.shape === 'least' ? good[0] : good[good.length - 1];
    if (answer === 1 || (p.shape === 'greatest' && answer === p.cap)) throw new Reject('trivial');
    return { answer: String(answer), steps: { rows: pliesRows(p, Math.min(answer + 1, 40)), matching: good.slice(0, 30), count: good.length } };
  },
  fields: (p) => ({ ...gameStatement(p), askLeast: p.shape === 'least', askGreatest: p.shape === 'greatest' }),
};
