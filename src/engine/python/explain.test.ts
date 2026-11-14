import { describe, expect, it } from 'vitest';
import { explainForgottenAwait, explainOutput, explainPythonError, explainPytest } from './explain';
import type { PythonError, PytestCase, PytestRun } from './runtime';

const error = (type: string, message: string, extra: Partial<PythonError> = {}): PythonError => ({ kind: 'load', type, message, line: 3, file: 'main.py', trace: [], ...extra });

describe('explainPythonError', () => {
  it('keeps the one-line form for main.py and names other files', () => {
    expect(explainPythonError(error('ZeroDivisionError', 'division by zero', { kind: 'request', line: 26 }))).toBe('Ошибка в обработчике (строка 26): ZeroDivisionError. Деление на ноль.');
    expect(explainPythonError(error('ZeroDivisionError', 'x', { kind: 'request', file: 'routers/items.py', line: 6 }))).toBe('Ошибка в обработчике (routers/items.py, строка 6): ZeroDivisionError. Деление на ноль.');
    expect(explainPythonError(error('ValueError', 'bad', { file: 'schemas.py' }))).toBe('Проект не запускается (schemas.py, строка 3): ValueError. Неподходящее значение: bad.');
    expect(explainPythonError(error('ValueError', 'bad', { file: null, line: null }))).toBe('main.py не запускается (main.py): ValueError. Неподходящее значение: bad.');
    expect(explainPythonError(error('LoadError', 'В main.py нет переменной app'))).toBe('В main.py нет переменной app');
  });

  it('explains a response that does not match response_model', () => {
    const message =
      "1 validation errors:\n  {'type': 'missing', 'loc': ('response', 'price'), 'msg': 'Field required', 'input': {'id': 1}}\n  {'type': 'int_parsing', 'loc': ('response', 'items', 0, 'qty'), 'msg': 'x', 'input': 'a'}";
    const text = explainPythonError(error('ResponseValidationError', message, { kind: 'request' }));
    expect(text).toContain('не подходит под response_model');
    expect(text).toContain('поле «price»: его нет в ответе');
    expect(text).toContain('поле «items.0.qty»: int_parsing');
  });

  it('explains a forgotten await from the error and from the warning text', () => {
    expect(explainPythonError(error('TypeError', "'coroutine' object is not subscriptable", { kind: 'request' }))).toContain('забыт await');
    expect(explainPythonError(error('AttributeError', "'coroutine' object has no attribute 'json'", { kind: 'request' }))).toContain('забыт await');
    expect(explainForgottenAwait("RuntimeWarning: coroutine 'fetch' was never awaited")).toBe('Корутина «fetch» создана, но не выполнена: перед вызовом async-функции нужен await (await fetch(...)).');
    expect(explainOutput("ok\nRuntimeWarning: coroutine 'sleep' was never awaited\n")).toHaveLength(1);
    expect(explainOutput('nothing here')).toEqual([]);
    expect(explainForgottenAwait('plain')).toBeNull();
  });

  it('tells a package of another lesson from a missing project file', () => {
    const lesson = explainPythonError(error('ModuleNotFoundError', "No module named 'sqlalchemy'"));
    expect(lesson).toContain('Пакет «sqlalchemy» в этом уроке не подключён');
    expect(explainPythonError(error('ModuleNotFoundError', "No module named 'sqlalchemy.orm'"))).toContain('«sqlalchemy»');
    const file = explainPythonError(error('ModuleNotFoundError', "No module named 'routers.items'"));
    expect(file).toContain('routers/items.py');
    expect(file).toContain('__init__.py');
  });

  it('explains circular imports in both of the interpreter\'s forms', () => {
    const from = explainPythonError(error('ImportError', "cannot import name 'f' from partially initialized module 'a' (most likely due to a circular import) (/project/a.py)"));
    expect(from).toContain('Циклический импорт: модуль «a»');
    expect(from).toContain('«f»');
    const attr = explainPythonError(error('AttributeError', "partially initialized module 'm1' has no attribute 'VALUE' (most likely due to a circular import)"));
    expect(attr).toContain('Циклический импорт');
  });

  it('explains a relative import beyond the top level and without a package', () => {
    expect(explainPythonError(error('ImportError', 'attempted relative import beyond top-level package'))).toContain('выходит за пределы пакета');
    expect(explainPythonError(error('ImportError', 'attempted relative import with no known parent package'))).toContain('только внутри пакета');
  });

  it('passes the message of the import guard through', () => {
    expect(explainPythonError(error('ImportError', 'Установка пакетов недоступна: пакеты урока уже подключены'))).toContain('Установка пакетов недоступна');
  });

  it('explains a deadlock and a websocket closed after a wait with nothing scheduled', () => {
    expect(explainPythonError(error('Deadlock', 'Приложение ждёт события, которое никогда не наступит', { kind: 'request' }))).toContain('Приложение ждёт события');
    const ws = explainPythonError(error('WebSocketDisconnect', '1000', { kind: 'request' }));
    expect(ws).toContain('код 1000');
    expect(ws).toContain('websocket_connect');
  });
});

const failed = (message: string, outcome: PytestCase['outcome'] = 'failed'): PytestCase => ({ nodeid: 'tests/test_x.py::test_a', outcome, message, file: 'tests/test_x.py', line: 4 });
const runOf = (exit: number): PytestRun => ({ exit, counts: { passed: 0, failed: 0, error: 0, skipped: 0 }, tests: [], output: '', ms: 1 });

describe('explainPytest', () => {
  it('names a status code comparison', () => {
    const text = explainPytest(failed('E   assert 404 == 200\nE    +  where 404 = <Response [404 Not Found]>.status_code'));
    expect(text).toBe('Код ответа 404, а тест ожидает 200: слева — то, что вернуло приложение, справа — то, что ждёт тест.');
  });

  it('explains other comparisons and key errors', () => {
    expect(explainPytest(failed('E   assert {"id": 1} == {"id": 2}'))).toBe('Значения не совпали: приложение вернуло {"id": 1}, а тест ожидает {"id": 2}.');
    expect(explainPytest(failed("E   KeyError: 'price'"))).toContain('нет ключа \'price\'');
    expect(explainPytest(failed('E   ZeroDivisionError: division by zero'))).toBeNull();
  });

  it('explains a missing fixture', () => {
    const text = explainPytest(failed("E       fixture 'client' not found\nE       available fixtures: x", 'error'));
    expect(text).toContain('Фикстура «client» не найдена');
    expect(text).toContain('conftest.py');
  });

  it('explains a collection error', () => {
    expect(explainPytest(failed("E   ModuleNotFoundError: No module named 'main'", 'error'))).toContain('не импортируется «main»');
    expect(explainPytest(failed('E     File "x.py", line 2\nE   SyntaxError: invalid syntax', 'error'))).toBeNull();
    expect(explainPytest(failed('E   SyntaxError: invalid syntax', 'error'))).toContain('не разбирается');
  });

  it('explains a run without tests (exit code 5) and says nothing for the others', () => {
    expect(explainPytest(runOf(5))).toContain('test_*.py');
    expect(explainPytest(runOf(5))).toContain('def test_');
    expect(explainPytest(runOf(0))).toBeNull();
    expect(explainPytest(runOf(1))).toBeNull();
    expect(explainPytest({ ...failed(''), outcome: 'passed' })).toBeNull();
  });
});
