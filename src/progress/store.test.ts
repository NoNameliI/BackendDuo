import { describe, expect, it } from 'vitest';
import { LESSON_BONUS_XP } from './gamification';
import { emptyProgress } from './model';
import { globalXp } from './store';

describe('globalXp', () => {
  it('keeps counting stored progress of a course that is not registered', () => {
    const base = emptyProgress();
    const doc = {
      ...base,
      courses: {
        ...base.courses,
        closed: {
          tasks: { t1: { attempts: 1, hints: 0, solved: true, xp: 15, firstTry: true, revealed: false, draft: '' } },
          passedLessons: ['a'],
          drill: { xp: 40, numbers: {}, sets: [] },
        },
      },
    } as unknown as ReturnType<typeof emptyProgress>;
    expect(globalXp(doc) - globalXp(base)).toBe(15 + LESSON_BONUS_XP + 40);
  });
});
