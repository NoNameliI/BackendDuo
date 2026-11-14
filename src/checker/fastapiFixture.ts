// A small neutral FastAPI course for tests: one lesson with every project task type, written in the lesson format.
import { loadCourse, type Course, type PythonTask } from '@/content/loadCourse';

const fence = '```';
const block = (info: string, body: string) => `${fence}${info}\n${body}\n${fence}\n`;
const meta = (o: object) => block('json', JSON.stringify(o, null, 2));

const MAIN = 'from fastapi import FastAPI\nfrom routers.items import router\n\napp = FastAPI()\napp.include_router(router)';

const ITEMS = (extra = '', body = '    if item_id not in ITEMS:\n        raise HTTPException(status_code=404, detail="Not found")\n    return {"id": item_id, "name": ITEMS[item_id]}') => `from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/items"${extra ? `, ${extra.split('|')[0]}` : ''})
ITEMS = {1: "pen"}


@router.get("/{item_id}"${extra.includes('|') ? `, ${extra.split('|')[1]}` : ''})
def read_item(item_id: int):
${body}`;

const STUB_ITEMS = 'from fastapi import APIRouter\n\nrouter = APIRouter(prefix="/items")';
const BARE_MAIN = 'from fastapi import FastAPI\n\napp = FastAPI()';
const INLINE_MAIN = `from fastapi import FastAPI, HTTPException

app = FastAPI()
ITEMS = {1: "pen"}


@app.get("/items/{item_id}")
def read_item(item_id: int):
    if item_id not in ITEMS:
        raise HTTPException(status_code=404, detail="Not found")
    return {"id": item_id, "name": ITEMS[item_id]}`;

const TESTS = `from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_found():
    r = client.get("/items/1")
    assert r.status_code == 200
    assert r.json() == {"id": 1, "name": "pen"}


def test_missing():
    assert client.get("/items/9").status_code == 404`;

