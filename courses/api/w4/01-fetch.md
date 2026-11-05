# Как фронтенд вызывает API

Команда делает трекер задач. Страница доски открыта в браузере, а сами задачи хранятся на сервере `https://api.tracker.local`. Чтобы показать доску, код страницы на JavaScript отправляет HTTP-запрос и разбирает ответ — ровно такой же запрос, какие вы собирали в композере. В этом уроке вы научитесь читать код фронтенда и видеть за ним HTTP: какой метод, адрес, заголовки и тело он отправит.

### Асинхронность простыми словами

Запрос к серверу занимает время: десятки миллисекунд, а при плохой связи — секунды. Если бы страница всё это время стояла, она бы не реагировала на клики. Поэтому в JavaScript такие действия **асинхронные**: браузер запускает запрос и продолжает работать, а код получает результат, когда он готов.

Чтобы дождаться результата, перед действием пишут `await`:

```javascript
async function имяФункции() {
  const переменная = await долгоеДействие();
}
```

- `async function` — функция, внутри которой можно ждать. `await` работает только внутри таких функций.
- `await` — «дождись результата и только потом переходи к следующей строке». Пока функция ждёт, страница остаётся живой.
- `const переменная = ...` — объявление переменной, как присваивание в Python. Точка с запятой в конце строки — обычный стиль JavaScript.
- Фигурные скобки `{ }` ограничивают тело функции — в Python для этого служат отступы.

Без `await` в переменную попадёт не результат, а «обещание результата» (`Promise`) — объект, у которого ещё нет ни статуса, ни данных.

### fetch: получить данные

`fetch` — встроенная функция браузера для HTTP-запросов. Самый короткий вызов отправляет `GET`:

```javascript
const response = await fetch('адрес');
```

- `fetch('адрес')` — полный URL в кавычках: схема, сервер, путь и параметры. Строки в JavaScript можно писать в одинарных `'...'` или двойных `"..."` кавычках.
- Без второго аргумента метод — `GET`, тела нет.
- `response` — объект ответа: в нём код статуса, заголовки и тело.

Например, страница «Задачи Ирины» вызывает:

```javascript
const response = await fetch('https://api.tracker.local/tasks?assignee=irina');
```

Браузер отправит вот такой запрос — нажмите «Отправить» и посмотрите на ответ:

```http example
GET https://api.tracker.local/tasks?assignee=irina
```

В композере можно писать и полный адрес, и только путь `/tasks?assignee=irina`: сервер задания уже известен.

### Читаем ответ: status, ok и json()

Ответ разбирают в три шага:

```javascript
const response = await fetch(адрес);
if (!response.ok) {
  // показать пользователю ошибку
}
const data = await response.json();
```

- `response.status` — код статуса числом: `200`, `404`, `422`.
- `response.ok` — `true`, если код от `200` до `299`, иначе `false`. Восклицательный знак `!` — отрицание, как `not` в Python: `if (!response.ok)` значит «если ответ не успешный».
- `// ...` — комментарий в JavaScript, как `#` в Python.
- `response.json()` — читает тело и превращает JSON в объект JavaScript. Тело тоже приходит не мгновенно, поэтому и здесь нужен `await`.

Важная деталь: `fetch` **не считает ошибкой** ответы `404` или `500`. Ответ пришёл — значит, запрос состоялся, а `response.ok` будет `false`. `fetch` выбрасывает ошибку, только если ответа нет совсем: нет сети или браузер заблокировал ответ (об этом — в следующем уроке). Поэтому `response.ok` проверяют всегда.

Запросите задачу, которой нет, — сервер ответит `404`, и у такого ответа `response.ok` равен `false`:

```http example
GET /tasks/99
```

### Отправляем данные: method, headers, body

Чтобы создать или изменить запись, `fetch` получает второй аргумент — объект с настройками:

