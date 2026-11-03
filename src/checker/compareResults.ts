import type { Cell, StatementResult } from '@/engine';
import { NUMERIC_TYPE_IDS } from '@/engine/postgres/typeIds';
import { plural } from '@/ui/format';

export interface CompareOptions {
  ordered: boolean;
  columnNames: boolean;
}

const MAX_EXAMPLES = 3;

/**
 * Integers compare exactly (any size); 3.00 equals 3; other fractions compare with 10 significant digits,
 * so numeric avg equals float avg.
 */
export function canonical(cell: Cell, numeric: boolean): Cell {
  if (cell === null || !numeric) return cell;
  if (/^-?\d+$/.test(cell)) return cell.replace(/^(-?)0+(?=\d)/, '$1');
  const n = Number(cell);
  if (!Number.isFinite(n)) return cell;
  if (Number.isInteger(n) && Math.abs(n) < Number.MAX_SAFE_INTEGER) return String(n);
  return String(Number(n.toPrecision(10)));
}

export function formatRow(row: Cell[]): string {
  const text = row.map((c) => (c === null ? 'NULL' : c)).join(', ');
  return `(${text.length > 120 ? `${text.slice(0, 117)}…` : text})`;
}

const rowsWord = (n: number) => plural(n, 'строка', 'строки', 'строк');

/** Returns human-readable differences; an empty list means the results match. */
export function compareResults(expected: StatementResult, actual: StatementResult, options: CompareOptions): string[] {
  const expectedNames = expected.columns.map((c) => c.name);
  const actualNames = actual.columns.map((c) => c.name);

  if (expectedNames.length !== actualNames.length) {
    return [
      `Ожидалось колонок: ${expectedNames.length} (${expectedNames.join(', ')}), получено: ${actualNames.length} (${actualNames.join(', ')})`,
    ];
  }

  const problems: string[] = [];
  if (options.columnNames) {
    expectedNames.forEach((name, i) => {
      if (name.toLowerCase() !== actualNames[i].toLowerCase()) {
        problems.push(`Колонка №${i + 1} называется «${actualNames[i]}», а должна — «${name}»`);
      }
    });
  }

  const numeric = expected.columns.map((c) => NUMERIC_TYPE_IDS.has(c.typeId));
  const normalize = (rows: Cell[][]) => rows.map((r) => r.map((cell, i) => canonical(cell, numeric[i])));
  const want = normalize(expected.rows);
  const got = normalize(actual.rows);
  const key = (row: Cell[]) => JSON.stringify(row);

  if (want.length !== got.length) {
    problems.push(`Ожидалось ${want.length} ${rowsWord(want.length)}, получено ${got.length}`);
  }

  const counts = new Map<string, number>();
  want.forEach((r) => counts.set(key(r), (counts.get(key(r)) ?? 0) + 1));
  const extra: Cell[][] = [];
  for (const r of got) {
    const left = counts.get(key(r)) ?? 0;
    if (left > 0) counts.set(key(r), left - 1);
    else extra.push(r);
  }
  const missing = want.filter((r) => {
    const left = counts.get(key(r)) ?? 0;
    if (left > 0) {
      counts.set(key(r), left - 1);
      return true;
    }
    return false;
  });

  missing.slice(0, MAX_EXAMPLES).forEach((r) => problems.push(`Не хватает строки ${formatRow(r)}`));
  extra.slice(0, MAX_EXAMPLES).forEach((r) => problems.push(`Лишняя строка ${formatRow(r)}`));

  if (missing.length === 0 && extra.length === 0 && options.ordered) {
    const firstDiff = want.findIndex((r, i) => key(r) !== key(got[i]));
    if (firstDiff !== -1) {
      problems.push(
        `Строки верные, но порядок другой: на месте №${firstDiff + 1} ожидалась ${formatRow(want[firstDiff])} — проверьте ORDER BY`,
      );
    }
  }
  return problems;
}
