import { PGlite } from '@electric-sql/pglite';
import { describeCommand, isReadOnlyQuery, lineColumn, splitStatements } from '../sql';
import type {
  ExecOutcome,
  ExplainOutcome,
  ResultColumn,
  SandboxEngine,
  SchemaInfo,
  SqlError,
  StatementResult,
} from '../types';
import { INTROSPECT_SQL, toSchemaInfo } from './introspect';
import { toQueryPlan } from './plan';

const DROP_USER_SCHEMAS = `
DO $$
DECLARE s record;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace
           WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname NOT LIKE 'pg\\_%'
  LOOP
    EXECUTE format('DROP SCHEMA %I CASCADE', s.nspname);
  END LOOP;
END $$;
CREATE SCHEMA public;`;

type Parser = (value: string) => string;

/**
 * PostgreSQL sandbox on PGlite (PostgreSQL compiled to WASM): no server, no host or network access.
 * One instance lives for the whole session; `reset` drops every user schema instead of re-creating it,
 * which takes milliseconds instead of seconds.
 */
export class PostgresEngine implements SandboxEngine {
  private db: PGlite | null = null;
  private typeNames = new Map<number, string>();
  /** Identity parsers keep every value as PostgreSQL text output. */
  private rawParsers: Record<number, Parser> = {};

  async init(): Promise<void> {
    if (this.db) return;
    const db = new PGlite();
    await db.waitReady;
    this.db = db;
    await this.loadTypes();
  }

  async reset(setupSql: string): Promise<void> {
    const db = this.requireDb();
    await db.exec('ROLLBACK');
    await db.exec('DISCARD ALL');
    await db.exec(DROP_USER_SCHEMAS);
    if (setupSql.trim()) await db.exec(setupSql);
    await db.exec('ANALYZE');
  }

  async execute(sql: string): Promise<ExecOutcome> {
    const db = this.requireDb();
    const started = performance.now();
    const results: StatementResult[] = [];
    const notices: string[] = [];
    const statements = splitStatements(sql);

    for (const [index, statement] of statements.entries()) {
      try {
        const [res] = await db.exec(statement.text, {
          rowMode: 'array',
          parsers: this.rawParsers,
          onNotice: (n) => notices.push(n.message ?? ''),
        });
        const columns = await this.describeColumns(res.fields);
        results.push({
          sql: statement.text,
          command: describeCommand(statement.text, res.command ?? ''),
          columns,
          rows: res.rows as StatementResult['rows'],
          rowCount: columns.length > 0 ? res.rows.length : ((res as { rowCount?: number }).rowCount ?? 0),
        });
      } catch (e) {
        // Leave no aborted transaction behind: later runs would fail with "current transaction is aborted".
        await db.exec('ROLLBACK').catch(() => undefined);
        return {
          results,
          notices,
          error: { ...toSqlError(e, sql, statement.start), statementIndex: index },
          durationMs: performance.now() - started,
        };
      }
    }
    return { results, notices, durationMs: performance.now() - started };
  }

  async explain(sql: string, options: { analyze?: boolean } = {}): Promise<ExplainOutcome> {
    const db = this.requireDb();
    const statement = splitStatements(sql).at(-1);
    if (!statement) return { error: { code: '42601', message: 'nothing to explain' } };
    const analyze = Boolean(options.analyze) && isReadOnlyQuery(statement.text);
    const prefix = `EXPLAIN (${analyze ? 'ANALYZE, ' : ''}FORMAT JSON) `;
    try {
      const res = await db.query<{ 'QUERY PLAN': unknown }>(prefix + statement.text);
      return { plan: toQueryPlan(res.rows[0]['QUERY PLAN'], analyze) };
    } catch (e) {
      await db.exec('ROLLBACK').catch(() => undefined);
      return { error: toSqlError(e, sql, statement.start - prefix.length) };
    }
  }

  async introspect(): Promise<SchemaInfo> {
    const res = await this.requireDb().query<{ doc: Parameters<typeof toSchemaInfo>[0] }>(INTROSPECT_SQL);
    return toSchemaInfo(res.rows[0].doc);
  }

  async dispose(): Promise<void> {
    await this.db?.close();
    this.db = null;
  }

  private requireDb(): PGlite {
    if (!this.db) throw new Error('PostgresEngine.init() has not been called');
    return this.db;
  }

  private async loadTypes(ids?: number[]): Promise<void> {
    const filter = ids ? `WHERE oid IN (${ids.join(',')})` : '';
    const res = await this.requireDb().query<{ oid: number; name: string }>(
      `SELECT oid::int AS oid, format_type(oid, NULL) AS name FROM pg_type ${filter}`,
    );
    for (const { oid, name } of res.rows) {
      this.typeNames.set(oid, name);
      this.rawParsers[oid] = (value) => value;
    }
  }

  private async describeColumns(fields: { name: string; dataTypeID: number }[]): Promise<ResultColumn[]> {
    const unknown = fields.map((f) => f.dataTypeID).filter((id) => !this.typeNames.has(id));
    if (unknown.length > 0) await this.loadTypes([...new Set(unknown)]);
    return fields.map((f) => ({ name: f.name, typeId: f.dataTypeID, type: this.typeNames.get(f.dataTypeID) ?? 'unknown' }));
  }
}

interface PgErrorLike {
  message?: string;
  code?: string;
  detail?: string;
  hint?: string;
  position?: string;
}

/** `offset` is where the failing statement begins inside `source`. */
function toSqlError(e: unknown, source: string, offset: number): SqlError {
  const err = (e ?? {}) as PgErrorLike;
  const error: SqlError = {
    code: err.code ?? 'XX000',
    message: err.message ?? String(e),
    detail: err.detail,
    hint: err.hint,
  };
  if (err.position) {
    const position = offset + Number(err.position);
    if (position >= 1 && position <= source.length + 1) {
      error.position = position;
      Object.assign(error, lineColumn(source, position - 1));
    }
  }
  return error;
}
