import { beforeAll, describe, expect, it } from 'vitest';
import type { AppRunner } from '@/engine/python/runtime';
import { nodePython } from '../../scripts/pyodide/node';
import { checkFastapi, type FastapiTask } from './fastapi';
import { SolutionError } from './index';

const SOLUTION = `
from fastapi import FastAPI, HTTPException

app = FastAPI()
NOTES = {1: "Купить молоко"}

@app.get("/notes/{note_id}")
def get_note(note_id: int):
    if note_id not in NOTES:
        raise HTTPException(status_code=404, detail="Заметка не найдена")
    return {"id": note_id, "text": NOTES[note_id]}
`;

const task = (check: Partial<FastapiTask['check']> = {}, solution = SOLUTION) =>
  ({
    id: `fa-${Math.random()}`,
    courseId: 'api',
    lessonId: 'l',
    type: 'fastapi',
    title: 'T',
    xp: 10,
    hints: ['a'],
    prompt: '',
    httpStarter: 'GET /',
    httpSolution: 'GET /',
    pythonStarter: '',
    pythonSolution: solution,
    httpTests: 'GET /notes/1\n###\nGET /notes/5\n###\nGET /notes/abc',
    check: { body: 'json', headers: [], code: [], ...check },
  }) as unknown as FastapiTask;

let run: AppRunner;
beforeAll(async () => {
  run = (await nodePython()).run;
}, 60_000);

describe('fastapi check', () => {
  it('passes the reference and explains what differs', async () => {
    expect((await checkFastapi(task(), SOLUTION, run)).problems).toEqual([]);
    const no404 = SOLUTION.replace('    if note_id not in NOTES:\n        raise HTTPException(status_code=404, detail="Заметка не найдена")\n', '');
    expect((await checkFastapi(task(), no404, run)).problems).toEqual([
      'Запрос GET /notes/5: Ошибка в обработчике (строка 9): KeyError. В словаре нет ключа 5: проверьте, что запись существует, прежде чем её читать (и верните 404, если нет).',
    ]);
    const strId = SOLUTION.replace('note_id: int', 'note_id: str');
    expect((await checkFastapi(task(), strId, run)).problems[0]).toMatch(/^Запрос GET \/notes\/1: ответ «Купить молоко»|^Запрос GET \/notes\/1: Ошибка|^Запрос GET \/notes\/1: ожидается код 200, приложение ответило 404/);
    const post = SOLUTION.replace('@app.get', '@app.post');
    expect((await checkFastapi(task(), post, run)).problems[0]).toBe('Запрос GET /notes/1: ожидается код 200, приложение ответило 405. Путь есть, но с другим методом: проверьте декоратор.');
    expect((await checkFastapi(task(), 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/")\ndef root()\n    return 1', run)).problems[0]).toMatch(/^Синтаксическая ошибка \(строка 4\)/);
  }, 30_000);

  it('applies code rules and rejects a broken reference', async () => {
    const rule = { pattern: 'HTTPException', message: 'Сообщите об отсутствии заметки через HTTPException', forbid: false };
    expect((await checkFastapi(task({ code: [rule] }), 'app = 1', run)).problems).toEqual([rule.message]);
    await expect(checkFastapi(task({}, 'app = FastAPI('), SOLUTION, run)).rejects.toBeInstanceOf(SolutionError);
  }, 30_000);
});
