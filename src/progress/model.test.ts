import { describe, expect, it } from 'vitest';
import { emptyProgress, migrate, PROGRESS_VERSION } from './model';

/** The exact shape stored by version 1: a single course, onboarding and badge ids at the top level. */
const V1 = {
  schemaVersion: 1,
  courses: {
    postgres: {
      tasks: {
        'w1-money-type': {
          attempts: 2,
          firstTry: true,
          hintsUsed: 0,
          solutionShown: false,
          solved: true,
          solvedAt: '2026-11-03T09:07:49.528Z',
          xp: 5,
        },
        'w1-create-products': {
          attempts: 0,
          draft: 'CREATE TABLE products (\n\n);',
          firstTry: false,
          hintsUsed: 1,
          solutionShown: false,
          solved: false,
          xp: 0,
        },
      },
      passedLessons: ['w1-first-table'],
    },
  },
  activity: { '2026-11-03': 1 },
  badges: { 'first-query': '2026-11-03T09:07:49.533Z', foundation: '2026-11-03T09:28:04.000Z' },
  onboarding: { path: 'experienced', completedAt: '2026-11-03T09:20:44.594Z' },
};

describe('migrate', () => {
  it('moves version 1 into the PostgreSQL course without losing anything', () => {
    const { doc, discarded, migratedFrom } = migrate(structuredClone(V1));
    expect(discarded).toBe(false);
    expect(migratedFrom).toBe(1);
    expect(doc).toEqual({
      schemaVersion: PROGRESS_VERSION,
      courses: {
        postgres: {
          tasks: V1.courses.postgres.tasks,
          passedLessons: ['w1-first-table'],
          onboarding: V1.onboarding,
        },
      },
      activity: V1.activity,
      badges: {
        'postgres:first-query': '2026-11-03T09:07:49.533Z',
        'postgres:foundation': '2026-11-03T09:28:04.000Z',
      },
    });
  });

  it('migrates version 1 that never finished onboarding', () => {
    const { onboarding: _, ...rest } = structuredClone(V1);
    expect(migrate(rest).doc.courses.postgres.onboarding).toBeUndefined();
  });

  it('keeps current documents unchanged and is idempotent', () => {
    const once = migrate(structuredClone(V1)).doc;
    const twice = migrate(structuredClone(once));
    expect(twice).toEqual({ doc: once, discarded: false });
  });

  it('starts empty without data and discards unreadable data', () => {
    expect(migrate(undefined)).toEqual({ doc: emptyProgress(), discarded: false });
    expect(migrate({ schemaVersion: 99 }).discarded).toBe(true);
    expect(migrate('garbage').discarded).toBe(true);
  });
});
