import { create } from 'zustand';
import { courseById, courses, platform } from '@/content/courses';
import type { Task } from '@/content/loadCourse';
import type { Badge, PlatformBadge } from '@/content/schema';
import { readStore, writeStore } from '@/platform';

/** Badge key prefix of the cross-course badges from platform.json. */
export const PLATFORM = 'platform';
import { recordOutcome, type DrillOutcome, type DrillRules } from './drill';
import { badgeEarned, LESSON_BONUS_XP, levelInfo, platformBadgeEarned, localDay, progressOf, streakInfo, taskXp, totalXp } from './gamification';
import {
  badgeKey,
  EMPTY_COURSE,
  emptyProgress,
  migrate,
  type CourseProgress,
  type ProgressDoc,
  type SetResult,
  type TaskProgress,
} from './model';

const STORE_KEY = 'progress';
const SAVE_DELAY_MS = 400;

export interface SolveReward {
  xp: number;
  badges: (Badge | PlatformBadge)[];
  levelUp: string | null;
}

type TaskRef = Pick<Task, 'id' | 'courseId'>;

interface ProgressState {
  doc: ProgressDoc;
  load: () => Promise<void>;
  saveDraft: (task: Task, code: string) => void;
  useHint: (task: Task) => void;
  revealSolution: (task: Task) => void;
  /** Returns the reward when this attempt solves the task for the first time. */
  recordAttempt: (task: Task, passed: boolean) => SolveReward | null;
  /** One answer of the drill; returns the reward when it earned XP, a badge or a level. */
  recordDrill: (courseId: string, o: DrillOutcome, rules: DrillRules) => SolveReward | null;
  /** A finished full set: all its answers plus the set summary (the last 20 sets are kept). */
  recordSet: (courseId: string, r: SetResult, outcomes: DrillOutcome[], rules: DrillRules) => SolveReward | null;
  passLessons: (courseId: string, lessonIds: string[]) => void;
  completeOnboarding: (courseId: string, path: 'beginner' | 'experienced') => void;
  resetAll: () => void;
}

export const courseProgress = (doc: ProgressDoc, courseId: string): CourseProgress => doc.courses[courseId] ?? EMPTY_COURSE;
export const selectCourse = (courseId: string) => (s: Pick<ProgressState, 'doc'>) => courseProgress(s.doc, courseId);
export const selectTask = (task: TaskRef) => (s: Pick<ProgressState, 'doc'>) =>
  progressOf(courseProgress(s.doc, task.courseId), task.id);

/** XP of stored progress whose course is not registered (e.g. a sealed pack whose access was closed). */
const storedXp = (cp: CourseProgress): number =>
  Object.values(cp.tasks).reduce((sum, t) => sum + t.xp, 0) + cp.passedLessons.length * LESSON_BONUS_XP + (cp.drill?.xp ?? 0);

/** XP and level are shared by all courses, including those whose progress is kept but that are not registered now. */
export const globalXp = (doc: ProgressDoc): number => {
  const known = new Set(courses.map((c) => c.id));
  const stored = Object.entries(doc.courses).reduce((sum, [id, cp]) => sum + (known.has(id) ? 0 : storedXp(cp)), 0);
  return courses.reduce((sum, c) => sum + totalXp(c, courseProgress(doc, c.id)), 0) + stored;
};

function withCourse(doc: ProgressDoc, courseId: string, change: (cp: CourseProgress) => CourseProgress): ProgressDoc {
  return { ...doc, courses: { ...doc.courses, [courseId]: change(courseProgress(doc, courseId)) } };
}

function withTask(doc: ProgressDoc, task: TaskRef, change: (t: TaskProgress) => Partial<TaskProgress>): ProgressDoc {
  return withCourse(doc, task.courseId, (cp) => {
    const current = progressOf(cp, task.id);
    return { ...cp, tasks: { ...cp.tasks, [task.id]: { ...current, ...change(current) } } };
  });
}

/** Badges newly earned by `after` are stamped into it; the reward is the difference to `before`. */
function award(before: ProgressDoc, after: ProgressDoc, courseId: string, today: string): { doc: ProgressDoc; reward: SolveReward } {
  const course = courseById(courseId);
  const streak = streakInfo(after.activity, today);
  const cp = courseProgress(after, course.id);
  const earned = course.badges.filter((b) => !after.badges[badgeKey(course.id, b.id)] && badgeEarned(b, course, cp, streak));
  const shared = platform.badges.filter(
    (b) => !after.badges[badgeKey(PLATFORM, b.id)] && platformBadgeEarned(b, courses, (id) => courseProgress(after, id)),
  );
  const earnedAt = new Date().toISOString();
  const keys = [...earned.map((b) => badgeKey(course.id, b.id)), ...shared.map((b) => badgeKey(PLATFORM, b.id))];
  const doc = { ...after, badges: { ...after.badges, ...Object.fromEntries(keys.map((k) => [k, earnedAt])) } };
  const levelBefore = levelInfo(globalXp(before), platform.levels);
  const levelAfter = levelInfo(globalXp(doc), platform.levels);
  return {
    doc,
    reward: {
      xp: globalXp(doc) - globalXp(before),
      badges: [...earned, ...shared],
      levelUp: levelAfter.index > levelBefore.index ? levelAfter.title : null,
    },
  };
}

