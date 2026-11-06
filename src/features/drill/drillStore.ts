import { create } from 'zustand';
import { courseById } from '@/content/courses';
import type { Course, DrillConfig, Task } from '@/content/loadCourse';
import type { DrillTask } from '@/content/schema';
import { normalizeAnswer, sameAnswer } from '@/engine/drill/answer';
import { makeInstance, setSeeds } from '@/engine/drill/instance';
import { randomSeed } from '@/engine/drill/rng';
import type { Instance, Level } from '@/engine/drill/types';
import { readStore, writeStore } from '@/platform';
import { weakNumbers, type DrillOutcome, type DrillRules } from '@/progress/drill';
import { courseProgress, useProgress, type SolveReward } from '@/progress/store';
import type { SetResult } from '@/progress/model';
import { useToasts } from '@/ui/toasts';

export type DrillScreenId = 'home' | 'number' | 'set' | 'result';
export type NumberTab = 'theory' | 'task';
export type Problem = 'empty' | 'format';

export const SET_KEY = 'drill-set';

type Lesson = Course['worlds'][number]['lessons'][number];
export type DrillLessonTask = Task & DrillTask;

const isDrill = (t: Task): t is DrillLessonTask => t.type === 'drill';

export function lessonOfNumber(course: Course, n: number): Lesson | null {
  const entry = course.drill?.numbers.find((x) => x.n === n);
  return entry ? (course.worlds.flatMap((w) => w.lessons).find((l) => l.id === entry.lesson) ?? null) : null;
}

/** The statement template of a number for a seed: shapes alternate with the seed, restricted to the level. */
export function taskFor(course: Course, n: number, level: Level, seed: number): DrillLessonTask | null {
  const all = lessonOfNumber(course, n)?.tasks.filter(isDrill) ?? [];
  const fit = all.filter((t) => t.levels.includes(level));
  const pool = fit.length > 0 ? fit : all;
  return pool.length > 0 ? pool[seed % pool.length] : null;
}

export interface Built {
  n: number;
  task: DrillLessonTask;
  instance: Instance;
}

/** One instance per number of a set, rebuilt from the master seed. */
export function buildSet(course: Course, master: number, level: Level): Built[] {
  const cfg = course.drill!;
  const ns = cfg.numbers.map((x) => x.n);
  const seeds = setSeeds(master, ns);
  return ns.flatMap((n) => {
    const task = taskFor(course, n, level, seeds[n]);
    return task ? [{ n, task, instance: makeInstance(task, n, level, seeds[n]) }] : [];
  });
}

export const rulesOf = (cfg: DrillConfig): DrillRules => ({ xp: cfg.xp, dailyXp: cfg.dailyXp });

/** The solution may be shown after this many wrong checks. */
export const canShowSolution = (wrong: number, after: number | undefined): boolean => wrong >= (after ?? 1);

/** Seconds left of a set; derived from the wall clock, so it survives restarts. */
export function remainingSeconds(startedAt: number, minutes: number, now: number): number {
  return Math.max(0, Math.ceil(minutes * 60 - (now - startedAt) / 1000));
}

export interface SetRow {
  n: number;
  given: string;
  right: string;
  ok: boolean;
  seed: number;
}

/** A blank or malformed answer is wrong. */
export function scoreSet(built: Built[], answers: Record<number, string>): { rows: SetRow[]; score: number } {
  const rows = built.map(({ n, instance }) => {
    const given = answers[n] ?? '';
    return { n, given, right: instance.answer, ok: sameAnswer(given, instance.answer, instance.spec) === true, seed: instance.seed };
  });
  return { rows, score: rows.filter((r) => r.ok).length };
}

export interface WeakRun {
  /** The head is the number being practised; a number leaves after two right answers in a row. */
  queue: number[];
  streak: Record<number, number>;
}

export function weakAfter(w: WeakRun, n: number, good: boolean): WeakRun {
  const run = good ? (w.streak[n] ?? 0) + 1 : 0;
  return { streak: { ...w.streak, [n]: run }, queue: run >= 2 ? w.queue.filter((x) => x !== n) : w.queue };
}

