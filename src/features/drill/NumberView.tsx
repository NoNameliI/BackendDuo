import { useMemo } from 'react';
import { useHotkeys } from '@/app/hotkeys';
import type { Course, DrillConfig } from '@/content/loadCourse';
import { splitTheory } from '@/content/theory';
import { Button } from '@/ui/Button';
import { Markdown } from './StatementMarkdown';
import { Panel } from '@/ui/Panel';
import { Tabs } from '@/ui/Tabs';
import { useFocusHeading } from '@/ui/useFocusHeading';
import { DrillExample } from './DrillExample';
import { lessonOfNumber, useDrill, type NumberTab } from './drillStore';
import { TaskView } from './TaskView';

const TABS: { id: NumberTab; title: string }[] = [
  { id: 'theory', title: 'Теория' },
  { id: 'task', title: 'Задание' },
];

export function NumberView({ course, cfg }: { course: Course; cfg: DrillConfig }) {
  const practice = useDrill((s) => s.practice);
  const tab = useDrill((s) => s.tab);
  const weak = useDrill((s) => s.weak);
  const { setTab, goHome, stepNumber, weakNext, check } = useDrill.getState();
  const n = practice?.n ?? 0;
  const lesson = lessonOfNumber(course, n);
  const ns = cfg.numbers.map((x) => x.n);
  const index = ns.indexOf(n);
  const rootRef = useFocusHeading<HTMLDivElement>(`${n}`);

  useHotkeys({
    'Alt+ArrowLeft': () => stepNumber(-1),
    'Alt+ArrowRight': () => stepNumber(1),
    'Ctrl+Shift+Enter': () => tab === 'task' && check(),
  });

  if (!practice) return null;
  return (
    <div ref={rootRef} className="flex h-full flex-col gap-1.5">
      <h1 className="sr-only">
        {cfg.labels.number} {n}
        {lesson ? `: ${lesson.title}` : ''}
      </h1>
      {weak && (
        <p role="status" className="rounded border border-amber/40 bg-amber/10 px-3 py-1.5 text-[13px] text-amber">
          {cfg.labels.modes.weak}: осталось номеров {weak.queue.length}. Номер уходит из списка после двух верных ответов подряд.
        </p>
      )}
      <div className="min-h-0 flex-1">
        <Panel
          title={`${cfg.labels.number} ${n}`}
          tabs={<Tabs label="Разделы номера" items={TABS} value={tab} onChange={setTab} idPrefix="drill" />}
          actions={
            <>
              {weak ? (
                <Button variant="outline" onClick={weakNext}>
                  Следующий номер →
                </Button>
              ) : (
                <>
                  <Button variant="ghost" shortcut="Alt ←" aria-label="Предыдущий номер" disabled={index <= 0} onClick={() => stepNumber(-1)}>
                    ←
                  </Button>
                  <Button variant="ghost" shortcut="Alt →" aria-label="Следующий номер" disabled={index < 0 || index >= ns.length - 1} onClick={() => stepNumber(1)}>
                    →
                  </Button>
                </>
              )}
              <Button variant="outline" onClick={goHome}>
                Все номера
              </Button>
            </>
          }
        >
          <div id="drill-panel" role="tabpanel" aria-labelledby={`drill-tab-${tab}`} className="h-full">
            {tab === 'theory' ? <TheoryPane course={course} cfg={cfg} n={n} /> : <TaskView course={course} cfg={cfg} />}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function TheoryPane({ course, cfg, n }: { course: Course; cfg: DrillConfig; n: number }) {
  const lesson = lessonOfNumber(course, n);
  const segments = useMemo(() => splitTheory(lesson?.theory ?? ''), [lesson]);
  if (!lesson) return null;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-5">
        <h2 className="text-[20px] font-semibold tracking-tight">{lesson.title}</h2>
        {segments.map((s, i) =>
          s.kind === 'markdown' ? (
            <Markdown key={i} source={s.text} />
          ) : s.lang === 'drill' ? (
            <DrillExample key={i} lesson={lesson} cfg={cfg} n={n} spec={s.code} />
          ) : null,
        )}
        <Button variant="check" onClick={() => useDrill.getState().setTab('task')}>
          К заданию →
        </Button>
      </div>
    </div>
  );
}
