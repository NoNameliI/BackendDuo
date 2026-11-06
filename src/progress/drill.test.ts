import { describe, expect, it } from 'vitest';
import { numberAccuracy, recordOutcome, weakNumbers, type DrillOutcome, type DrillRules } from './drill';
import { migrate, type DrillProgress, type NumberStat } from './model';

const rules: DrillRules = { xp: 10, dailyXp: 5 };
const TODAY = '2026-11-06';

const outcome = (over: Partial<DrillOutcome> = {}): DrillOutcome => ({
  n: 14,
  taskId: 'n14',
  level: 'core',
  correct: true,
  hintsUsed: 0,
  solutionShown: false,
  ms: 1500,
  firstTry: true,
  ...over,
});

const stat = (recent: string): NumberStat => ({ seen: recent.length, correct: 0, firstTry: 0, ms: 0, recent, levels: {} });
const withRecent = (entries: Record<string, string>): DrillProgress => ({
  xp: 0,
  numbers: Object.fromEntries(Object.entries(entries).map(([n, r]) => [n, stat(r)])),
  sets: [],
});

describe('drill progress document', () => {
  it('a v2 document without drill comes out of migrate deep-equal', () => {
    const v2 = {
      schemaVersion: 2,
      courses: {
        postgres: {
          tasks: { t1: { solved: true, attempts: 1, hintsUsed: 0, solutionShown: false, xp: 10, firstTry: true, solvedAt: '2026-11-03T09:07:49.528Z' } },
          passedLessons: ['l1'],
          onboarding: { path: 'beginner', completedAt: '2026-11-03T09:20:44.594Z' },
        },
      },
      activity: { '2026-11-03': 1 },
      badges: { 'postgres:first-query': '2026-11-03T09:07:49.533Z' },
    };
    const { doc, discarded, migratedFrom } = migrate(structuredClone(v2));
    expect(discarded).toBe(false);
    expect(migratedFrom).toBeUndefined();
    expect(doc).toEqual(v2);
    expect(doc.courses.postgres).not.toHaveProperty('drill');
  });

  it('parses a stored drill block and fills its defaults', () => {
    const raw = { schemaVersion: 2, courses: { p1: { drill: { numbers: { '14': { seen: 1, correct: 1, firstTry: 1, ms: 5 } } } } }, activity: {}, badges: {} };
    const drill = migrate(raw).doc.courses.p1.drill;
    expect(drill).toEqual({ xp: 0, numbers: { '14': { seen: 1, correct: 1, firstTry: 1, ms: 5, recent: '', levels: {} } }, sets: [] });
  });
});

describe('recordOutcome', () => {
  it('keeps statistics of the number and the level', () => {
    const first = recordOutcome(undefined, outcome({ correct: false, firstTry: false }), rules, TODAY);
    expect(first.xp).toBe(0);
    const second = recordOutcome(first.dp, outcome(), rules, TODAY);
    expect(second.dp.numbers['14']).toEqual({
      seen: 2,
      correct: 1,
      firstTry: 1,
      ms: 1500,
      recent: '-+',
      levels: { core: [1, 2] },
      lastAt: TODAY,
    });
    expect(second.xp).toBe(10);
    expect(second.dp.xp).toBe(10);
  });

  it('reduces XP by hints, pays nothing for a shown solution and marks it in recent', () => {
    expect(recordOutcome(undefined, outcome({ hintsUsed: 2 }), rules, TODAY).xp).toBe(5);
    const shown = recordOutcome(undefined, outcome({ solutionShown: true }), rules, TODAY);
    expect(shown.xp).toBe(0);
    expect(shown.dp.numbers['14'].recent).toBe('-');
  });

  it('pays at most dailyXp solves per number per day, then starts over the next day', () => {
    let dp: DrillProgress | undefined;
    const earned: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = recordOutcome(dp, outcome(), rules, TODAY);
      dp = r.dp;
      earned.push(r.xp);
    }
    expect(earned).toEqual([10, 10, 10, 10, 10, 0, 0]);
    expect(recordOutcome(dp, outcome({ n: 7 }), rules, TODAY).xp).toBe(10);
    expect(recordOutcome(dp, outcome(), rules, '2026-11-07').xp).toBe(10);
  });

  it('takes the reward from a table by level and keeps the last ten answers', () => {
    const table: DrillRules = { xp: { base: 2, core: 6, hard: 12 }, dailyXp: 5 };
    expect(recordOutcome(undefined, outcome({ level: 'hard' }), table, TODAY).xp).toBe(12);
    let dp: DrillProgress | undefined;
    for (let i = 0; i < 12; i++) dp = recordOutcome(dp, outcome({ correct: i % 2 === 0 }), rules, TODAY).dp;
    expect(dp?.numbers['14'].recent).toHaveLength(10);
  });
});

describe('weakNumbers', () => {
  it('lists numbers with low accuracy or an unfinished recovery, lowest accuracy first', () => {
    const dp = withRecent({ '1': '++++', '2': '-', '3': '+-', '4': '--+-', '5': '--++', '6': '-++++++' });
    expect(weakNumbers(dp, [1, 2, 3, 4, 5, 6, 7])).toEqual([4, 3, 5]);
  });

  it('leaves the queue after two correct answers once accuracy has recovered', () => {
    expect(weakNumbers(withRecent({ '8': '+-' }), [8])).toEqual([8]);
    expect(weakNumbers(withRecent({ '8': '+-++' }), [8])).toEqual([]);
  });

  it('computes accuracy over the recent window', () => {
    expect(numberAccuracy(stat('++-+'))).toBe(0.75);
    expect(numberAccuracy(undefined)).toBe(0);
  });
});
