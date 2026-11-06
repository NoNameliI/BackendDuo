import { registerSealed } from '@/content/courses';
import { loadCourse } from '@/content/loadCourse';

// Development only (imported under import.meta.env.DEV): `localStorage['dev:drill'] = '1'` registers the fixture course.
if (localStorage.getItem('dev:drill') === '1') {
  const files = import.meta.glob<string>('/src/engine/drill/fixture/*.{json,md}', { query: '?raw', import: 'default', eager: true });
  registerSealed(loadCourse(files, '/src/engine/drill/fixture'));
}
