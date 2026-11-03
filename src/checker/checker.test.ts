import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Task } from '@/content/loadCourse';
import { taskSchema, type TaskInput } from '@/content/schema';
import { PostgresEngine } from '@/engine/postgres/PostgresEngine';
import { createChecker, SolutionError } from './index';

const engine = new PostgresEngine();
const checker = createChecker(engine);

beforeAll(() => engine.init(), 30_000);
afterAll(() => engine.dispose());

type TaskFields = TaskInput extends infer T ? (T extends unknown ? Omit<T, 'id' | 'title' | 'prompt' | 'hints'> : never) : never;

let n = 0;
function makeTask(input: TaskFields): Task {
  const task = taskSchema.parse({ id: `t${++n}`, title: 'T', prompt: 'P', hints: ['h'], ...input });
  return { ...task, lessonId: 'l', worldId: 'w', setupSql: 'setup' in task ? task.setup : '' } as Task;
}

const sql = (code: string) => ({ kind: 'sql' as const, code });

const SHOP = `
CREATE TABLE customers (id serial PRIMARY KEY, name text NOT NULL, city text);
INSERT INTO customers (name, city) VALUES ('Анна', 'Казань'), ('Борис', 'Москва'), ('Вера', 'Казань');
CREATE TABLE orders (id serial PRIMARY KEY, customer_id int NOT NULL REFERENCES customers (id), total numeric(10, 2) NOT NULL);
INSERT INTO orders (customer_id, total) VALUES (1, 100), (1, 50.5), (2, 300), (3, 20);
`;

describe('result check', () => {
  const task = makeTask({
    type: 'result',
    setup: SHOP,
    solution: 'SELECT name, city FROM customers WHERE city = \'Казань\'',
  });

  it('accepts an equivalent query regardless of row order', async () => {
    const r = await checker.check(task, sql(`SELECT name, city FROM customers WHERE city LIKE 'Каз%' ORDER BY name DESC`));
    expect(r).toMatchObject({ passed: true, problems: [] });
  });

  it('reports missing and extra rows', async () => {
    const r = await checker.check(task, sql(`SELECT name, city FROM customers WHERE name <> 'Вера'`));
    expect(r.passed).toBe(false);
    expect(r.problems).toContain('Не хватает строки (Вера, Казань)');
    expect(r.problems).toContain('Лишняя строка (Борис, Москва)');
  });

  it('checks column count and names', async () => {
    expect((await checker.check(task, sql(`SELECT name FROM customers WHERE city = 'Казань'`))).problems[0]).toMatch(
      /Ожидалось колонок: 2/,
    );
    const renamed = await checker.check(task, sql(`SELECT name AS who, city FROM customers WHERE city = 'Казань'`));
    expect(renamed.problems).toEqual(['Колонка №1 называется «who», а должна — «name»']);
  });

  it('returns SQL errors and requires a result table', async () => {
    const broken = await checker.check(task, sql('SELECT nme FROM customers'));
    expect(broken.passed).toBe(false);
    expect(broken.error?.code).toBe('42703');
    const noTable = await checker.check(task, sql(`UPDATE customers SET city = 'X'`));
    expect(noTable.problems).toEqual(['Код не вернул таблицу результата — нужен запрос SELECT']);
  });

  it('enforces order only when the task asks for it', async () => {
    const ordered = makeTask({
      type: 'result',
      setup: SHOP,
      solution: 'SELECT total FROM orders ORDER BY total DESC',
      check: { ordered: true },
    });
    expect((await checker.check(ordered, sql('SELECT total FROM orders ORDER BY total DESC'))).passed).toBe(true);
    const wrong = await checker.check(ordered, sql('SELECT total FROM orders ORDER BY total'));
    expect(wrong.problems[0]).toMatch(/порядок другой/);
  });

  it('compares numbers by value', async () => {
    const avg = makeTask({ type: 'result', setup: SHOP, solution: 'SELECT avg(total) AS avg FROM orders' });
    const r = await checker.check(avg, sql('SELECT sum(total)::float8 / count(*) AS avg FROM orders'));
    expect(r.passed).toBe(true);
    const rounded = await checker.check(avg, sql('SELECT round(avg(total), 1) AS avg FROM orders'));
    expect(rounded.passed).toBe(false);
  });

  it('compares large integers exactly', async () => {
    const phones = makeTask({ type: 'result', setup: SHOP, solution: 'SELECT 79161234567::bigint AS phone' });
    expect((await checker.check(phones, sql('SELECT 79161234568::bigint AS phone'))).passed).toBe(false);
    expect((await checker.check(phones, sql('SELECT 79161234567.00::numeric AS phone'))).passed).toBe(true);
  });

  it('marks a broken reference solution as a content error', async () => {
    const bad = makeTask({ type: 'result', setup: SHOP, solution: 'SELECT missing FROM customers' });
    await expect(checker.check(bad, sql('SELECT 1'))).rejects.toBeInstanceOf(SolutionError);
  });
});

