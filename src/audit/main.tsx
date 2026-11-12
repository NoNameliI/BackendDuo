import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/fonts';
import '../styles/index.css';
import { applyTheme } from '../app/theme';
import { createAuditApi } from './driver';

// ?suite=drill (default, the private trainer course) or ?suite=broker (public lab fixtures, no private files).
const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'light' ? 'light' : 'dark';
const suiteId = params.get('suite') === 'broker' ? 'broker' : 'drill';
applyTheme(theme);

const root = document.getElementById('root')!;
const nothing = () => {
  window.__audit = { ready: true, course: null, plan: () => [], run: async () => [], show: async () => {} };
};

async function start() {
  if (suiteId === 'broker') {
    const { BrokerAuditPage, brokerSuite } = await import('./brokerSuite');
    createRoot(root).render(
      <StrictMode>
        <BrokerAuditPage />
      </StrictMode>,
    );
    window.__audit = createAuditApi(brokerSuite, { id: 'broker', numbers: () => brokerSuite.plan({ seeds: 0, scan: 0, bad: 0 }).map((c) => c.n) });
    return;
  }
  // The private course module is read from disk only for the drill suite.
  const [{ default: auditCourse }, { useUi }, { registerSealed }, { loadCourse }, { useDrill }, { AuditPage }, { createDrillSuite }] = await Promise.all([
    import('virtual:audit-course'),
    import('../app/store'),
    import('../content/courses'),
    import('../content/loadCourse'),
    import('../features/drill/drillStore'),
    import('./AuditPage'),
    import('./driver'),
  ]);
  const course = auditCourse ? loadCourse(auditCourse.files, auditCourse.root) : null;
  if (!course?.drill) return nothing();
  registerSealed(course);
  useUi.setState({ courseId: course.id, view: 'drill', theme });
  useDrill.getState().enter(course.id);
  createRoot(root).render(
    <StrictMode>
      <AuditPage course={course} />
    </StrictMode>,
  );
  window.__audit = createAuditApi(createDrillSuite(course), { id: course.id, numbers: () => course.drill!.numbers.map((x) => x.n) });
}

void start().catch(nothing);