/** Moves on: a number still in the queue goes to the back. */
export function weakAdvance(w: WeakRun, current: number): { weak: WeakRun; next: number | null } {
  const queue = w.queue[0] === current ? [...w.queue.slice(1), current] : w.queue;
  return { weak: { ...w, queue }, next: queue[0] ?? null };
}

export interface Practice {
  n: number;
  level: Level;
  instance: Instance | null;
  error: string | null;
  input: string;
  problem: Problem | null;
  /** Wrong checks of this instance. */
  wrong: number;
  hints: number;
  solutionShown: boolean;
  solved: boolean;
  recorded: boolean;
  startedAt: number;
  /** The answer was wrong at the last check. */
  missed: boolean;
}

export interface SetRun {
  master: number;
  level: Level;
  startedAt: number;
  answers: Record<number, string>;
  current: number;
}

export interface SavedSet {
  courseId: string;
  master: number;
  level: Level;
  startedAt: number;
  answers: Record<number, string>;
}

export interface SetSummary {
  result: SetResult;
  rows: SetRow[];
  /** Task of every row, to open its explanation. */
  level: Level;
}

export interface DrillDeps {
  now(): number;
  randomSeed(): number;
  course(id: string): Course;
  record(courseId: string, o: DrillOutcome, rules: DrillRules): SolveReward | null;
  recordSet(courseId: string, r: SetResult, outcomes: DrillOutcome[], rules: DrillRules): SolveReward | null;
  /** Numbers to practise again. */
  weak(courseId: string, ns: number[]): number[];
  seen(courseId: string, n: number): boolean;
  load(): Promise<SavedSet | undefined>;
  save(saved: SavedSet | null): void;
  reward(r: SolveReward | null): void;
}

export const liveDeps: DrillDeps = {
  now: () => Date.now(),
  randomSeed,
  course: courseById,
  record: (id, o, rules) => useProgress.getState().recordDrill(id, o, rules),
  recordSet: (id, r, outcomes, rules) => useProgress.getState().recordSet(id, r, outcomes, rules),
  weak: (id, ns) => weakNumbers(courseProgress(useProgress.getState().doc, id).drill, ns),
  seen: (id, n) => (courseProgress(useProgress.getState().doc, id).drill?.numbers[String(n)]?.seen ?? 0) > 0,
  load: () => readStore<SavedSet>(SET_KEY),
  save: (saved) => void writeStore(SET_KEY, saved),
  reward(r) {
    if (!r) return;
    const { push } = useToasts.getState();
    if (r.xp > 0) push({ tone: 'xp', title: `+${r.xp} XP` });
    if (r.levelUp) push({ tone: 'level', title: `Новый уровень: ${r.levelUp}` });
    r.badges.forEach((b) => push({ tone: 'badge', title: `Бейдж «${b.title}»`, body: b.description, glyph: b.glyph }));
  },
};

export interface DrillState {
  courseId: string | null;
  screen: DrillScreenId;
  level: Level;
  tab: NumberTab;
  practice: Practice | null;
  weak: WeakRun | null;
  /** Weak mode ran out of numbers. */
  weakDone: boolean;
  set: SetRun | null;
  summary: SetSummary | null;
  /** A saved set that can be resumed. */
  saved: SavedSet | null;

  enter: (courseId: string) => void;
  setLevel: (level: Level) => void;
  setTab: (tab: NumberTab) => void;
  goHome: () => void;
  openNumber: (n: number, o?: { level?: Level; seed?: number; reveal?: boolean }) => void;
  newInstance: () => void;
  stepNumber: (delta: 1 | -1) => void;
  setInput: (text: string) => void;
  check: () => void;
  revealHint: () => void;
  revealSolution: () => void;
  startSet: () => void;
  resumeSet: () => void;
  discardSet: () => void;
  selectInSet: (n: number) => void;
  setAnswer: (n: number, text: string) => void;
  finishSet: () => void;
  startWeak: () => boolean;
  weakNext: () => void;
  restore: () => Promise<void>;
}

