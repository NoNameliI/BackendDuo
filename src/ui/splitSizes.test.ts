import { describe, expect, it } from 'vitest';
import { resizePair } from './splitSizes';

describe('resizePair', () => {
  it('moves the boundary between neighbours only', () => {
    expect(resizePair([30, 40, 30], 0, 10, 15)).toEqual([40, 30, 30]);
    expect(resizePair([30, 40, 30], 1, -5, 15)).toEqual([30, 35, 35]);
  });

  it('clamps both panes to the minimum', () => {
    expect(resizePair([30, 40, 30], 0, -50, 15)).toEqual([15, 55, 30]);
    expect(resizePair([30, 40, 30], 0, 50, 15)).toEqual([55, 15, 30]);
  });
});
