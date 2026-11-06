import { courseById } from '@/content/courses';
import { useWorkspace } from '@/features/lesson/workspace';
import { courseProgress, useProgress } from '@/progress/store';
import { useUi } from './store';

/** Makes a course active and shows its onboarding the first time, its skill map afterwards. */
export function openCourse(courseId: string): void {
  const ui = useUi.getState();
  if (ui.courseId !== courseId) {
    useWorkspace.getState().closeTask();
    ui.setCourse(courseId);
  }
  const course = courseById(courseId);
  const started = courseProgress(useProgress.getState().doc, courseId).onboarding;
  ui.setView(course.drill ? 'drill' : course.onboarding && !started ? 'onboarding' : 'map');
}
