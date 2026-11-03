import { describe, expect, it } from 'vitest';
import type { Placement, Task } from '@/content/loadCourse';
import { placementStep } from './placement';

const q = (id: string) => ({ id }) as Task;

const placement: Placement = {
  title: 'T',
  intro: '',
  passThreshold: 2,
  blocks: [
    { id: 'b1', title: 'B1', questions: [q('a1'), q('a2'), q('a3')], unlocks: ['l1'] },
    { id: 'b2', title: 'B2', questions: [q('b1'), q('b2'), q('b3')], unlocks: ['l2', 'l3'] },
  ],
};

const questionId = (answers: Record<string, boolean>) => {
  const step = placementStep(placement, answers);
  return step.kind === 'question' ? step.question.id : step;
};

describe('placementStep', () => {
  it('asks questions in order and skips the rest of a passed block', () => {
    expect(questionId({})).toBe('a1');
    expect(questionId({ a1: true })).toBe('a2');
    expect(questionId({ a1: true, a2: true })).toBe('b1');
  });

  it('asks the third question only when the first two disagree', () => {
    expect(questionId({ a1: true, a2: false })).toBe('a3');
  });

  it('stops at the first failed block and unlocks only passed ones', () => {
    expect(placementStep(placement, { a1: false, a2: false })).toEqual({
      kind: 'done',
      passedBlocks: [],
      failedBlock: 'b1',
      unlocks: [],
    });
    expect(placementStep(placement, { a1: true, a2: false, a3: true, b1: false, b2: true, b3: false })).toEqual({
      kind: 'done',
      passedBlocks: ['b1'],
      failedBlock: 'b2',
      unlocks: ['l1'],
    });
  });

  it('finishes with every block passed', () => {
    expect(placementStep(placement, { a1: true, a2: true, b1: true, b2: true })).toMatchObject({
      kind: 'done',
      failedBlock: null,
      unlocks: ['l1', 'l2', 'l3'],
    });
  });

  it('numbers questions across blocks', () => {
    expect(placementStep(placement, { a1: true, a2: true })).toMatchObject({ number: 3, total: 6 });
  });
});
