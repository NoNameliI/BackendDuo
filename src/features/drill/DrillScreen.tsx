import { useEffect } from 'react';
import { useCourse } from '@/app/useCourse';
import { EmptyState } from '@/ui/Panel';
import { useDrill } from './drillStore';
import { Home } from './Home';
import { NumberView } from './NumberView';
import { SetResult } from './SetResult';
import { SetView } from './SetView';

/** The drill trainer of the active course: home, one number, a timed set and its result. */
export default function DrillScreen() {
  const course = useCourse();
  const screen = useDrill((s) => s.screen);
  const entered = useDrill((s) => s.courseId);
  const cfg = course.drill;

  useEffect(() => {
    if (!cfg) return;
    useDrill.getState().enter(course.id);
    void useDrill.getState().restore();
  }, [course.id, cfg, entered]);

  if (!cfg) return <EmptyState>У этого курса нет тренажёра.</EmptyState>;
  if (entered !== course.id) return null;
  return (
    <>
      {screen === 'home' && <Home course={course} cfg={cfg} />}
      {screen === 'number' && <NumberView course={course} cfg={cfg} />}
      {screen === 'set' && <SetView course={course} cfg={cfg} />}
      {screen === 'result' && <SetResult course={course} cfg={cfg} />}
    </>
  );
}
