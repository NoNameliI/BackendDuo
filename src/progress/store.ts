import { create } from 'zustand';
import { courseById, courses, platform } from '@/content/courses';
import type { Task } from '@/content/loadCourse';
import type { Badge } from '@/content/schema';
import { readStore, writeStore } from '@/platform';
import { badgeEarned, levelInfo, localDay, progressOf, streakInfo, taskXp, totalXp } from './gamification';
import {
  badgeKey,
  EMPTY_COURSE,
  emptyProgress,
  migrate,
  type CourseProgress,
  type ProgressDoc,
  type TaskProgress,
} from './model';

const STORE_KEY = 'progress';
const SAVE_DELAY_MS = 400;

export interface SolveReward {
  xp: number;
  badges: Badge[];
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
  passLessons: (courseId: string, lessonIds: string[]) => void;
  completeOnboarding: (courseId: string, path: 'beginner' | 'experienced') => void;
  resetAll: () => void;
}

export const courseProgress = (doc: ProgressDoc, courseId: string): CourseProgress => doc.courses[courseId] ?? EMPTY_COURSE;
export const selectCourse = (courseId: string) => (s: Pick<ProgressState, 'doc'>) => courseProgress(s.doc, courseId);
export const selectTask = (task: TaskRef) => (s: Pick<ProgressState, 'doc'>) =>
  progressOf(courseProgress(s.doc, task.courseId), task.id);

/** XP and level are shared by all courses. */
export const globalXp = (doc: ProgressDoc): number =>
  courses.reduce((sum, c) => sum + totalXp(c, courseProgress(doc, c.id)), 0);

function withCourse(doc: ProgressDoc, courseId: string, change: (cp: CourseProgress) => CourseProgress): ProgressDoc {
  return { ...doc, courses: { ...doc.courses, [courseId]: change(courseProgress(doc, courseId)) } };
}

function withTask(doc: ProgressDoc, task: TaskRef, change: (t: TaskProgress) => Partial<TaskProgress>): ProgressDoc {
  return withCourse(doc, task.courseId, (cp) => {
    const current = progressOf(cp, task.id);
    return { ...cp, tasks: { ...cp.tasks, [task.id]: { ...current, ...change(current) } } };
  });
}

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

      const course = courseById(task.courseId);
      const streak = streakInfo(next.activity, today);
      const cp = courseProgress(next, course.id);
      const badges = course.badges.filter((b) => !next.badges[badgeKey(course.id, b.id)] && badgeEarned(b, course, cp, streak));
      const earnedAt = new Date().toISOString();
      next = { ...next, badges: { ...next.badges, ...Object.fromEntries(badges.map((b) => [badgeKey(course.id, b.id), earnedAt])) } };
      set({ doc: next });

      const xpBefore = globalXp(doc);
      const xpAfter = globalXp(next);
      const levelBefore = levelInfo(xpBefore, platform.levels);
      const levelAfter = levelInfo(xpAfter, platform.levels);
      return { xp: xpAfter - xpBefore, badges, levelUp: levelAfter.index > levelBefore.index ? levelAfter.title : null };
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
