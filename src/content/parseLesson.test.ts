import { describe, expect, it } from 'vitest';
import { LessonParseError, parseLesson } from './parseLesson';

const fence = '```';

const LESSON = `# Первая таблица\r
\r
Теория **про таблицы**.\r
\r
## task create-products
${fence}json
{ "type": "schema", "title": "Товары", "hints": ["Подсказка"] }
${fence}

Создайте таблицу. Пример синтаксиса:

${fence}sql
CREATE TABLE t (id int);
${fence}

${fence}sql setup
CREATE TABLE categories (id int);
${fence}

${fence}sql solution
CREATE TABLE products (id serial PRIMARY KEY);
${fence}

## task review-it
${fence}json
{ "type": "review", "title": "Найди баг", "hints": ["h"], "options": ["a", "b"], "answer": [1], "explanation": "e" }
${fence}
Что не так?
${fence}python code
cursor.execute("SELECT * FROM users WHERE id = " + user_id)
${fence}
`;

describe('parseLesson', () => {
  it('extracts title, theory and tasks with their SQL blocks', () => {
    const lesson = parseLesson(LESSON);
    expect(lesson.title).toBe('Первая таблица');
    expect(lesson.theory).toBe('Теория **про таблицы**.');
    expect(lesson.tasks).toHaveLength(2);

    const [schema, review] = lesson.tasks;
    expect(schema).toMatchObject({
      id: 'create-products',
      type: 'schema',
      setup: 'CREATE TABLE categories (id int);',
      solution: 'CREATE TABLE products (id serial PRIMARY KEY);',
    });
    expect(schema.prompt).toBe(`Создайте таблицу. Пример синтаксиса:\n\n${fence}sql\nCREATE TABLE t (id int);\n${fence}`);

    expect(review).toMatchObject({ id: 'review-it', codeLanguage: 'python', prompt: 'Что не так?' });
    expect(review.code).toContain('cursor.execute');
  });

  it('reports structural problems', () => {
    expect(() => parseLesson('Без заголовка')).toThrow(LessonParseError);
    expect(() => parseLesson('# T\n## task x\nТекст без json')).toThrow(/нет блока/);
    expect(() => parseLesson(`# T\n## task x\n${fence}json\n{ bad }\n${fence}\n`)).toThrow(/некорректный JSON/);
    expect(() =>
      parseLesson(`# T\n## task x\n${fence}json\n{}\n${fence}\n${fence}sql solution\nA\n${fence}\n${fence}sql solution\nB\n${fence}\n`),
    ).toThrow(/дважды/);
  });
});
