import type { Course } from '@/content/loadCourse';

/** Hint for a failed console command: exact broker error code only (no prefix matching, codes are not SQLSTATE). */
export function consoleHint(course: Course, code: string | undefined): string | undefined {
  return code === undefined ? undefined : course.errorHints[code];
}