/** Applies one drill answer: number statistics and XP, the shared streak, and the task as solved on its first win. */
function withDrillOutcome(doc: ProgressDoc, courseId: string, o: DrillOutcome, rules: DrillRules, today: string): ProgressDoc {
  const cp = courseProgress(doc, courseId);
  const { dp } = recordOutcome(cp.drill, o, rules, today);
  let next = withCourse(doc, courseId, (c) => ({ ...c, drill: dp }));
  if (!o.correct) return next;
  next = { ...next, activity: { ...next.activity, [today]: (next.activity[today] ?? 0) + 1 } };
  const before = progressOf(courseProgress(next, courseId), o.taskId);
  if (o.level !== 'base' && !before.solved) {
    next = withTask(next, { id: o.taskId, courseId }, (t) => ({
      attempts: t.attempts + 1,
      solved: true,
      solvedAt: new Date().toISOString(),
      xp: 0,
      firstTry: o.firstTry && o.hintsUsed === 0 && !o.solutionShown,
    }));
  }
  return next;
}

const rewarded = (r: SolveReward): SolveReward | null => (r.xp > 0 || r.badges.length > 0 || r.levelUp ? r : null);

export const useProgress = create<ProgressState>((set, get) => {
  const update = (change: (doc: ProgressDoc) => ProgressDoc) => set({ doc: change(get().doc) });

  return {
    doc: emptyProgress(),

    load: async () => {
      const raw = await readStore<unknown>(STORE_KEY);
      const { doc, discarded, migratedFrom } = migrate(raw);
      // Keep the original data next to the migrated copy: progress must never be lost.
      if (discarded) await writeStore(`${STORE_KEY}-unreadable`, raw);
      if (migratedFrom !== undefined) await writeStore(`${STORE_KEY}-v${migratedFrom}-backup`, raw);
      set({ doc });
    },

    saveDraft: (task, code) => update((d) => withTask(d, task, () => ({ draft: code }))),
    useHint: (task) => update((d) => withTask(d, task, (t) => ({ hintsUsed: Math.min(t.hintsUsed + 1, task.hints.length) }))),
    revealSolution: (task) => update((d) => withTask(d, task, () => ({ solutionShown: true }))),

    recordAttempt: (task, passed) => {
      const doc = get().doc;
      const before = progressOf(courseProgress(doc, task.courseId), task.id);
      const attempts = before.attempts + 1;
      if (before.solved || !passed) {
        update((d) => withTask(d, task, () => ({ attempts })));
        return null;
      }

      const today = localDay();
      let next = withTask(doc, task, (t) => ({
        attempts,
        solved: true,
        solvedAt: new Date().toISOString(),
        xp: taskXp(task.xp, t.hintsUsed, t.solutionShown),
        firstTry: attempts === 1 && t.hintsUsed === 0 && !t.solutionShown,
      }));
      next = { ...next, activity: { ...next.activity, [today]: (next.activity[today] ?? 0) + 1 } };

      const { doc: awarded, reward } = award(doc, next, task.courseId, today);
      set({ doc: awarded });
      return reward;
    },

    recordDrill: (courseId, o, rules) => {
      const before = get().doc;
      const today = localDay();
      const { doc, reward } = award(before, withDrillOutcome(before, courseId, o, rules, today), courseId, today);
      set({ doc });
      return rewarded(reward);
    },

    recordSet: (courseId, r, outcomes, rules) => {
      const before = get().doc;
      const today = localDay();
      let next = before;
      for (const o of outcomes) next = withDrillOutcome(next, courseId, o, rules, today);
      next = withCourse(next, courseId, (c) => {
        const drill = c.drill ?? { xp: 0, numbers: {}, sets: [] };
        return { ...c, drill: { ...drill, sets: [...drill.sets, r].slice(-20) } };
      });
      const { doc, reward } = award(before, next, courseId, today);
      set({ doc });
      return rewarded(reward);
    },

    passLessons: (courseId, lessonIds) =>
      update((d) => withCourse(d, courseId, (cp) => ({ ...cp, passedLessons: [...new Set([...cp.passedLessons, ...lessonIds])] }))),

    completeOnboarding: (courseId, path) =>
      update((d) => withCourse(d, courseId, (cp) => ({ ...cp, onboarding: { path, completedAt: new Date().toISOString() } }))),

    resetAll: () => set({ doc: emptyProgress() }),
  };
});

let saveTimer: ReturnType<typeof setTimeout> | undefined;
const flush = () => {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  void writeStore(STORE_KEY, useProgress.getState().doc);
};

useProgress.subscribe((state, previous) => {
  if (state.doc === previous.doc) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DELAY_MS);
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => saveTimer && flush());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveTimer && flush());
}
