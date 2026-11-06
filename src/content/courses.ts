import { useMemo } from 'react';
import { create } from 'zustand';
import { loadCatalog } from './catalog';
import type { Course } from './loadCourse';

const files = import.meta.glob<string>('/courses/**/*.{json,md,sql,graphql,proto}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** All bundled courses. Content is validated by `npm run validate:content`, so loading does not fail at runtime. */
export const catalog = loadCatalog(files);
/** Same array for the whole session: sealed courses are added and removed in place. */
export const courses = catalog.courses;
export const platform = catalog.platform;

const bundledCount = courses.length;

export const useCourseList = create<{ version: number }>(() => ({ version: 0 }));
const bump = () => useCourseList.setState((s) => ({ version: s.version + 1 }));

/** Adds (or replaces) a sealed course. */
export function registerSealed(course: Course): void {
  const i = courses.findIndex((c) => c.id === course.id);
  if (i >= 0 && i < bundledCount) return;
  if (i >= 0) courses[i] = course;
  else courses.push(course);
  bump();
}

/** Removes every sealed course, or only the given ids. */
export function unregisterSealed(ids?: string[]): void {
  let changed = false;
  for (let i = courses.length - 1; i >= bundledCount; i--) {
    if (ids && !ids.includes(courses[i].id)) continue;
    courses.splice(i, 1);
    changed = true;
  }
  if (changed) bump();
}

/** Reactive course list: re-renders when sealed courses appear or disappear. */
export function useCourses(): Course[] {
  const version = useCourseList((s) => s.version);
  return useMemo(() => courses.slice(), [version]);
}

export function courseById(id: string): Course {
  return courses.find((c) => c.id === id) ?? courses[0];
}