const lesson = [
  '# Фикстура FastAPI',
  '',
  'Теория урока.',
  '',
  // fastapi, several files, a wrong variant
  '## task fa-multi',
  meta({ type: 'fastapi', title: 'Роутер', hints: ['h'], wrong: { 'no-404': 'нет ответа 404' } }),
  'Подключите роутер с маршрутом GET /items/{item_id}.',
  block('python starter path=main.py', BARE_MAIN),
  block('python starter path=routers/__init__.py', ''),
  block('python starter path=routers/items.py', STUB_ITEMS),
  block('python solution path=main.py', MAIN),
  block('python solution path=routers/__init__.py', ''),
  block('python solution path=routers/items.py', ITEMS()),
  block('python wrong id=no-404 path=routers/items.py', ITEMS('', '    return {"id": item_id, "name": ITEMS.get(item_id)}')),
  block('http tests', 'GET /items/1\n###\nGET /items/9'),
  // fix-bug: the 404 branch is inverted
  '## task fa-bug',
  meta({ type: 'fix-bug', title: 'Ошибка', hints: ['h'] }),
  'Найдите ошибку: существующий товар не находится.',
  block('python starter path=main.py', MAIN),
  block('python starter path=routers/__init__.py', ''),
  block('python starter path=routers/items.py', ITEMS('', '    if item_id in ITEMS:\n        raise HTTPException(status_code=404, detail="Not found")\n    return {"id": item_id, "name": ITEMS.get(item_id)}')),
  block('python solution path=main.py', MAIN),
  block('python solution path=routers/__init__.py', ''),
  block('python solution path=routers/items.py', ITEMS()),
  block('python wrong id=still-inverted path=routers/items.py', ITEMS('', '    if item_id in ITEMS:\n        raise HTTPException(status_code=404, detail="Not found")\n    return {"id": item_id, "name": ITEMS.get(item_id)}')),
  block('http tests', 'GET /items/1\n###\nGET /items/9'),
  // refactor: move the route to a router, keep the behavior
  '## task fa-refactor',
  meta({
    type: 'refactor',
    title: 'Вынесите роутер',
    hints: ['h'],
    readonly: ['routers/__init__.py'],
    check: { static: [{ rule: 'router', file: 'routers/items.py', message: 'Вынесите маршрут в routers/items.py и подключите include_router' }] },
  }),
  'Вынесите маршрут в роутер.',
  block('python starter path=main.py', INLINE_MAIN),
  block('python starter path=routers/__init__.py', ''),
  block('python solution path=main.py', MAIN),
  block('python solution path=routers/__init__.py', ''),
  block('python solution path=routers/items.py', ITEMS()),
  block('python wrong id=unchanged path=main.py', INLINE_MAIN),
  block('http tests', 'GET /items/1\n###\nGET /items/9'),
  // pytest: tests under tests/ against the reference app, two mutants
  '## task fa-pytest',
  meta({
    type: 'pytest',
    title: 'Тесты',
    hints: ['h'],
    readonly: ['main.py', 'routers/__init__.py', 'routers/items.py'],
    check: { minTests: 2 },
    mutants: { 'no-404': 'для несуществующего товара нет ответа 404', 'wrong-name': 'поле name искажено' },
    wrong: { 'one-test': 'один тест не ловит мутанта' },
  }),
  'Напишите тесты к приложению.',
  block('python starter path=main.py', MAIN),
  block('python starter path=routers/__init__.py', ''),
  block('python starter path=routers/items.py', ITEMS()),
  block('python starter path=tests/test_items.py', '# TODO'),
  block('python solution path=main.py', MAIN),
  block('python solution path=routers/__init__.py', ''),
  block('python solution path=routers/items.py', ITEMS()),
  block('python solution path=tests/test_items.py', TESTS),
  block('python wrong id=one-test path=tests/test_items.py', TESTS.replace(/\n\n\ndef test_missing[\s\S]*$/, '\n\n\ndef test_again():\n    assert client.get("/items/1").status_code == 200')),
  block('python mutant id=no-404 path=routers/items.py', ITEMS('', '    return {"id": item_id, "name": ITEMS.get(item_id)}')),
  block('python mutant id=wrong-name path=routers/items.py', ITEMS('', '    if item_id not in ITEMS:\n        raise HTTPException(status_code=404, detail="Not found")\n    return {"id": item_id, "name": "pen "}')),
  // openapi
  '## task fa-openapi',
  meta({ type: 'openapi', title: 'Документация', hints: ['h'], check: { compare: ['operationId', 'tags', 'summary'] }, wrong: { 'no-tag': 'нет тега' } }),
  'Опишите маршрут в документации.',
  block('python starter path=main.py', MAIN),
  block('python starter path=routers/__init__.py', ''),
  block('python starter path=routers/items.py', ITEMS()),
  block('python solution path=main.py', MAIN),
  block('python solution path=routers/__init__.py', ''),
  block('python solution path=routers/items.py', ITEMS('tags=["items"]|summary="Read an item", operation_id="read_item"')),
  block('python wrong id=no-tag path=routers/items.py', ITEMS('|summary="Read an item", operation_id="read_item"')),
  // static
  '## task fa-static',
  meta({
    type: 'static',
    title: 'Без блокировок',
    hints: ['h'],
    check: { static: [{ rule: 'no-blocking-in-async', message: 'В async def нельзя вызывать time.sleep' }] },
    wrong: { 'requests-call': 'блокирующий requests.get' },
  }),
  'Уберите блокирующий вызов из async-обработчика.',
  block('python starter', 'import time\nfrom fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get("/slow")\nasync def slow():\n    time.sleep(1)\n    return {"ok": True}'),
  block('python solution', 'import asyncio\nfrom fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get("/slow")\nasync def slow():\n    await asyncio.sleep(1)\n    return {"ok": True}'),
  block('python wrong id=requests-call', 'import requests\nfrom fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get("/slow")\nasync def slow():\n    requests.get("http://x")\n    return {"ok": True}'),
].join('\n');

const manifest = {
  id: 'fixture-fastapi',
  title: 'Fixture FastAPI',
  description: 'Fixture',
  engine: 'api',
  errors: 'errors.json',
  worlds: [{ id: 'w1', title: 'W', summary: 'S', lessons: [{ id: 'fx-l1', file: 'l1.md' }] }],
  levels: [{ xp: 0, title: 'A' }, { xp: 50, title: 'B' }],
};

export const fastapiFixtureFiles = (root = '/courses/fixture-fastapi'): Record<string, string> => ({
  [`${root}/manifest.json`]: JSON.stringify(manifest),
  [`${root}/errors.json`]: '{}',
  [`${root}/l1.md`]: lesson,
});

export const fastapiFixtureLesson = lesson;

export function fastapiFixtureCourse(): Course {
  return loadCourse(fastapiFixtureFiles(), '/courses/fixture-fastapi');
}

export function fastapiFixtureTask(course: Course, id: string): PythonTask {
  const task = course.worlds[0].lessons[0].tasks.find((t) => t.id === id);
  if (!task || !('project' in task)) throw new Error(`no python task ${id}`);
  return task;
}
