import { describe, expect, it } from 'vitest';
import { describeCommand, isReadOnlyQuery, lineColumn, splitStatements } from './sql';

const texts = (sql: string) => splitStatements(sql).map((s) => s.text);

describe('splitStatements', () => {
  it('splits on top-level semicolons and keeps offsets', () => {
    const sql = 'SELECT 1;\n  SELECT 2';
    expect(splitStatements(sql)).toEqual([
      { text: 'SELECT 1', start: 0 },
      { text: 'SELECT 2', start: 12 },
    ]);
  });

  it('ignores semicolons inside strings, identifiers and comments', () => {
    expect(texts(`SELECT 'a;b', "x;y" FROM t; -- c;d\nSELECT /* e; /* nested; */ f */ 2;`)).toEqual([
      `SELECT 'a;b', "x;y" FROM t`,
      'SELECT /* e; /* nested; */ f */ 2',
    ]);
  });

  it('handles doubled quotes and E-strings with backslashes', () => {
    expect(texts(`SELECT 'it''s; ok'; SELECT E'a\\';b'; SELECT "q""; q"`)).toEqual([
      `SELECT 'it''s; ok'`,
      `SELECT E'a\\';b'`,
      `SELECT "q""; q"`,
    ]);
  });

  it('respects dollar quoting but not positional parameters', () => {
    const fn = `CREATE FUNCTION f() RETURNS int AS $body$ BEGIN RETURN 1; END; $body$ LANGUAGE plpgsql`;
    expect(texts(`${fn}; DO $$ BEGIN PERFORM 1; END $$; SELECT $1`)).toEqual([fn, 'DO $$ BEGIN PERFORM 1; END $$', 'SELECT $1']);
  });

  it('drops empty and comment-only fragments', () => {
    expect(texts(';; -- only a comment\n /* and this */ ;  ')).toEqual([]);
    expect(texts('-- intro\nSELECT 1')).toEqual(['SELECT 1']);
  });
});

describe('helpers', () => {
  it('converts offsets to line and column', () => {
    expect(lineColumn('ab\ncd', 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumn('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
  });

  it('names DDL commands', () => {
    expect(describeCommand('create unique index i on t(a)', 'CREATE')).toBe('CREATE INDEX');
    expect(describeCommand('CREATE OR REPLACE VIEW v AS SELECT 1', 'CREATE')).toBe('CREATE VIEW');
    expect(describeCommand('INSERT INTO t VALUES (1)', 'INSERT')).toBe('INSERT');
  });

  it('detects read-only queries', () => {
    expect(isReadOnlyQuery('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(true);
    expect(isReadOnlyQuery('WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d')).toBe(false);
    expect(isReadOnlyQuery('UPDATE t SET a = 1')).toBe(false);
  });
});