```javascript
const response = await fetch('адрес', {
  method: 'МЕТОД',
  headers: { 'Имя-Заголовка': 'значение' },
  body: JSON.stringify(объект),
});
```

- `method` — метод запроса строкой: `'POST'`, `'PATCH'`, `'DELETE'`.
- `headers` — заголовки: пары `'Имя': 'значение'` через запятую. Для JSON нужен `'Content-Type': 'application/json'`.
- `body` — тело запроса. Это должна быть строка, поэтому объект превращают в JSON функцией `JSON.stringify`.
- Настройки перечисляются через запятую; запятая после последней настройки в JavaScript разрешена.

Объект JavaScript похож на словарь Python, но ключи часто пишут без кавычек, а строки — в одинарных кавычках: `{ status: 'done', priority: 'low' }`. `JSON.stringify` превращает его в настоящий JSON с двойными кавычками: `{"status":"done","priority":"low"}`.

Кнопка «Взять в работу» на карточке задачи `6` вызывает:

```javascript
await fetch('https://api.tracker.local/tasks/6', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'in_progress' }),
});
```

И отправляет такой запрос:

```http example
PATCH /tasks/6
Content-Type: application/json

{"status": "in_progress"}
```

Сервер вернул обновлённую задачу с новым статусом.

### Как прочитать fetch как HTTP-запрос

Каждая часть вызова `fetch` попадает в своё место запроса:

| В коде `fetch` | В запросе |
|---|---|
| первый аргумент `'https://api.tracker.local/tasks?...'` | адрес после метода |
| `method: 'POST'` (нет — значит `GET`) | первое слово строки запроса |
| `headers: { 'Content-Type': 'application/json' }` | строки заголовков `Content-Type: application/json` |
| `body: JSON.stringify({ title: 'Текст' })` | тело после пустой строки: `{"title": "Текст"}` |

Порядок ключей в JSON и пробелы не важны: `{"a": 1, "b": 2}` и `{"b":2,"a":1}` — одно и то же.

### Частые ошибки

- `body: { status: 'done' }` → `body: JSON.stringify({ status: 'done' })`. Без `JSON.stringify` браузер отправит строку `[object Object]`, и сервер ответит `422`.
- Нет заголовка `Content-Type` при отправке JSON → добавьте `headers: { 'Content-Type': 'application/json' }`.
- `const data = response.json();` без `await` → в `data` окажется обещание, а не данные: `const data = await response.json();`.
- Ждать, что `fetch` сам сообщит об ошибке `404` → проверяйте `response.ok` или `response.status`.

### Шпаргалка

- `const response = await fetch('адрес');` — `GET`.
- `await fetch('адрес', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(объект) });`
- `response.status` — код; `response.ok` — `true` для `2xx`; `await response.json()` — тело как объект.
- `await` — дождаться результата; работает внутри `async function`.
- `JSON.stringify({ key: 'value' })` → `{"key":"value"}`.

## task web-fetch-get

```json
{
  "type": "request",
  "title": "Что отправит страница проекта",
  "server": "tracker",
  "hints": [
    "Раздел «fetch: получить данные».",
    "Вызов без второго аргумента — это `GET`. Адрес и параметры переносятся из кавычек без изменений.",
    "`GET /tasks?project_id=…&status=…`"
  ]
}
```

Страница проекта «Мобильное приложение» загружает невыполненные задачи таким кодом:

```javascript
const response = await fetch('https://api.tracker.local/tasks?project_id=2&status=todo');
const tasks = await response.json();
```

Соберите в композере тот же запрос, который отправит браузер: метод, путь `/tasks` и оба параметра.

```http starter
GET /tasks?project_id=…&status=…
```

```http solution
GET /tasks?project_id=2&status=todo
```

## task web-fetch-post

