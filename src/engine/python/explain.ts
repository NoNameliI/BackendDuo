import type { PythonError, PytestCase, PytestRun } from './runtime';

/** Packages that exist only in some lessons (lazy groups): importing them elsewhere is a lesson mistake, not a typo. */
const GROUP_PACKAGES = new Set(['httpx', 'pytest', 'sqlalchemy', 'bcrypt', 'jwt', 'multipart', 'python_multipart', 'pydantic_settings', 'dotenv']);

const noModule = (message: string) => /No module named '([^']+)'/.exec(message)?.[1] ?? null;

/** `loc` tuples and error types out of pydantic's text: "'type': 'missing', 'loc': ('response', 'price')". */
function validationFields(message: string): { loc: string; type: string }[] {
  const found: { loc: string; type: string }[] = [];
  const re = /'type': '([^']+)', 'loc': \(([^)]*)\)/g;
  for (let m = re.exec(message); m; m = re.exec(message)) {
    const loc = [...m[2].matchAll(/'([^']*)'|(\d+)/g)].map((x) => x[1] ?? x[2]).filter((x) => x !== 'response');
    found.push({ loc: loc.join('.') || 'весь ответ', type: m[1] });
  }
  return found;
}

/** The sentence about a coroutine that was created but never awaited (`await` forgotten), or null. */
export function explainForgottenAwait(text: string): string | null {
  const m = /coroutine '([^']+)' was never awaited/.exec(text);
  if (m) return `Корутина «${m[1]}» создана, но не выполнена: перед вызовом async-функции нужен await (await ${m[1]}(...)).`;
  if (/'coroutine' object/.test(text)) return 'Вместо результата получена корутина: перед вызовом async-функции забыт await.';
  return null;
}

/** Lines of the captured output worth a hint (a forgotten await shows up there as a warning). */
export function explainOutput(output: string): string[] {
  const hint = explainForgottenAwait(output);
  return hint ? [hint] : [];
}

type Hint = (m: RegExpExecArray, e: PythonError) => string | null;

const HINTS: [RegExp, Hint][] = [
  [/^NameError$/, (_, e) => `${e.message.replace(/^name '(\w+)' is not defined.*$/, 'Имя «$1» не определено')}: опечатка в имени или забыт import.`],
  [/^IndentationError$|^TabError$/, () => 'Сдвиг строк не совпадает: тело функции и блоков if/for сдвигается на 4 пробела относительно их заголовка.'],
  [/^SyntaxError$/, (_, e) => `Python не понял строку: ${e.message}. Проверьте двоеточие в конце строк def/if/class, скобки и кавычки.`],
  [
    /^ModuleNotFoundError$/,
    (_, e) => {
      const name = noModule(e.message);
      if (!name) return `${e.message}.`;
      const top = name.split('.')[0];
      if (GROUP_PACKAGES.has(top)) return `Пакет «${top}» в этом уроке не подключён: используйте то, что есть в уроке (fastapi, pydantic и стандартную библиотеку), или перейдите к уроку, где этот пакет разбирается.`;
      return `Модуль «${name}» не найден. Если это ваш файл — проверьте, что файл ${name.split('.').join('/')}.py есть в проекте, имя написано точно, а в папке пакета лежит __init__.py. Сторонних библиотек в учебной среде нет.`;
    },
  ],
  [
    /^ImportError$/,
    (_, e) => {
      if (/most likely due to a circular import/.test(e.message)) {
        const name = /cannot import name '([^']+)' from partially initialized module '([^']+)'/.exec(e.message);
        return name
          ? `Циклический импорт: модуль «${name[2]}» ещё не дочитан, когда из него берут «${name[1]}». Два файла не могут импортировать друг друга при загрузке: вынесите общее в третий файл или импортируйте внутри функции.`
          : 'Циклический импорт: два файла импортируют друг друга. Вынесите общее в третий файл или импортируйте внутри функции.';
      }
      if (/attempted relative import beyond top-level package/.test(e.message)) return 'Относительный импорт (from ..x import y) выходит за пределы пакета: файл лежит в корне проекта. Поднимайтесь на уровень выше только внутри папки с __init__.py, а из корня пишите from x import y.';
      if (/attempted relative import with no known parent package/.test(e.message)) return 'Относительный импорт (from .x import y) работает только внутри пакета: положите файлы в папку с __init__.py и запускайте главный файл из пакета.';
      return e.message;
    },
  ],
  [/^AttributeError$/, (_, e) => (/most likely due to a circular import/.test(e.message) ? 'Циклический импорт: модуль ещё не дочитан, когда из него берут имя. Вынесите общее в третий файл или импортируйте внутри функции.' : explainForgottenAwait(e.message) ?? `У объекта нет такого атрибута: ${e.message}.`)],
  [/^ResponseValidationError$/, (_, e) => {
    const fields = validationFields(e.message);
    const what = fields.length ? fields.map((f) => `поле «${f.loc}»: ${f.type === 'missing' ? 'его нет в ответе' : f.type}`).join('; ') : 'форма ответа другая';
    return `Ответ обработчика не подходит под response_model (${what}). Верните из обработчика данные нужной формы или поправьте модель ответа.`;
  }],
  [/^Deadlock$/, (_, e) => `${e.message}.`],
  [/^WebSocketDisconnect$/, (_, e) => `Соединение закрыто (код ${/\d+/.exec(e.message)?.[0] ?? '1000'}): приложение ждало сообщения, которого в учебной среде не будет. Отправляйте сообщения клиентом внутри with websocket_connect(...) и закрывайте соединение после ответа.`],
  [/^KeyError$/, (_, e) => `В словаре нет ключа ${e.message}: проверьте, что запись существует, прежде чем её читать (и верните 404, если нет).`],
  [/^IndexError$/, () => 'Обращение к элементу списка за его концом.'],
  [/^TypeError$/, (_, e) => explainForgottenAwait(e.message) ?? `Ошибка типов: ${e.message}.`],
  [/^ZeroDivisionError$/, () => 'Деление на ноль.'],
  [/^ValueError$/, (_, e) => `Неподходящее значение: ${e.message}.`],
];

