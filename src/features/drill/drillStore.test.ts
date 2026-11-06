import { describe, expect, it } from 'vitest';
import { loadCourse } from '@/content/loadCourse';
import type { DrillOutcome } from '@/progress/drill';
import type { SetResult } from '@/progress/model';
import { buildSet, canShowSolution, createDrillStore, remainingSeconds, scoreSet, weakAdvance, weakAfter, type DrillDeps, type SavedSet } from './drillStore';

const files = import.meta.glob<string>('/src/engine/drill/fixture/*.{json,md}', { query: '?raw', import: 'default', eager: true });
const course = loadCourse(files, '/src/engine/drill/fixture');

function harness(opts: { weak?: number[]; saved?: SavedSet } = {}) {
  const clock = { now: 1_000_000 };
  const outcomes: DrillOutcome[] = [];
  const sets: { result: SetResult; outcomes: DrillOutcome[] }[] = [];
  let saved: SavedSet | null = opts.saved ?? null;
  let seed = 100;
  const deps: DrillDeps = {
    now: () => clock.now,
    randomSeed: () => ++seed,
    course: () => course,
    record: (_id, o) => {
      outcomes.push(o);
      return null;
    },
    recordSet: (_id, result, list) => {
      sets.push({ result, outcomes: list });
      return null;
    },
    weak: () => opts.weak ?? [],
    seen: () => true,
    load: async () => saved ?? undefined,
    save: (s) => {
      saved = s;
    },
    reward: () => {},
  };
  const store = createDrillStore(deps);
  store.getState().enter('fixture');
  return { store, clock, outcomes, sets, saved: () => saved };
}

describe('drill store: practice', () => {
  it('unlocks the solution after solutionAfterAttempts wrong checks and records one failed outcome', () => {
    const { store, outcomes } = harness();
    store.getState().openNumber(14, { level: 'base', seed: 7 });
    expect(course.solutionAfterAttempts).toBe(3);
    const wrong = (store.getState().practice!.instance!.answer + '1').replace(/^-/, '');
    for (let i = 1; i <= 3; i++) {
      expect(canShowSolution(store.getState().practice!.wrong, course.solutionAfterAttempts)).toBe(false);
      store.getState().revealSolution();
      expect(store.getState().practice!.solutionShown).toBe(false);
      store.getState().setInput(wrong);
      store.getState().check();
      expect(store.getState().practice!.wrong).toBe(i);
    }
    expect(canShowSolution(2, 3)).toBe(false);
    expect(canShowSolution(3, 3)).toBe(true);
    store.getState().revealSolution();
    const p = store.getState().practice!;
    expect(p.solutionShown).toBe(true);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ n: 14, correct: false, solutionShown: true, firstTry: false });
    store.getState().setInput(p.instance!.answer);
    store.getState().check();
    expect(outcomes).toHaveLength(1);
  });

  it('a format problem is not an attempt; a right answer is recorded with hints and first try', () => {
    const { store, outcomes } = harness();
    store.getState().openNumber(14, { level: 'base', seed: 9 });
    store.getState().setInput('1 00');
    store.getState().check();
    expect(store.getState().practice).toMatchObject({ problem: 'format', wrong: 0 });
    store.getState().revealHint();
    store.getState().revealHint();
    store.getState().setInput(store.getState().practice!.instance!.answer);
    store.getState().check();
    expect(store.getState().practice!.solved).toBe(true);
    expect(outcomes).toEqual([expect.objectContaining({ correct: true, hintsUsed: 2, firstTry: true, solutionShown: false })]);
  });

  it('leaving an instance after wrong checks records it as failed', () => {
    const { store, outcomes } = harness();
    store.getState().openNumber(14, { level: 'base', seed: 3 });
    store.getState().setInput('99999999');
    store.getState().check();
    store.getState().newInstance();
    expect(outcomes).toEqual([expect.objectContaining({ correct: false, solutionShown: false })]);
  });
});

describe('drill store: set', () => {
  it('scores a set from its seeds, blanks are wrong', () => {
    const built = buildSet(course, 12345, 'core');
    expect(built).toHaveLength(1);
    const right = built[0].instance.answer;
    expect(scoreSet(built, { 14: right })).toMatchObject({ score: 1, rows: [{ n: 14, ok: true }] });
    expect(scoreSet(built, { 14: ' ' }).score).toBe(0);
    expect(scoreSet(built, {}).rows[0].given).toBe('');
  });

  it('finishes with the saved answers, records the result and clears the saved set', () => {
    const { store, clock, sets, saved } = harness();
    store.getState().startSet();
    const run = store.getState().set!;
    expect(saved()).toMatchObject({ master: run.master });
    const answer = buildSet(course, run.master, run.level)[0].instance.answer;
    store.getState().setAnswer(14, answer);
    expect(saved()!.answers[14]).toBe(answer);
    clock.now += 125_000;
    store.getState().finishSet();
    expect(store.getState().screen).toBe('result');
    expect(sets[0].result).toMatchObject({ score: 1, max: 1, seconds: 125, wrong: [] });
    expect(sets[0].outcomes).toHaveLength(1);
    expect(saved()).toBeNull();
  });

  it('keeps time by the wall clock: a restored set past its time finishes at once', async () => {
    expect(remainingSeconds(0, 30, 29 * 60 * 1000)).toBe(60);
    expect(remainingSeconds(0, 30, 31 * 60 * 1000)).toBe(0);
    const startedAt = 1_000_000 - 31 * 60 * 1000;
    const { store, sets } = harness({ saved: { courseId: 'fixture', master: 5, level: 'core', startedAt, answers: {} } });
    await store.getState().restore();
    expect(store.getState().saved).not.toBeNull();
    store.getState().resumeSet();
    expect(store.getState().screen).toBe('result');
    expect(sets[0].result).toMatchObject({ score: 0, seconds: 30 * 60, wrong: [14] });
  });
});

describe('drill store: weak mode', () => {
  it('a number leaves the queue after two right answers in a row', () => {
    let w = { queue: [3, 5], streak: {} as Record<number, number> };
    w = weakAfter(w, 3, true);
    expect(w.queue).toEqual([3, 5]);
    w = weakAfter(w, 3, false);
    w = weakAfter(w, 3, true);
    expect(w.queue).toEqual([3, 5]);
    w = weakAfter(w, 3, true);
    expect(w.queue).toEqual([5]);
    expect(weakAdvance(w, 3).next).toBe(5);
    expect(weakAdvance({ queue: [3, 5], streak: {} }, 3)).toMatchObject({ next: 5, weak: { queue: [5, 3] } });
  });

  it('runs through the store: two good answers finish the queue', () => {
    const { store } = harness({ weak: [14] });
    expect(store.getState().startWeak()).toBe(true);
    for (let i = 0; i < 2; i++) {
      store.getState().setInput(store.getState().practice!.instance!.answer);
      store.getState().check();
      expect(store.getState().practice!.solved).toBe(true);
      if (i === 0) {
        expect(store.getState().weak!.queue).toEqual([14]);
        store.getState().weakNext();
      }
    }
    expect(store.getState().weak!.queue).toEqual([]);
    store.getState().weakNext();
    expect(store.getState()).toMatchObject({ weakDone: true, screen: 'home' });
  });

  it('is unavailable without weak numbers', () => {
    expect(harness().store.getState().startWeak()).toBe(false);
  });
});