describe('state check', () => {
  const task = makeTask({
    type: 'state',
    setup: SHOP,
    solution: `UPDATE customers SET city = 'Самара' WHERE name = 'Борис'`,
    checkSql: 'SELECT name, city FROM customers',
  });

  it('accepts any code that produces the same data', async () => {
    expect((await checker.check(task, sql(`UPDATE customers SET city = 'Самара' WHERE id = 2`))).passed).toBe(true);
  });

  it('rejects untouched or wrongly changed data', async () => {
    expect((await checker.check(task, sql(''))).passed).toBe(false);
    const all = await checker.check(task, sql(`UPDATE customers SET city = 'Самара'`));
    expect(all.problems).toContain('Лишняя строка (Анна, Самара)');
  });

  it('fails gracefully when the checked table is gone', async () => {
    const r = await checker.check(task, sql('DROP TABLE orders; DROP TABLE customers'));
    expect(r.problems[0]).toMatch(/Не удалось прочитать данные/);
  });
});

describe('schema check', () => {
  const task = makeTask({
    type: 'schema',
    setup: 'CREATE TABLE customers (id serial PRIMARY KEY, email text NOT NULL)',
    solution: `
      CREATE TABLE orders (
        id serial PRIMARY KEY,
        customer_id integer NOT NULL REFERENCES customers (id),
        status varchar(20) NOT NULL DEFAULT 'new',
        total numeric(10, 2) CHECK (total >= 0),
        UNIQUE (customer_id, status)
      );
      CREATE INDEX orders_status_idx ON orders (status);`,
    check: { tables: ['orders'] },
  });

  it('accepts an equivalent design with different spelling', async () => {
    const r = await checker.check(
      task,
      sql(`
      CREATE TABLE orders (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        customer_id bigint NOT NULL,
        status text NOT NULL DEFAULT 'new',
        total numeric(12, 2),
        CONSTRAINT positive CHECK (total >= 0),
        CONSTRAINT fk FOREIGN KEY (customer_id) REFERENCES customers
      );
      CREATE UNIQUE INDEX one_status ON orders (status, customer_id);
      CREATE INDEX ON orders (status);`),
    );
    expect(r.problems).toEqual([]);
  });

  it('lists every structural difference', async () => {
    const r = await checker.check(
      task,
      sql(`CREATE TABLE orders (id int PRIMARY KEY, customer_id text, status varchar(20), total numeric(10, 2), note text)`),
    );
    expect(r.problems).toEqual(
      expect.arrayContaining([
        'orders.id: значение должно генерироваться автоматически (serial или GENERATED … AS IDENTITY)',
        'orders.customer_id: тип text, а ожидался integer',
        'orders.customer_id: должна быть NOT NULL',
        'orders.status: должна быть NOT NULL',
        "orders.status: значение по умолчанию не задано, ожидалось 'new'::character varying",
        'orders: лишняя колонка note',
        'orders: нет внешнего ключа (customer_id) → customers(id)',
        'orders: нет ограничения UNIQUE (customer_id, status)',
        'orders: ограничений CHECK 0, ожидалось 1',
        'orders: нет индекса btree (status)',
      ]),
    );
  });

  it('reports a missing table', async () => {
    expect((await checker.check(task, sql(''))).problems).toEqual(['Нет таблицы orders']);
  });
});

