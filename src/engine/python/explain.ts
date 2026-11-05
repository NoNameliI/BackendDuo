import type { PythonError } from './runtime';

const HINTS: [RegExp, (m: RegExpExecArray, e: PythonError) => string][] = [
  [/^NameError$/, (_, e) => `${e.message.replace(/^name '(\w+)' is not defined.*$/, 'Имя «$1» не определено')}: опечатка в имени или забыт import.`],
  [/^IndentationError$|^TabError$/, () => 'Сдвиг строк не совпадает: тело функции и блоков if/for сдвигается на 4 пробела относительно их заголовка.'],
  [/^SyntaxError$/, (_, e) => `Python не понял строку: ${e.message}. Проверьте двоеточие в конце строк def/if/class, скобки и кавычки.`],
  [/^ModuleNotFoundError$/, (_, e) => `${e.message}. В учебной среде есть fastapi, pydantic и стандартная библиотека Python.`],
  [/^ImportError$/, (_, e) => e.message],
  [/^KeyError$/, (_, e) => `В словаре нет ключа ${e.message}: проверьте, что запись существует, прежде чем её читать (и верните 404, если нет).`],
  [/^IndexError$/, () => 'Обращение к элементу списка за его концом.'],
  [/^TypeError$/, (_, e) => `Ошибка типов: ${e.message}.`],
  [/^AttributeError$/, (_, e) => `У объекта нет такого атрибута: ${e.message}.`],
  [/^ZeroDivisionError$/, () => 'Деление на ноль.'],
  [/^ValueError$/, (_, e) => `Неподходящее значение: ${e.message}.`],
];

/** One readable line about an error of the learner's main.py, with its line number. */
export function explainPythonError(error: PythonError): string {
  const where = error.line ? `строка ${error.line}` : 'main.py';
  const prefix = error.kind === 'request' ? `Ошибка в обработчике (${where})` : error.kind === 'syntax' ? `Синтаксическая ошибка (${where})` : `main.py не запускается (${where})`;
  if (error.type === 'LoadError') return error.message;
  for (const [re, make] of HINTS) {
    const m = re.exec(error.type);
    if (m) return `${prefix}: ${error.type}. ${make(m, error)}`;
  }
  return `${prefix}: ${error.type}: ${error.message}`;
}
