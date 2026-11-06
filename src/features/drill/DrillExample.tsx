import { useMemo } from 'react';
import type { DrillConfig, Lesson } from '@/content/loadCourse';
import { makeInstance } from '@/engine/drill/instance';
import { Markdown } from '@/ui/Markdown';
import { renderInstance } from './instanceView';

interface ExampleSpec {
  task: string;
  level: 'base' | 'core' | 'hard';
  seed: number;
}

/** A `drill example` block of the theory: one fixed instance with its statement, explanation and answer. */
export function DrillExample({ lesson, cfg, n, spec }: { lesson: Lesson; cfg: DrillConfig; n: number; spec: string }) {
  const view = useMemo(() => {
    try {
      const o = JSON.parse(spec) as ExampleSpec;
      const task = lesson.tasks.find((t) => t.id === o.task && t.type === 'drill');
      if (!task || task.type !== 'drill') return { error: `Нет задания «${o.task}»` };
      const inst = makeInstance(task, n, o.level, o.seed);
      return { rendered: renderInstance(task, inst), answer: inst.answer, level: cfg.labels.levels[o.level] };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [lesson, cfg, n, spec]);

  if ('error' in view) return <p className="text-[13px] text-err">{view.error}</p>;
  return (
    <figure className="space-y-3 rounded-md border border-line bg-well p-4">
      <figcaption className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">Разобранный пример · {view.level}</figcaption>
      <Markdown source={view.rendered.statement} />
      <div className="border-t border-line pt-3">
        <Markdown source={view.rendered.explanation} />
      </div>
      <p className="text-[13.5px]">
        Ответ: <span className="font-mono font-semibold text-ok">{view.answer}</span>
      </p>
    </figure>
  );
}
