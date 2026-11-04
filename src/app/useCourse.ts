import { courseById } from '@/content/courses';
import type { Course } from '@/content/loadCourse';
import { useUi } from './store';

/** The course the learner is working in: map, lessons, palette and onboarding follow it. */
export const activeCourse = (): Course => courseById(useUi.getState().courseId);

export function useCourse(): Course {
  return courseById(useUi((s) => s.courseId));
}
