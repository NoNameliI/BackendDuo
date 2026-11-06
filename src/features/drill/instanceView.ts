import type { DrillTask } from '@/content/schema';
import { fileName, toCsv, toText } from '@/engine/drill/data';
import { renderTemplate } from '@/engine/drill/render';
import type { DataTable, Instance } from '@/engine/drill/types';

/** One saveable file of an instance. */
export interface ExportFile {
  name: string;
  text: string;
  ext: 'csv' | 'txt';
  /** Caption for the switcher. */
  label: string;
  /** Present for tables. */
  table?: DataTable;
}

/** Files exactly as they are saved: the scratch script reads the same bytes by the same names. */
export function exportsOf(inst: Instance, task: Pick<DrillTask, 'labels'>): ExportFile[] {
  return inst.files.flatMap<ExportFile>((f, i) =>
    f.kind === 'table'
      ? f.tables.map((table) => ({
          name: fileName(inst.n, inst.seed, 'csv', table.key),
          text: toCsv(table, task.labels),
          ext: 'csv',
          label: task.labels[table.key] ?? table.key,
          table,
        }))
      : [{ name: fileName(inst.n, inst.seed, 'txt'), text: toText(f.text), ext: 'txt', label: `Текст ${i + 1}` }],
  );
}

export interface Rendered {
  statement: string;
  hints: string[];
  explanation: string;
  starter: string;
}

const attempt = (fn: () => string): string => {
  try {
    return fn();
  } catch (e) {
    return `Ошибка шаблона: ${(e as Error).message}`;
  }
};

/** The hints and the statement never see the answer; the explanation does; the starter sees the file names. */
export function renderInstance(task: DrillTask, inst: Instance): Rendered {
  const names = exportsOf(inst, task).map((f) => f.name);
  return {
    statement: attempt(() => renderTemplate(task.prompt, inst.fields)),
    hints: task.hints.map((h) => attempt(() => renderTemplate(h, inst.fields))),
    explanation: attempt(() => renderTemplate(task.explain, { ...inst.fields, ...inst.steps, answer: inst.answer })),
    starter: attempt(() => renderTemplate(task.pythonStarter, { ...inst.fields, file: names })),
  };
}
