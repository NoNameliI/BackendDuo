import { it } from 'vitest';
import { draw } from './instance';
import { registry } from './registry';
it('stats', () => {
  for (const id of ['g19','g20','g21','g01']) {
    const gen = registry[id as 'g19']; if (!gen) continue;
    for (const level of ['base','core','hard'] as const) for (const shape of gen.shapes) {
      const t: number[] = []; let fail = 0;
      for (let s = 1; s <= 60; s++) { try { t.push(draw(gen, { seed: s, level, shape, vocab: {} }).tries); } catch { fail++; } }
      console.log(id, level, shape, 'mean', (t.reduce((a,b)=>a+b,0)/Math.max(1,t.length)).toFixed(1), 'max', Math.max(0,...t), 'fail', fail);
    }
  }
});
