import { describe, expect, it } from 'vitest';
import type { Course, Lesson, Task } from '@/content/loadCourse';
import {
  badgeEarned,
  firstOpenTask,
  lessonStatuses,
  levelInfo,
  nextLesson,
  streakInfo,
  taskXp,
  totalXp,
} from './gamification';
import { EMPTY_COURSE, EMPTY_TASK, migrate, type CourseProgress } from './model';

const task = (id: string, type: Task['type'] = 'result'): Task =>
  ({ id, type, xp: 10, title: id, prompt: '', hints: ['h'], lessonId: '', worldId: '', setupSql: '' }) as unknown as Task;

const lesson = (id: string, tasks: Task[], requires: string[] = []): Lesson => ({
  id,
  worldId: '',
  title: id,
  theory: '',
  requires,
  tasks,
});

const course: Course = {
  id: 'c',
  title: 'C',
  engine: 'postgres',
  errorHints: {},
  levels: [
    { xp: 0, title: 'Trainee' },
    { xp: 50, title: 'Writer' },
    { xp: 120, title: 'Architect' },
  ],
  badges: [],
  worlds: [
    { id: 'w1', title: '', summary: '', requires: [], lessons: [lesson('a', [task('a1'), task('a2', 'plan')]), lesson('b', [task('b1')], ['a'])] },
    { id: 'w2', title: '', summary: '', requires: ['w1'], lessons: [lesson('c', [task('c1')])] },
  ],
};

const solved = (...ids: string[]): CourseProgress => ({
  ...EMPTY_COURSE,
  tasks: Object.fromEntries(ids.map((id) => [id, { ...EMPTY_TASK, solved: true, attempts: 1, xp: 10, firstTry: true }])),
});

describe('xp and levels', () => {
  it('reduces rewards for hints and removes them for a shown solution', () => {
    expect(taskXp(20, 0, false)).toBe(20);
    expect(taskXp(20, 1, false)).toBe(15);
    expect(taskXp(20, 5, false)).toBe(10);
    expect(taskXp(20, 0, true)).toBe(0);
  });

  it('adds a bonus per completed lesson', () => {
    expect(totalXp(course, solved('a1'))).toBe(10);
    expect(totalXp(course, solved('a1', 'a2'))).toBe(40);
  });

  it('places xp on the level ladder', () => {
    expect(levelInfo(0, course.levels)).toMatchObject({ index: 0, title: 'Trainee', progress: 0 });
    expect(levelInfo(85, course.levels)).toMatchObject({ index: 1, title: 'Writer', progress: 0.5 });
    expect(levelInfo(500, course.levels)).toMatchObject({ index: 2, next: null, progress: 1 });
  });
});

describe('unlocking', () => {
  it('opens lessons in order and worlds after their prerequisites', () => {
    const fresh = lessonStatuses(course, EMPTY_COURSE);
    expect([...fresh]).toEqual([
      ['a', 'available'],
      ['b', 'locked'],
      ['c', 'locked'],
    ]);
    const done = lessonStatuses(course, solved('a1', 'a2', 'b1'));
    expect(done.get('c')).toBe('available');
    expect(nextLesson(course, solved('a1', 'a2'))?.id).toBe('b');
  });

  it('credits lessons passed by placement', () => {
    const placed: CourseProgress = { ...EMPTY_COURSE, passedLessons: ['a', 'b'] };
    expect([...lessonStatuses(course, placed).values()]).toEqual(['completed', 'completed', 'available']);
  });

  it('suggests the first unsolved task of a lesson', () => {
    expect(firstOpenTask(course.worlds[0].lessons[0], solved('a1')).id).toBe('a2');
  });
});

describe('streaks', () => {
  const activity = { '2026-10-28': 1, '2026-10-29': 2, '2026-10-30': 1, '2026-11-01': 3, '2026-11-02': 1 };

  it('counts the current run, which survives until the end of the next day', () => {
    expect(streakInfo(activity, '2026-11-02')).toEqual({ current: 2, best: 3, activeToday: true });
    expect(streakInfo(activity, '2026-11-03')).toEqual({ current: 2, best: 3, activeToday: false });
    expect(streakInfo(activity, '2026-11-04').current).toBe(0);
  });

  it('works across month boundaries', () => {
    expect(streakInfo({ '2026-10-31': 1, '2026-11-01': 1 }, '2026-11-01').current).toBe(2);
  });
});

describe('badges', () => {
  const streak = { current: 0, best: 0, activeToday: false };
  const badge = (rule: Course['badges'][number]['rule']) => ({ id: 'x', title: 'X', description: 'D', glyph: 'X', rule });

  it('evaluates every rule kind', () => {
    const cp = solved('a1', 'a2', 'b1');
    expect(badgeEarned(badge({ kind: 'tasksSolved', count: 3 }), course, cp, streak)).toBe(true);
    expect(badgeEarned(badge({ kind: 'tasksOfType', type: 'plan', count: 2 }), course, cp, streak)).toBe(false);
    expect(badgeEarned(badge({ kind: 'worldCompleted', world: 'w1' }), course, cp, streak)).toBe(true);
    expect(badgeEarned(badge({ kind: 'worldCompleted', world: 'w2' }), course, cp, streak)).toBe(false);
    expect(badgeEarned(badge({ kind: 'streak', days: 3 }), course, cp, { ...streak, best: 3 })).toBe(true);
    expect(badgeEarned(badge({ kind: 'firstTry', count: 4 }), course, cp, streak)).toBe(false);
  });
});

describe('migrate', () => {
  it('accepts the current version and discards unreadable data', () => {
    expect(migrate(undefined)).toMatchObject({ discarded: false, doc: { schemaVersion: 1 } });
    expect(migrate({ schemaVersion: 1, courses: { c: { tasks: {} } } }).doc.courses.c.passedLessons).toEqual([]);
    expect(migrate({ schemaVersion: 99 }).discarded).toBe(true);
    expect(migrate('garbage').discarded).toBe(true);
  });
});
