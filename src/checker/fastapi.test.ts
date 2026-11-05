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

  it('ignores key order and equivalent validation rules', async () => {
    const swapped = SOLUTION.replace('return {"id": note_id, "text": NOTES[note_id]}', 'return {"text": NOTES[note_id], "id": note_id}');
    expect((await checkFastapi(task(), swapped, run)).problems).toEqual([]);
    const MODEL = 'from fastapi import FastAPI\nfrom pydantic import BaseModel, Field\napp = FastAPI()\nclass Item(BaseModel):\n    qty: int = Field(ge=1)\n@app.post("/items")\ndef add(item: Item):\n    return item\n';
    const posting = { ...task({}, MODEL), httpTests: 'POST /items\nContent-Type: application/json\n\n{"qty": 0}\n###\nPOST /items\nContent-Type: application/json\n\n{"qty": 2}' } as FastapiTask;
    expect((await checkFastapi(posting, MODEL.replace('ge=1', 'gt=0'), run)).problems).toEqual([]);
    expect((await checkFastapi(posting, MODEL.replace('Field(ge=1)', 'Field(ge=1, le=1)'), run)).problems[0]).toMatch(/^Запрос POST \/items: ожидается код 200, приложение ответило 422/);
  }, 30_000);

  it('applies code rules and rejects a broken reference', async () => {
    const rule = { pattern: 'HTTPException', message: 'Сообщите об отсутствии заметки через HTTPException', forbid: false };
    expect((await checkFastapi(task({ code: [rule] }), 'app = 1', run)).problems).toEqual([rule.message]);
    await expect(checkFastapi(task({}, 'app = FastAPI('), SOLUTION, run)).rejects.toBeInstanceOf(SolutionError);
  }, 30_000);
});
