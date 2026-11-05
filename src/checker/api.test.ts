import { describe, expect, it } from 'vitest';
import type { ApiTask } from '@/content/loadCourse';
import { taskSchema } from '@/content/schema';
import { parseRequest } from '@/engine/api/http';
import { checkRequest } from './api';

function task(raw: Record<string, unknown>) {
  const parsed = taskSchema.parse({ id: 't', title: 'T', prompt: 'P', hints: ['h'], type: 'request', ...raw });
  return { ...parsed, courseId: 'api', lessonId: 'l', worldId: 'w', setupSql: '' } as Extract<ApiTask, { type: 'request' }>;
}

const ORDER = 'POST /orders?notify=true\nContent-Type: application/json\n\n{"product": "Чай", "quantity": 2}';

describe('request check', () => {
  const t = task({ httpSolution: ORDER, check: { headers: ['Content-Type'] } });

  it('accepts an equivalent request: other key order, header case, charset', () => {
    const sent = parseRequest('post /orders?notify=true\ncontent-type: application/json; charset=utf-8\n\n{"quantity":2,"product":"Чай"}');
    expect(checkRequest(t, sent)).toEqual({ passed: true, problems: [] });
  });

  it('explains every difference', () => {
    const sent = parseRequest('PUT /order?notify=false&debug=1\n\n{"product": "Кофе", "qty": 2}');
    expect(checkRequest(t, sent).problems).toEqual([
      'Метод: ожидается POST, у вас PUT',
      'Путь: ожидается /orders, у вас /order',
      'Параметр notify: ожидается «true», у вас «false»',
      'Лишний параметр в адресе: debug',
      'Нет заголовка Content-Type',
      'Поле «product»: ожидается "Чай", у вас "Кофе"',
      'В теле запроса нет поля «quantity»',
      'В теле запроса лишнее поле «qty»',
    ]);
  });

  it('reports broken JSON in plain words', () => {
    const sent = parseRequest("POST /orders?notify=true\nContent-Type: application/json\n\n{product: 'Чай'}");
    expect(checkRequest(t, sent).problems[0]).toMatch(/^Тело запроса — некорректный JSON/);
  });
});
