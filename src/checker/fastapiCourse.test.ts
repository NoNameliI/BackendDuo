import { beforeAll, describe, expect, it } from 'vitest';
import { nodeCourseRuntime } from '../../scripts/pyodide/node';
import { loadCourse } from '@/content/loadCourse';
import { parseLesson } from '@/content/parseLesson';
import { solutionProject, starterProject, wrongProject } from './fastapi';
import { checkPythonTask, type CourseRuntime } from './fastapiCourse';
import { fastapiFixtureCourse, fastapiFixtureFiles, fastapiFixtureLesson, fastapiFixtureTask } from './fastapiFixture';

const course = fastapiFixtureCourse();
const task = (id: string) => fastapiFixtureTask(course, id);
let runtime: CourseRuntime;
beforeAll(async () => {
  runtime = await nodeCourseRuntime();
}, 120_000);

describe('fixture course', () => {
  it('reads project files, overlays and defaults from the lesson', () => {
    const t = task('fa-multi');
    expect(Object.keys(t.project.solution).sort()).toEqual(['main.py', 'routers/__init__.py', 'routers/items.py']);
    expect(t.tree).toBe(true);
    expect(Object.keys(t.pythonWrong['no-404'])).toEqual(['routers/items.py']);
    const single = task('fa-static');
    expect(single.tree).toBe(false);
    expect(Object.keys(single.project.solution)).toEqual(['main.py']);
    expect(single.pythonSolution).toContain('asyncio.sleep');
    expect(Object.keys(task('fa-pytest').pythonMutants).sort()).toEqual(['no-404', 'wrong-name']);
  });
});

describe('every task type: the solution passes, the starter and each wrong variant fail', () => {
  for (const id of ['fa-multi', 'fa-bug', 'fa-refactor', 'fa-pytest', 'fa-openapi', 'fa-static']) {
    it(id, async () => {
      const t = task(id);
      expect((await checkPythonTask(t, solutionProject(t), runtime)).problems).toEqual([]);
      expect((await checkPythonTask(t, starterProject(t), runtime)).passed).toBe(false);
      for (const wrong of Object.keys(t.pythonWrong)) {
        expect((await checkPythonTask(t, wrongProject(t, wrong), runtime)).passed, wrong).toBe(false);
      }
    }, 120_000);
  }
});

