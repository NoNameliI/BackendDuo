import type { SqlError, StatementResult } from '@/engine';
import { plural } from '@/ui/format';

const rows = (n: number) => `${n} ${plural(n, 'строка', 'строки', 'строк')}`;

const DML = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'COPY']);

export function summarizeStatement(result: StatementResult): string {
  if (result.columns.length > 0) return `${result.command} — ${rows(result.rowCount)}`;
  if (DML.has(result.command)) return `${result.command} — затронуто ${rows(result.rowCount)}`;
  return `${result.command} — выполнено`;
}

export function formatSqlError(error: SqlError): string {
  const where = error.line ? ` (строка ${error.line}, символ ${error.column})` : '';
  const lines = [`ERROR ${error.code}: ${error.message}${where}`];
  if (error.detail) lines.push(`DETAIL: ${error.detail}`);
  if (error.hint) lines.push(`HINT: ${error.hint}`);
  return lines.join('\n');
}
