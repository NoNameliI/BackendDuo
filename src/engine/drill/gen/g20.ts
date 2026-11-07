/**
 * g20: two-player heap game, first mover wins on his second move. Answer: pair "a b". Shapes: `least`, `span`.
 *
 * A start qualifies when the first mover cannot win at once but can force a win with his second move against any
 * reply (plies of the start equal 3 in the shared retrograde table).
 * least: the two smallest qualifying starts; span: the smallest and the largest qualifying start not above the bound.
 *   base: one heap, two operations, limit 20..45.   core: one heap, three operations, limit 50..110.
 *   hard: two heaps (second one fixed), limit 40..64; `span` has a bound below the maximum start.
 *   Reject: fewer than 3 qualifying starts; first answer equal to the second.
 */
import { Reject, type Generator } from '../types';
import { drawGameParams, gameStatement, pliesRows, startsWhere, type GameParams } from './shared/game';

export type P20 = GameParams;

export const g20: Generator<P20> = {
  id: 'g20',
  answer: { kind: 'pair' },
  shapes: ['least', 'span'],
  generate(rng, level, shape) {
    if (shape !== 'least' && shape !== 'span') throw new Error(`g20: unknown shape "${shape}"`);
    return drawGameParams(rng, level, shape, shape === 'span');
  },
  solve(p) {
    const good = startsWhere(p, (own) => own === 3);
    if (good.length < 3) throw new Reject('few starts');
    const pair = p.shape === 'least' ? [good[0], good[1]] : [good[0], good[good.length - 1]];
    return { answer: `${pair[0]} ${pair[1]}`, steps: { rows: pliesRows(p, Math.min(pair[1] + 1, 40)), matching: good.slice(0, 30), count: good.length } };
  },
  fields: (p) => ({ ...gameStatement(p), askLeast: p.shape === 'least', askSpan: p.shape === 'span' }),
};
