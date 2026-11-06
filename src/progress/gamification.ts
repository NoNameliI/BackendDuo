import type { Course, Lesson, Task, World } from '@/content/loadCourse';
import type { Badge, Level, PlatformBadge } from '@/content/schema';
import { EMPTY_TASK, type CourseProgress, type TaskProgress } from './model';

export const LESSON_BONUS_XP = 20;
const HINT_PENALTY = 0.25;
const MIN_XP_SHARE = 0.5;

/** Each hint costs a quarter of the reward (never below half); a revealed solution earns nothing. */
export function taskXp(base: number, hintsUsed: number, solutionShown: boolean): number {
  if (solutionShown) return 0;
  return Math.round(base * Math.max(MIN_XP_SHARE, 1 - HINT_PENALTY * hintsUsed));
}

export const progressOf = (cp: CourseProgress, taskId: string): TaskProgress => cp.tasks[taskId] ?? EMPTY_TASK;

export function isLessonComplete(lesson: Lesson, cp: CourseProgress): boolean {
  return cp.passedLessons.includes(lesson.id) || (lesson.tasks.length > 0 && lesson.tasks.every((t) => progressOf(cp, t.id).solved));
}

export function isWorldComplete(world: World, cp: CourseProgress): boolean {
  return world.lessons.length > 0 && world.lessons.every((l) => isLessonComplete(l, cp));
}

export type LessonStatus = 'completed' | 'available' | 'locked';

export function lessonStatuses(course: Course, cp: CourseProgress): Map<string, LessonStatus> {
  const completed = new Set(course.worlds.flatMap((w) => w.lessons.filter((l) => isLessonComplete(l, cp)).map((l) => l.id)));
  const worldDone = new Set(course.worlds.filter((w) => isWorldComplete(w, cp)).map((w) => w.id));
  const statuses = new Map<string, LessonStatus>();
  for (const world of course.worlds) {
    const touched = world.lessons.some((l) => completed.has(l.id) || l.tasks.some((t) => progressOf(cp, t.id).attempts > 0));
    const open = touched || world.requires.every((id) => worldDone.has(id));
    for (const lesson of world.lessons) {
      if (completed.has(lesson.id)) statuses.set(lesson.id, 'completed');
      else statuses.set(lesson.id, open && lesson.requires.every((id) => completed.has(id)) ? 'available' : 'locked');
    }
  }
  return statuses;
}

/** First lesson to continue with, in course order. */
export function nextLesson(course: Course, cp: CourseProgress): Lesson | null {
  const statuses = lessonStatuses(course, cp);
  return course.worlds.flatMap((w) => w.lessons).find((l) => statuses.get(l.id) === 'available') ?? null;
}

export function firstOpenTask(lesson: Lesson, cp: CourseProgress): Task {
  return lesson.tasks.find((t) => !progressOf(cp, t.id).solved) ?? lesson.tasks[0];
}

/** Where "continue learning" leads: the next available lesson, or the very first one. */
export function resumeTask(course: Course, cp: CourseProgress): Task {
  const lesson = nextLesson(course, cp) ?? course.worlds.flatMap((w) => w.lessons)[0];
  return firstOpenTask(lesson, cp);
}

export function totalXp(course: Course, cp: CourseProgress): number {
  const tasks = Object.values(cp.tasks).reduce((sum, t) => sum + t.xp, 0);
  const lessons = course.worlds.flatMap((w) => w.lessons).filter((l) => isLessonComplete(l, cp)).length;
  return tasks + lessons * LESSON_BONUS_XP;
}

export interface LevelInfo {
  index: number;
  title: string;
  floor: number;
  next: Level | null;
  /** 0..1 towards the next level (1 at the top level). */
  progress: number;
}

export function levelInfo(xp: number, levels: Level[]): LevelInfo {
  const index = levels.findLastIndex((l) => xp >= l.xp);
  const current = levels[index];
  const next = levels[index + 1] ?? null;
  return {
    index,
    title: current.title,
    floor: current.xp,
    next,
    progress: next ? (xp - current.xp) / (next.xp - current.xp) : 1,
  };
}

/** Local calendar day as YYYY-MM-DD. */
export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};

export interface StreakInfo {
  current: number;
  best: number;
  activeToday: boolean;
}

/** A streak survives until the end of the day after the last active day. */
export function streakInfo(activity: Record<string, number>, today: string): StreakInfo {
  const days = new Set(Object.keys(activity).filter((d) => activity[d] > 0).map(dayNumber));
  const now = dayNumber(today);
  const activeToday = days.has(now);
  let current = 0;
  for (let d = activeToday ? now : now - 1; days.has(d); d--) current++;

  let best = 0;
  for (const d of days) {
    if (days.has(d - 1)) continue;
    let run = 1;
    while (days.has(d + run)) run++;
    best = Math.max(best, run);
  }
  return { current, best, activeToday };
}

export function badgeEarned(badge: Badge, course: Course, cp: CourseProgress, streak: StreakInfo): boolean {
  const tasks = course.worlds.flatMap((w) => w.lessons.flatMap((l) => l.tasks));
  const solved = tasks.filter((t) => progressOf(cp, t.id).solved);
  const rule = badge.rule;
  switch (rule.kind) {
    case 'tasksSolved':
      return solved.length >= rule.count;
    case 'tasksOfType':
      return solved.filter((t) => t.type === rule.type).length >= rule.count;
    case 'worldCompleted': {
      const world = course.worlds.find((w) => w.id === rule.world);
      return world !== undefined && isWorldComplete(world, cp);
    }
    case 'streak':
      return streak.best >= rule.days;
    case 'firstTry':
      return solved.filter((t) => progressOf(cp, t.id).firstTry).length >= rule.count;
  }
}

/** A platform badge: at least `tasks` solved tasks in every course. */
export function platformBadgeEarned(badge: PlatformBadge, courses: Course[], progress: (courseId: string) => CourseProgress): boolean {
  return courses.filter((c) => !c.sealed).every((course) => {
    const cp = progress(course.id);
    const solved = course.worlds.flatMap((w) => w.lessons.flatMap((l) => l.tasks)).filter((t) => progressOf(cp, t.id).solved);
    return solved.length >= badge.rule.tasks;
  });
}
