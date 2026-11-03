import { loadCourse } from './loadCourse';

const files = import.meta.glob<string>('/courses/postgres/**/*.{json,md,sql}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The bundled course. Content is validated by `npm run validate:content`, so loading does not fail at runtime. */
export const course = loadCourse(files, '/courses/postgres');