export function createDrillStore(deps: DrillDeps = liveDeps) {
  return create<DrillState>((set, get) => {
    const course = (): Course => deps.course(get().courseId!);
    const cfg = (): DrillConfig => course().drill!;

    /** Records a failed instance that was left (or opened anew) after wrong checks. */
    const settle = () => {
      const p = get().practice;
      if (!p?.instance || p.recorded || p.solved || p.wrong === 0) return;
      outcome(p, false, false);
    };

    const outcome = (p: Practice, correct: boolean, solutionShown: boolean) => {
      const task = taskFor(course(), p.n, p.level, p.instance!.seed)!;
      const o: DrillOutcome = {
        n: p.n,
        taskId: task.id,
        level: p.level,
        correct,
        hintsUsed: p.hints,
        solutionShown,
        ms: deps.now() - p.startedAt,
        firstTry: correct && p.wrong === 0,
      };
      deps.reward(deps.record(get().courseId!, o, rulesOf(cfg())));
      const weak = get().weak;
      set({
        practice: { ...p, recorded: true },
        weak: weak ? weakAfter(weak, p.n, correct && !solutionShown) : weak,
      });
    };

    const build = (n: number, level: Level, seed: number): Practice => {
      const base: Practice = {
        n,
        level,
        instance: null,
        error: null,
        input: '',
        problem: null,
        wrong: 0,
        hints: 0,
        solutionShown: false,
        solved: false,
        recorded: false,
        startedAt: deps.now(),
        missed: false,
      };
      const task = taskFor(course(), n, level, seed);
      if (!task) return { ...base, error: 'Для этого номера нет заданий.' };
      try {
        return { ...base, instance: makeInstance(task, n, level, seed) };
      } catch (e) {
        return { ...base, error: (e as Error).message };
      }
    };

    const numbers = () => cfg().numbers.map((x) => x.n);

    const saveSet = (s: SetRun) => deps.save({ courseId: get().courseId!, master: s.master, level: s.level, startedAt: s.startedAt, answers: s.answers });

    return {
      courseId: null,
      screen: 'home',
      level: 'core',
      tab: 'task',
      practice: null,
      weak: null,
      weakDone: false,
      set: null,
      summary: null,
      saved: null,

      enter: (courseId) => {
        if (get().courseId === courseId) return;
        const next = deps.course(courseId);
        set({
          courseId,
          screen: 'home',
          level: next.drill?.set.level ?? 'core',
          practice: null,
          weak: null,
          weakDone: false,
          set: null,
          summary: null,
          saved: null,
        });
      },

      setLevel: (level) => set({ level }),
      setTab: (tab) => set({ tab }),

      goHome: () => {
        settle();
        set({ screen: 'home', practice: null, weak: null, weakDone: false });
      },

      openNumber: (n, o = {}) => {
        settle();
        const level = o.level ?? get().level;
        const seed = o.seed ?? deps.randomSeed();
        let practice = build(n, level, seed);
        if (o.reveal && practice.instance) practice = { ...practice, solutionShown: true, recorded: true };
        set({
          screen: 'number',
          tab: o.reveal ? 'task' : deps.seen(get().courseId!, n) ? 'task' : 'theory',
          practice,
          summary: o.reveal ? get().summary : null,
          weak: o.reveal ? null : get().weak,
        });
      },

      newInstance: () => {
        const p = get().practice;
        if (!p) return;
        settle();
        set({ practice: build(p.n, p.level, deps.randomSeed()) });
      },

      stepNumber: (delta) => {
        const p = get().practice;
        const ns = numbers();
        if (!p || get().weak) return;
        const next = ns[ns.indexOf(p.n) + delta];
        if (next !== undefined) get().openNumber(next, { level: p.level });
      },

      setInput: (input) => {
        const p = get().practice;
        if (p && !p.solved && !p.solutionShown) set({ practice: { ...p, input, problem: null, missed: false } });
      },

      check: () => {
        const p = get().practice;
        if (!p?.instance || p.solved || p.solutionShown) return;
        const { spec, answer } = p.instance;
        const norm = normalizeAnswer(p.input, spec);
        if (!norm.ok) {
          set({ practice: { ...p, problem: norm.problem, missed: false } });
          return;
        }
        if (sameAnswer(p.input, answer, spec)) {
          const solved = { ...p, solved: true, problem: null, missed: false };
          set({ practice: solved });
          outcome(solved, true, false);
        } else {
          set({ practice: { ...p, wrong: p.wrong + 1, problem: null, missed: true } });
        }
      },

      revealHint: () => {
        const p = get().practice;
        if (p?.instance && p.hints < 3 && !p.solved) set({ practice: { ...p, hints: p.hints + 1 } });
      },

      revealSolution: () => {
        const p = get().practice;
        if (!p?.instance || p.solved || p.solutionShown || !canShowSolution(p.wrong, course().solutionAfterAttempts)) return;
        const shown = { ...p, solutionShown: true, missed: false };
        set({ practice: shown });
        outcome(shown, false, true);
      },

      startSet: () => {
        const c = get().courseId;
        if (!c) return;
        const s: SetRun = { master: deps.randomSeed(), level: get().level, startedAt: deps.now(), answers: {}, current: numbers()[0] };
        saveSet(s);
        set({ screen: 'set', set: s, summary: null, saved: null, practice: null, weak: null });
      },

      resumeSet: () => {
        const saved = get().saved;
        if (!saved) return;
        set({
          screen: 'set',
          set: { master: saved.master, level: saved.level, startedAt: saved.startedAt, answers: saved.answers, current: numbers()[0] },
          saved: null,
          summary: null,
        });
        if (remainingSeconds(saved.startedAt, cfg().set.minutes, deps.now()) <= 0) get().finishSet();
      },

      discardSet: () => {
        deps.save(null);
        set({ saved: null });
      },

      selectInSet: (n) => {
        const s = get().set;
        if (s) set({ set: { ...s, current: n } });
      },

      setAnswer: (n, text) => {
        const s = get().set;
        if (!s) return;
        const next = { ...s, answers: { ...s.answers, [n]: text } };
        set({ set: next });
        saveSet(next);
      },

      finishSet: () => {
        const s = get().set;
        if (!s) return;
        const config = cfg();
        const built = buildSet(course(), s.master, s.level);
        const { rows, score } = scoreSet(built, s.answers);
        const seconds = Math.min(config.set.minutes * 60, Math.max(0, Math.round((deps.now() - s.startedAt) / 1000)));
        const each = built.length > 0 ? Math.round((seconds * 1000) / built.length) : 0;
        const outcomes: DrillOutcome[] = built.map((b, i) => ({
          n: b.n,
          taskId: b.task.id,
          level: s.level,
          correct: rows[i].ok,
          hintsUsed: 0,
          solutionShown: false,
          ms: each,
          firstTry: true,
        }));
        const result: SetResult = {
          at: new Date(deps.now()).toISOString(),
          level: s.level,
          score,
          max: built.length,
          seconds,
          wrong: rows.filter((r) => !r.ok).map((r) => r.n),
        };
        deps.reward(deps.recordSet(get().courseId!, result, outcomes, rulesOf(config)));
        deps.save(null);
        set({ screen: 'result', set: null, summary: { result, rows, level: s.level } });
      },

      startWeak: () => {
        const queue = deps.weak(get().courseId!, numbers());
        if (queue.length === 0) return false;
        set({ weak: { queue, streak: {} }, weakDone: false, level: 'core' });
        get().openNumber(queue[0], { level: 'core' });
        return true;
      },

      weakNext: () => {
        settle();
        const { weak, practice } = get();
        if (!weak || !practice) return;
        const { weak: next, next: n } = weakAdvance(weak, practice.n);
        set({ weak: next });
        if (n === null) set({ weakDone: true, practice: null, screen: 'home' });
        else get().openNumber(n, { level: 'core' });
      },

      restore: async () => {
        const c = get().courseId;
        const saved = await deps.load();
        if (c && c === get().courseId && saved?.courseId === c && get().screen === 'home') set({ saved });
      },
    };
  });
}

export const useDrill = createDrillStore();

/** Entry points for the command palette. */
export function openNumberOf(courseId: string, n: number): void {
  useDrill.getState().enter(courseId);
  useDrill.getState().openNumber(n);
}

export function startSetOf(courseId: string): void {
  useDrill.getState().enter(courseId);
  useDrill.getState().startSet();
}

export function startWeakOf(courseId: string): void {
  useDrill.getState().enter(courseId);
  useDrill.getState().startWeak();
}
