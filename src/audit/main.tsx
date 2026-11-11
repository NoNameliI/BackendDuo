import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import auditCourse from 'virtual:audit-course';
import '../styles/fonts';
import '../styles/index.css';
import { applyTheme } from '../app/theme';
import { useUi } from '../app/store';
import { registerSealed } from '../content/courses';
import { loadCourse } from '../content/loadCourse';
import { useDrill } from '../features/drill/drillStore';
import { AuditPage } from './AuditPage';
import { createAuditApi } from './driver';

const theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
applyTheme(theme);

const course = auditCourse ? loadCourse(auditCourse.files, auditCourse.root) : null;
if (course?.drill) {
  registerSealed(course);
  useUi.setState({ courseId: course.id, view: 'drill', theme });
  useDrill.getState().enter(course.id);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuditPage course={course} />
    </StrictMode>,
  );
  window.__audit = createAuditApi(course);
} else {
  window.__audit = { ready: true, course: null, plan: () => [], run: async () => [], show: async () => {} };
}
