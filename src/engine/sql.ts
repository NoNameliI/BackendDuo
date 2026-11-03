export interface Statement {
  text: string;
  /** 0-based offset of the statement's first character in the source text. */
  start: number;
}

const DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;

/**
 * Splits SQL into statements on top-level semicolons, respecting quotes, dollar quoting and comments.
 * Comment-only fragments are dropped; comments inside a statement are kept.
 */
export function splitStatements(sql: string): Statement[] {
  const out: Statement[] = [];
  const n = sql.length;
  let codeStart = -1;
  let i = 0;

  const flush = (end: number) => {
    if (codeStart === -1) return;
    const text = sql.slice(codeStart, end).trimEnd();
    if (text) out.push({ text, start: codeStart });
    codeStart = -1;
  };

  while (i < n) {
    const c = sql[i];

    if (c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql.startsWith('/*', i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith('*/', i)) {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    if (c === ';') {
      flush(i);
      i++;
      continue;
    }
    if (codeStart === -1 && !/\s/.test(c)) codeStart = i;

    if (c === "'") {
      const escapes = /[eE]/.test(sql[i - 1] ?? '') && !/[\w$]/.test(sql[i - 2] ?? '');
      i++;
      while (i < n) {
        if (escapes && sql[i] === '\\') {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n && !(sql[i] === '"' && sql[i + 1] !== '"')) i += sql[i] === '"' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '$' && !/[\w$]/.test(sql[i - 1] ?? '')) {
      DOLLAR_TAG.lastIndex = i;
      const tag = DOLLAR_TAG.exec(sql);
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        i = end === -1 ? n : end + tag[0].length;
        continue;
      }
    }
    i++;
  }
  flush(n);
  return out;
}

/** Converts a 0-based offset to 1-based line and column. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n');
  return { line, column };
}

const DDL_OBJECT =
  /^\s*(create|alter|drop)\s+(?:or\s+replace\s+|unique\s+|temp(?:orary)?\s+|unlogged\s+|materialized\s+)*([a-z]+)/i;

/** Human-friendly command name: "CREATE TABLE" instead of the bare "CREATE" tag. */
export function describeCommand(statement: string, tag: string): string {
  const ddl = DDL_OBJECT.exec(statement);
  return ddl ? `${ddl[1]} ${ddl[2]}`.toUpperCase() : tag;
}

/** True when the statement only reads data, so EXPLAIN ANALYZE is safe to run. */
export function isReadOnlyQuery(statement: string): boolean {
  return /^\s*(select|with|values|table)\b/i.test(statement) && !/\b(insert|update|delete|merge)\b/i.test(statement);
}