describe('messages', () => {
  it('fastapi names the request that differs', async () => {
    const t = task('fa-multi');
    const out = await checkPythonTask(t, wrongProject(t, 'no-404'), runtime);
    expect(out.problems[0]).toMatch(/^Запрос GET \/items\/9: ожидается код 404, приложение ответило 200/);
  }, 60_000);

  it('refactor names a lost or an extra route', async () => {
    const t = task('fa-refactor');
    const lost = { files: { ...solutionProject(t).files, 'routers/items.py': 'from fastapi import APIRouter\n\nrouter = APIRouter(prefix="/items")\n\n\n@router.get("/")\ndef items():\n    return []\n' } };
    const out = await checkPythonTask(t, lost, runtime);
    expect(out.problems.join('\n')).toMatch(/Маршрут GET \/items\/\{item_id\} пропал/);
    expect(out.problems.join('\n')).toMatch(/Появился лишний маршрут GET \/items\//);
  }, 60_000);

  it('refactor puts the read-only files back and runs the static rules first', async () => {
    const t = task('fa-refactor');
    const out = await checkPythonTask(t, wrongProject(t, 'unchanged'), runtime);
    expect(out.problems).toEqual(['Вынесите маршрут в routers/items.py и подключите include_router']);
  }, 60_000);

  it('pytest reports a mutant the tests did not notice, and weak or missing tests', async () => {
    const t = task('fa-pytest');
    const weak = await checkPythonTask(t, wrongProject(t, 'one-test'), runtime);
    expect(weak.problems).toEqual(['Тесты не заметили ошибку: для несуществующего товара нет ответа 404']);
    const single = await checkPythonTask(t, { files: { ...solutionProject(t).files, 'tests/test_items.py': 'def test_one():\n    assert True\n' } }, runtime);
    expect(single.problems[0]).toMatch(/^Нужно не меньше 2 тестов, прошло 1/);
    const lenient = { files: { ...solutionProject(t).files, 'tests/test_items.py': `${solutionProject(t).files['tests/test_items.py']}\n\ndef test_third():\n    assert client.get("/items/1").status_code == 200\n`.replace(/def test_missing[\s\S]*?404\n/, '') } };
    const missed = await checkPythonTask(t, lenient, runtime);
    expect(missed.problems).toEqual(['Тесты не заметили ошибку: для несуществующего товара нет ответа 404']);
    const none = await checkPythonTask(t, starterProject(t), runtime);
    expect(none.problems[0]).toMatch(/pytest не нашёл/);
    const failing = await checkPythonTask(t, { files: { ...solutionProject(t).files, 'tests/test_items.py': TESTS_FAIL } }, runtime);
    expect(failing.problems[0]).toMatch(/^Тест test_items\.py::test_found не прошёл/);
  }, 120_000);

  it('pytest ignores edits of the read-only app files', async () => {
    const t = task('fa-pytest');
    const hacked = { files: { ...solutionProject(t).files, 'routers/items.py': 'raise SystemExit(0)' } };
    expect((await checkPythonTask(t, hacked, runtime)).problems).toEqual([]);
  }, 60_000);

  it('openapi names the operation and the aspect', async () => {
    const t = task('fa-openapi');
    const out = await checkPythonTask(t, wrongProject(t, 'no-tag'), runtime);
    expect(out.problems.join('\n')).toContain('GET /items/{item_id}');
  }, 60_000);

  it('static stops before any request and names the file', async () => {
    const t = task('fa-static');
    const out = await checkPythonTask(t, starterProject(t), runtime);
    expect(out.problems).toEqual(['В async def нельзя вызывать time.sleep']);
  }, 60_000);
});

const TESTS_FAIL = 'from fastapi.testclient import TestClient\nfrom main import app\n\nclient = TestClient(app)\n\n\ndef test_found():\n    assert client.get("/items/9").status_code == 200\n\n\ndef test_missing():\n    assert client.get("/items/9").status_code == 404\n';

describe('lesson format', () => {
  const wrap = (fences: string) => `# L\n\n## task a\n\`\`\`json\n{"type":"static","title":"t","hints":["h"]}\n\`\`\`\nP\n${fences}`;
  it('old forms keep the old keys', () => {
    const raw = parseLesson(wrap('```python starter\nx = 1\n```\n```python solution\nx = 2\n```\n```http tests\nGET /\n```\n'));
    expect(raw.tasks[0]).toMatchObject({ pythonStarter: 'x = 1', pythonSolution: 'x = 2', httpTests: 'GET /' });
  });
  it('rejects unknown attributes, duplicates and wrong id use, in Russian', () => {
    expect(() => parseLesson(wrap('```python solution color=red\nx\n```\n'))).toThrow(/неизвестный атрибут «color»/);
    expect(() => parseLesson(wrap('```python solution path=a.py\nx\n```\n```python solution path=a.py\ny\n```\n'))).toThrow(/задан дважды/);
    expect(() => parseLesson(wrap('```python wrong path=a.py\nx\n```\n'))).toThrow(/нужен атрибут id/);
    expect(() => parseLesson(wrap('```python solution id=a\nx\n```\n'))).toThrow(/только у блоков wrong и mutant/);
    expect(() => parseLesson(wrap('```python wrong id=a\nx\n```\n```python wrong id=a\ny\n```\n'))).toThrow(/задан дважды/);
  });
  it('schema rules: mutants need descriptions, wrong ids need blocks, the entry must exist', () => {
    const load = (lesson: string) => () => loadCourse({ ...fastapiFixtureFiles(), '/courses/fixture-fastapi/l1.md': lesson }, '/courses/fixture-fastapi');
    expect(load(fastapiFixtureLesson.replace('"mutants": {', '"mutants": { "ghost": "нет блока",'))).toThrow(/ghost/);
    expect(load(fastapiFixtureLesson.replace('"wrong": {', '"wrong": { "nobody": "нет",'))).toThrow(/nobody/);
    expect(load(fastapiFixtureLesson.replace('"title": "Роутер",', '"title": "Роутер", "entry": "app.py",'))).toThrow(/нет файла «app.py»/);
    expect(load(fastapiFixtureLesson.replace('"title": "Роутер",', '"title": "Роутер", "readonly": ["x.py"],'))).toThrow(/readonly/);
  });
});

describe('pytest hardening', () => {
  const t = () => task('fa-pytest');
  const withTests = (text: string) => ({ files: { ...solutionProject(t()).files, 'tests/test_items.py': text } });
  const HEAD = 'import builtins\nfrom fastapi.testclient import TestClient\nfrom main import app\n\nclient = TestClient(app)\n\n\n';

  it('state kept between runs does not make every mutant look caught', async () => {
    const counter = `${HEAD}def test_once():\n    builtins._leak_counter = getattr(builtins, "_leak_counter", 0) + 1\n    assert builtins._leak_counter == 1\n\n\ndef test_found():\n    assert client.get("/items/1").status_code == 200\n`;
    // The static rule may refuse such tests first; here it is switched off to reach the order check itself.
    const noStatic: CourseRuntime = { ...runtime, analyze: async () => ({ problems: [] }) };
    const out = await checkPythonTask(t(), withTests(counter), noStatic);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toMatch(/^Тесты зависят от порядка запуска или прошлых запусков/);
  }, 120_000);

  it('tests that read the app source are refused before they run', async () => {
    const peek = `${HEAD}def test_source():\n    assert "ITEMS" in open("routers/items.py").read()\n\n\ndef test_found():\n    assert client.get("/items/1").status_code == 200\n`;
    const out = await checkPythonTask(t(), withTests(peek), runtime);
    expect(out.passed).toBe(false);
    expect(out.problems[0]).not.toMatch(/Неизвестное правило/);
  }, 60_000);

  it('files that shadow a read-only module are refused', async () => {
    const pkg = await checkPythonTask(t(), { files: { ...solutionProject(t()).files, 'routers/items/__init__.py': 'x = 1\n' } }, runtime);
    expect(pkg.problems[0]).toMatch(/^Файл «routers\/items\/__init__.py» перекрывает модуль «routers\/items.py»/);
    const flat = await checkPythonTask(t(), { files: { ...solutionProject(t()).files, 'routers.py': 'x = 1\n' } }, runtime);
    expect(flat.problems[0]).toMatch(/^Файл «routers.py» перекрывает модуль «routers\/__init__.py»/);
  }, 60_000);

  it('a refactor task needs a static rule', () => {
    const bad = fastapiFixtureLesson.replace(/"static": \[\s*\{\s*"rule": "router"[\s\S]*?\}\s*\]/, '"static": []');
    expect(bad).not.toBe(fastapiFixtureLesson);
    expect(() => loadCourse({ ...fastapiFixtureFiles(), '/courses/fixture-fastapi/l1.md': bad }, '/courses/fixture-fastapi')).toThrow(/refactor нужно хотя бы одно правило/);
  });
});
