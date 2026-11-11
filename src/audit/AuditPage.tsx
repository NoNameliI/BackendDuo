import { TopBar } from '@/app/TopBar';
import type { Course } from '@/content/loadCourse';
import { NumberView } from '@/features/drill/NumberView';

/** The App frame (top bar + padded main) around the real number view. */
export function AuditPage({ course }: { course: Course }) {
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1 p-1.5">
        <NumberView course={course} cfg={course.drill!} />
      </main>
    </div>
  );
}
