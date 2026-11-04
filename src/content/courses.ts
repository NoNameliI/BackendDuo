import { loadCatalog } from './catalog';
import type { Course } from './loadCourse';

const files = import.meta.glob<string>('/courses/**/*.{json,md,sql}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** All bundled courses. Content is validated by `npm run validate:content`, so loading does not fail at runtime. */
export const catalog = loadCatalog(files);
export const courses = catalog.courses;
export const platform = catalog.platform;

export function courseById(id: string): Course {
  return courses.find((c) => c.id === id) ?? courses[0];
}