```json
{
  "type": "request",
  "title": "Новая задача из формы",
  "server": "tracker",
  "hints": [
    "Разделы «Отправляем данные: method, headers, body» и «Как прочитать fetch как HTTP-запрос».",
    "Метод берётся из `method`, заголовок — из `headers`, а тело — это объект из `JSON.stringify`, записанный как JSON: ключи и строки в двойных кавычках.",
    "`POST /tasks`, заголовок `Content-Type: application/json`, тело `{\"project_id\": …, \"title\": \"…\", \"priority\": \"…\"}`"
  ],
  "check": { "headers": ["Content-Type"] }
}
```

Форма «Новая задача» отправляет на сервер такой код:

```javascript
const response = await fetch('https://api.tracker.local/tasks', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ project_id: 3, title: 'Отчёт по отпускам', priority: 'high' }),
});
```

Соберите в композере запрос, который отправит браузер: метод, путь, заголовок и тело в формате JSON. Отправьте его и посмотрите, что ответил сервер.

```http starter
POST /tasks
```

```http solution
POST /tasks
Content-Type: application/json

{"project_id": 3, "title": "Отчёт по отпускам", "priority": "high"}
```

## task web-fetch-ok

```json
{
  "type": "choice",
  "title": "Ответ 404 во fetch",
  "hints": [
    "Раздел «Читаем ответ: status, ok и json()».",
    "Подумайте: ответ от сервера пришёл или нет? Когда `fetch` выбрасывает ошибку?",
    "`fetch` выбрасывает ошибку, только когда ответа нет совсем. Ответ `404` пришёл — значит, `status` равен коду из ответа. А чему равен `ok` для кода вне `200`–`299`?"
  ],
  "options": [
    "`response.ok` равен `false`, `response.status` равен `404`",
    "`fetch` выбросит ошибку, и до проверки дело не дойдёт",
    "`response.ok` равен `true`, ведь ответ всё-таки пришёл",
    "`response.ok` равен `false`, а `response.status` равен `0`"
  ],
  "answer": [0],
  "explanation": "Ответ `404` — полноценный ответ сервера, поэтому `fetch` не выбрасывает ошибку: `response.status` равен `404`, а `response.ok` — `false`, потому что код не из диапазона `200`–`299`. Ошибку `fetch` выбрасывает только тогда, когда ответа нет вовсе: нет сети или браузер его заблокировал."
}
```

Карточка задачи загружается так:

```javascript
const response = await fetch('https://api.tracker.local/tasks/42');
```

Задачи `42` на сервере нет, и он ответил `404 Not Found`. Что окажется в `response`?

## task web-fetch-review

```json
{
  "type": "review",
  "title": "Почему сервер отвечает 422",
  "hints": [
    "Раздел «Частые ошибки».",
    "Сравните, как в этом коде задано тело запроса, с шаблоном из раздела «Отправляем данные: method, headers, body».",
    "Смотрите на строку 5, на значение `body`. Сверьте его с шаблоном, где объект перед отправкой проходит через `JSON.stringify`."
  ],
  "lines": [5],
  "options": [
    "Тело передано объектом без `JSON.stringify`, и браузер отправит строку `[object Object]`",
    "Для создания задачи нужен метод `GET`",
    "`await` перед `fetch` лишний: из-за него запрос не уходит",
    "Заголовок `Content-Type` лишний: именно он мешает серверу"
  ],
  "answer": [0],
  "explanation": "`body` должен быть строкой. Объект без `JSON.stringify` браузер превращает в текст `[object Object]` — это не JSON, и сервер отвечает `422`. Нужно `body: JSON.stringify({ project_id: 1, title: 'Новая задача' })`. Метод `POST` здесь верный, `await` нужен, чтобы дождаться ответа, а `Content-Type: application/json` сообщает серверу формат тела."
}
```

Кнопка «Создать задачу» не работает: сервер на каждый запрос отвечает `422`. Найдите ошибку в коде.

```javascript code
async function createTask() {
  const response = await fetch('https://api.tracker.local/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { project_id: 1, title: 'Новая задача' },
  });
  return await response.json();
}
```
