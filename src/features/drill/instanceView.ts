import type { DrillTask } from '@/content/schema';
import { fileName, headerOf, toCsv, toText } from '@/engine/drill/data';
import { renderTemplate } from '@/engine/drill/render';
import type { DataTable, Instance } from '@/engine/drill/types';
import { toXlsx } from '@/engine/drill/xlsx';

/** One tab of the data viewer: a sheet of the workbook or a text file. */
export interface ExportFile {
  /** File the tab belongs to: the workbook name for sheets, the text file name otherwise. */
  name: string;
  ext: 'xlsx' | 'txt';
  /** Caption for the switcher: the sheet name. */
  label: string;
  /** Text files only. */
  text: string;
  /** Sheets only. */
  table?: DataTable;
  /** Sheets only: the whole workbook (every sheet of the instance), built on demand. */
  book?: () => Uint8Array;
}

/** A file as the Python scratch pad sees it. */
export interface ScratchFile {
  name: string;
  text: string;
}

/** Tabs as the viewer shows them and as they are saved: all tables of an instance are sheets of one `.xlsx`. */
export function exportsOf(inst: Instance, task: Pick<DrillTask, 'labels'>): ExportFile[] {
  const tables = inst.files.flatMap((f) => (f.kind === 'table' ? f.tables : []));
  const book = () => toXlsx(tables.map((t) => ({ name: task.labels[t.key] ?? t.key, header: headerOf(t, task.labels), rows: t.rows })));
  const workbook = fileName(inst.n, inst.seed, 'xlsx');
  return inst.files.flatMap<ExportFile>((f, i) =>
    f.kind === 'table'
      ? f.tables.map((table) => ({ name: workbook, ext: 'xlsx', label: task.labels[table.key] ?? table.key, text: '', table, book }))
      : [{ name: fileName(inst.n, inst.seed, 'txt'), ext: 'txt', label: `Текст ${i + 1}`, text: toText(f.text) }],
  );
}

/** The scratch pad reads every table as its own CSV under the old names, so the starters keep working. */
export function scratchFilesOf(inst: Instance, task: Pick<DrillTask, 'labels'>): ScratchFile[] {
  return inst.files.flatMap<ScratchFile>((f) =>
    f.kind === 'table'
      ? f.tables.map((table) => ({ name: fileName(inst.n, inst.seed, 'csv', table.key), text: toCsv(table, task.labels) }))
      : [{ name: fileName(inst.n, inst.seed, 'txt'), text: toText(f.text) }],
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

/** The hints and the statement never see the answer; the explanation does; the starter sees the scratch file names. */
export function renderInstance(task: DrillTask, inst: Instance): Rendered {
  const names = scratchFilesOf(inst, task).map((f) => f.name);
  return {
    statement: attempt(() => renderTemplate(task.prompt, inst.fields)),
    hints: task.hints.map((h) => attempt(() => renderTemplate(h, inst.fields))),
    explanation: attempt(() => renderTemplate(task.explain, { ...inst.fields, ...inst.steps, answer: inst.answer })),
    starter: attempt(() => renderTemplate(task.pythonStarter, { ...inst.fields, file: names })),
  };
}
