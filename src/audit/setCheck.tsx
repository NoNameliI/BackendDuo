import { createRoot } from 'react-dom/client';
import '../styles/fonts';
import '../styles/index.css';
import { useUi } from '../app/store';
import { registerSealed } from '../content/courses';
import { loadCourse } from '../content/loadCourse';
import DrillScreen from '../features/drill/DrillScreen';
import { useDrill } from '../features/drill/drillStore';

// The whole drill screen (home, number, set) on the private course, for scripts/drill-set-check.mjs: it drives the
// store through window.__drill and reads the page. Served only by the audit dev server (virtual:audit-course).
declare global {
  interface Window {
    __drill?: { store: typeof useDrill; numbers: number[] } | null;
  }
}

async function start() {
  const { default: auditCourse } = await import('virtual:audit-course');
  const course = auditCourse ? loadCourse(auditCourse.files, auditCourse.root) : null;
  if (!course?.drill) {
    window.__drill = null;
    return;
  }
  registerSealed(course);
  useUi.setState({ courseId: course.id, view: 'drill' });
  createRoot(document.getElementById('root')!).render(<DrillScreen />);
  window.__drill = { store: useDrill, numbers: course.drill.numbers.map((x) => x.n) };
}

void start();
