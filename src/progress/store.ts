import { create } from 'zustand';
import { course } from '@/content/course';
import type { Task } from '@/content/loadCourse';
import type { Badge } from '@/content/schema';
import { readStore, writeStore } from '@/platform';
import { badgeEarned, levelInfo, localDay, progressOf, streakInfo, taskXp, totalXp } from './gamification';
import { EMPTY_COURSE, emptyProgress, migrate, type CourseProgress, type ProgressDoc, type TaskProgress } from './model';

const STORE_KEY = 'progress';
const SAVE_DELAY_MS = 400;

export interface SolveReward {
  xp: number;
  badges: Badge[];
  levelUp: string | null;
}

interface ProgressState {
  doc: ProgressDoc;
  load: () => Promise<void>;
  saveDraft: (task: Task, code: string) => void;
  useHint: (task: Task) => void;
  revealSolution: (task: Task) => void;
  /** Returns the reward when this attempt solves the task for the first time. */
  recordAttempt: (task: Task, passed: boolean) => SolveReward | null;
  passLessons: (lessonIds: string[]) => void;
  completeOnboarding: (path: 'beginner' | 'experienced', startLesson?: string) => void;
  resetAll: () => void;
}

export const courseProgress = (doc: ProgressDoc): CourseProgress => doc.courses[course.id] ?? EMPTY_COURSE;
export const selectCourse = (s: Pick<ProgressState, 'doc'>) => courseProgress(s.doc);
export const selectTask = (taskId: string) => (s: Pick<ProgressState, 'doc'>) => progressOf(courseProgress(s.doc), taskId);

function withCourse(doc: ProgressDoc, change: (cp: CourseProgress) => CourseProgress): ProgressDoc {
  return { ...doc, courses: { ...doc.courses, [course.id]: change(courseProgress(doc)) } };
}

function withTask(doc: ProgressDoc, taskId: string, change: (t: TaskProgress) => Partial<TaskProgress>): ProgressDoc {
  return withCourse(doc, (cp) => {
    const current = progressOf(cp, taskId);
    return { ...cp, tasks: { ...cp.tasks, [taskId]: { ...current, ...change(current) } } };
  });
}

export const useProgress = create<ProgressState>((set, get) => {
  const update = (change: (doc: ProgressDoc) => ProgressDoc) => set({ doc: change(get().doc) });

  return {
    doc: emptyProgress(),

    load: async () => {
      const raw = await readStore<unknown>(STORE_KEY);
      const { doc, discarded } = migrate(raw);
      if (discarded) await writeStore(`${STORE_KEY}-unreadable`, raw);
      set({ doc });
    },

    saveDraft: (task, code) => update((d) => withTask(d, task.id, () => ({ draft: code }))),
    useHint: (task) => update((d) => withTask(d, task.id, (t) => ({ hintsUsed: Math.min(t.hintsUsed + 1, task.hints.length) }))),
    revealSolution: (task) => update((d) => withTask(d, task.id, () => ({ solutionShown: true }))),

    recordAttempt: (task, passed) => {
      const doc = get().doc;
      const before = progressOf(courseProgress(doc), task.id);
      const attempts = before.attempts + 1;
      if (before.solved || !passed) {
        update((d) => withTask(d, task.id, () => ({ attempts })));
        return null;
      }

      const today = localDay();
      let next = withTask(doc, task.id, (t) => ({
        attempts,
        solved: true,
        solvedAt: new Date().toISOString(),
        xp: taskXp(task.xp, t.hintsUsed, t.solutionShown),
        firstTry: attempts === 1 && t.hintsUsed === 0 && !t.solutionShown,
      }));
      next = { ...next, activity: { ...next.activity, [today]: (next.activity[today] ?? 0) + 1 } };

      const xpBefore = totalXp(course, courseProgress(doc));
      const xpAfter = totalXp(course, courseProgress(next));
      const streak = streakInfo(next.activity, today);
      const badges = course.badges.filter((b) => !next.badges[b.id] && badgeEarned(b, course, courseProgress(next), streak));
      const earnedAt = new Date().toISOString();
      next = { ...next, badges: { ...next.badges, ...Object.fromEntries(badges.map((b) => [b.id, earnedAt])) } };
      set({ doc: next });

      const levelBefore = levelInfo(xpBefore, course.levels);
      const levelAfter = levelInfo(xpAfter, course.levels);
      return { xp: xpAfter - xpBefore, badges, levelUp: levelAfter.index > levelBefore.index ? levelAfter.title : null };
    },

    passLessons: (lessonIds) =>
      update((d) => withCourse(d, (cp) => ({ ...cp, passedLessons: [...new Set([...cp.passedLessons, ...lessonIds])] }))),

    completeOnboarding: (path, startLesson) =>
      update((d) => ({ ...d, onboarding: { path, startLesson, completedAt: new Date().toISOString() } })),

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