const location = (error: PythonError) => {
  const file = error.file ?? 'main.py';
  if (error.line) return file === 'main.py' ? `строка ${error.line}` : `${file}, строка ${error.line}`;
  return file;
};

/** One readable line about an error of the learner's project, with its file and line number. */
export function explainPythonError(error: PythonError): string {
  const where = location(error);
  const main = (error.file ?? 'main.py') === 'main.py';
  const prefix = error.kind === 'request' ? `Ошибка в обработчике (${where})` : error.kind === 'syntax' ? `Синтаксическая ошибка (${where})` : `${main ? 'main.py' : 'Проект'} не запускается (${where})`;
  if (error.type === 'LoadError') return error.message;
  for (const [re, make] of HINTS) {
    const m = re.exec(error.type);
    if (m) {
      const text = make(m, error);
      if (text !== null) return `${prefix}: ${error.type}. ${text}`;
    }
  }
  return `${prefix}: ${error.type}: ${error.message}`;
}

const STATUS = /^assert (\d{3}) == (\d{3})$/;

/** A hint for one pytest case (a failure or an error), or for a whole run that found no tests (exit code 5). */
export function explainPytest(input: PytestCase | PytestRun): string | null {
  if ('exit' in input) {
    if (input.exit === 5) return 'pytest не нашёл ни одного теста: файл должен называться test_*.py (или *_test.py), а функция — начинаться с def test_.';
    return null;
  }
  if (input.outcome !== 'failed' && input.outcome !== 'error') return null;
  const lines = input.message.split('\n').map((l) => l.replace(/^E\s{0,3}/, '').trim());
  const first = lines[0] ?? '';
  const fixture = /fixture '([^']+)' not found/.exec(input.message);
  if (fixture) return `Фикстура «${fixture[1]}» не найдена: создайте её с @pytest.fixture в этом файле или в tests/conftest.py и проверьте, что имя аргумента теста совпадает с именем фикстуры.`;
  const missing = /^(?:ModuleNotFoundError|ImportError)\b/.exec(first);
  if (input.outcome === 'error' && missing) {
    const name = noModule(first);
    return name
      ? `Файл с тестами не удалось загрузить: не импортируется «${name}». Проверьте имя модуля и что файл есть в проекте (в папках-пакетах нужен __init__.py).`
      : `Файл с тестами не удалось загрузить: ${first.replace(/^\w+(?:Error)?:\s*/, '')}`;
  }
  if (input.outcome === 'error' && /^(?:SyntaxError|IndentationError)/.test(first)) return `Файл не разбирается: ${first}. Проверьте двоеточия, скобки и отступы.`;
  const key = /^KeyError: (.+)$/.exec(first);
  if (key) return `В JSON ответа нет ключа ${key[1]}: посмотрите, что на самом деле вернуло приложение (print(response.json())), и сверьте имя поля.`;
  const status = STATUS.exec(first);
  if (status && /\.status_code/.test(input.message)) return `Код ответа ${status[1]}, а тест ожидает ${status[2]}: слева — то, что вернуло приложение, справа — то, что ждёт тест.`;
  const eq = /^assert (.+?) == (.+)$/.exec(first);
  if (eq) return `Значения не совпали: приложение вернуло ${eq[1]}, а тест ожидает ${eq[2]}.`;
  return null;
}