describe('plan check', { timeout: 30_000 }, () => {
  const setup = `
    CREATE TABLE events (id int PRIMARY KEY, user_id int NOT NULL, created_on date NOT NULL);
    INSERT INTO events SELECT g, g % 5000, DATE '2024-01-01' + (g % 365) FROM generate_series(1, 100000) g;`;

  const ddl = makeTask({
    type: 'plan',
    setup,
    query: 'SELECT count(*) FROM events WHERE user_id = 42',
    solution: 'CREATE INDEX ON events (user_id)',
    check: { forbidSeqScan: ['events'], maxCostRatio: 0.2 },
  });

  it('accepts an index that removes the sequential scan', async () => {
    const r = await checker.check(ddl, sql('CREATE INDEX events_user_idx ON events (user_id)'));
    expect(r.problems).toEqual([]);
    expect(r.plan).toBeDefined();
  });

  it('rejects doing nothing, planner tricks and deleting data', async () => {
    const nothing = await checker.check(ddl, sql(''));
    expect(nothing.problems[0]).toMatch(/Seq Scan/);
    const trick = await checker.check(ddl, sql('SET enable_seqscan = off'));
    expect(trick.passed).toBe(false);
    const wipe = await checker.check(ddl, sql('DELETE FROM events WHERE user_id = 42; CREATE INDEX ON events (user_id)'));
    expect(wipe.problems).toContain('Результат запроса изменился — оптимизация не должна менять данные');
  });

  const rewrite = makeTask({
    type: 'plan',
    setup: `${setup} CREATE INDEX events_created_idx ON events (created_on);`,
    query: `SELECT id FROM events WHERE extract(year FROM created_on) = 2024 AND extract(month FROM created_on) = 2 AND user_id = 7`,
    solution: `SELECT id FROM events WHERE created_on >= DATE '2024-02-01' AND created_on < DATE '2024-03-01' AND user_id = 7`,
    check: { mode: 'query', requireIndexOn: ['events'] },
  });

  it('checks rewritten queries for both plan and result', async () => {
    expect((await checker.check(rewrite, sql(rewrite.type === 'plan' ? rewrite.solution : ''))).problems).toEqual([]);
    const original = await checker.check(rewrite, sql(rewrite.type === 'plan' ? rewrite.query : ''));
    expect(original.problems).toEqual(['Для таблицы events не используется индекс']);
    const wrong = await checker.check(
      rewrite,
      sql(`SELECT id FROM events WHERE created_on >= DATE '2024-02-01' AND created_on < DATE '2024-02-10' AND user_id = 7`),
    );
    expect(wrong.passed).toBe(false);
    expect(wrong.problems.some((p) => p.startsWith('Не хватает строки'))).toBe(true);
  });
});

describe('choice and review checks', () => {
  const task = makeTask({ type: 'choice', options: ['a', 'b', 'c'], answer: [0, 2], explanation: 'e' });

  it('requires exactly the correct set of options', async () => {
    expect((await checker.check(task, { kind: 'choice', selected: [2, 0] })).passed).toBe(true);
    expect((await checker.check(task, { kind: 'choice', selected: [0] })).passed).toBe(false);
    expect((await checker.check(task, { kind: 'choice', selected: [0, 1, 2] })).passed).toBe(false);
  });

  it('validates answers against options', () => {
    expect(() =>
      taskSchema.parse({ id: 'x', title: 'T', prompt: 'P', hints: ['h'], type: 'review', code: 'SELECT 1', options: ['a', 'b'], answer: [5], explanation: 'e' }),
    ).toThrow(/вне списка/);
  });
});
