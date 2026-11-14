# FastAPI, ASGI и def против async def

Команда запускает сервис бронирования переговорных. Нужны адреса, по которым клиент получает список комнат и проверяет, что сервис жив. Писать разбор HTTP-запросов вручную незачем: для этого есть FastAPI. В этом уроке вы разберётесь, из чего он состоит, как приложение вызывается без настоящего сервера, и когда обработчик пишут через `def`, а когда через `async def`. Предполагается, что вы знаете основы Python: функции, словари, `import`. Всё остальное объясняется здесь.

### Кто есть кто: FastAPI, Starlette, Pydantic

Три библиотеки работают вместе, и полезно понимать, за что отвечает каждая.

- **Starlette** — основа. Она разбирает запрос, подбирает маршрут по пути и методу, собирает ответ, хранит middleware (обработчики вокруг запроса).
- **Pydantic** — проверка данных. Она превращает строку `"5"` в число `5` и отклоняет `"abc"`.
- **FastAPI** — связка. Он читает сигнатуру вашей функции (имена параметров и их типы), строит по ней проверку через Pydantic и описание API в формате OpenAPI.

Практический вывод: ошибки `404` и `405` приходят от Starlette, ошибки `422` — от проверки данных, а описание API вы получаете бесплатно.

### Сервер и ASGI

Приложение FastAPI само по себе не слушает сеть. Сеть слушает **сервер**, например `uvicorn`, а приложение он вызывает как функцию. Правила этого вызова называются **ASGI**.

Идея в двух словах: сервер вызывает приложение с тремя аргументами.

```python
async def app(scope, receive, send):
    ...
```

- `scope` — словарь с описанием запроса: метод, путь, заголовки;
- `receive` — функция, которой приложение получает тело запроса;
- `send` — функция, которой приложение отправляет ответ по частям (сначала код и заголовки, потом тело).

Объект `FastAPI()` как раз такая вызываемая штука. Поэтому его можно вызвать и без сети: сделать `scope`, подставить свои `receive` и `send`, а полученный ответ собрать в памяти.

Как это устроено в студии: настоящего сервера и сети здесь нет. Когда вы отправляете запрос, студия сама собирает `scope`, вызывает ваш `app` и показывает ответ. Тесты `TestClient` из следующих миров работают так же. Для вас разницы почти нет, но запомните: в студии нельзя «запустить сервер» и открыть адрес в браузере.

### Первое приложение и маршрут

Маршрут связывает метод и путь с функцией-обработчиком.

```python
from fastapi import FastAPI

app = FastAPI()


@app.get("/путь")
def обработчик():
    return {"ключ": "значение"}
```

- `FastAPI()` — создаёт приложение. Переменную обычно называют `app`: студия и сервер ищут именно её.
- `@app.get("/путь")` — **декоратор**: строка перед функцией, которая регистрирует её как обработчик запросов `GET` по указанному пути. Для других методов — `@app.post(...)`, `@app.put(...)`, `@app.delete(...)`.
- `def обработчик():` — обычная функция. Её имя в запросах не участвует.
- `return` — то, что вернёт функция, FastAPI превратит в JSON: словарь станет объектом, список — массивом. Код ответа по умолчанию `200`.

Пример. Сервис бронирования с двумя маршрутами; последние два запроса показывают поведение при неверном пути и неверном методе:

```python example
from fastapi import FastAPI

app = FastAPI(title="Booking")


@app.get("/")
def index():
    return {"service": "booking", "version": 1}


@app.get("/rooms")
def list_rooms():
    return [{"id": 1, "name": "Alpine"}, {"id": 2, "name": "Baikal"}]
###
GET /
###
GET /rooms
###
GET /nowhere
###
POST /rooms
```

Результат запросов:

- `GET /` отвечает `200` и `{"service": "booking", "version": 1}`;
- `GET /rooms` отвечает `200` и списком из двух комнат;
- `GET /nowhere` отвечает `404` и `{"detail": "Not Found"}`: такого пути нет;
- `POST /rooms` отвечает `405` и `{"detail": "Method Not Allowed"}`: путь есть, но только для `GET`.

Запомните различие между `404` и `405`: оно часто помогает найти ошибку в декораторе.

### Запуск: команды

Чтобы запустить приложение на своём компьютере, пользуются командами в терминале. В студии их выполнять не нужно, они приведены для справки и пишутся в файл `main.py`, где есть `app = FastAPI()`.

```sh
fastapi dev main.py
uvicorn main:app --reload
```

- `fastapi dev main.py` — команда FastAPI для разработки: запускает сервер и перезапускает его при каждой правке файла. Она появляется после установки пакета `fastapi[standard]`.
- `uvicorn main:app --reload` — то же через сам `uvicorn`. Запись `main:app` читается как «модуль `main`, в нём переменная `app`»: слева имя файла без `.py`, справа имя переменной.
- `--reload` — перезапуск при изменении кода. Только для разработки.

После запуска сервер пишет адрес вида `http://127.0.0.1:8000`, а страница `/docs` показывает описание API. В рабочем окружении вместо `dev` используют `fastapi run main.py` или `uvicorn main:app` без `--reload`.

### def или async def

Обработчик можно написать двумя способами:

```python
@app.get("/a")
def обычный():
    ...


@app.get("/b")
async def асинхронный():
    ...
```

Разница в том, как их запускает настоящий сервер.

- `def` — FastAPI отправляет такую функцию в **пул потоков**, то есть выполняет в отдельном потоке. Пока она долго ждёт, сервер обслуживает другие запросы.
- `async def` — функция работает в главном потоке сервера вместе со всеми остальными запросами. Она обязана часто «отдавать управление» с помощью `await`.

Отсюда главное правило. Внутри `async def` нельзя вызывать функции, которые долго блокируют поток: `time.sleep(...)`, обычный `requests.get(...)`, чтение большого файла. Пока такой вызов не закончится, не отвечает весь сервер, а не один запрос. Если нужно подождать, пишут `await` перед асинхронной операцией.

```python
import asyncio

from fastapi import FastAPI

app = FastAPI()


@app.get("/slow")
async def slow():
    await asyncio.sleep(2)
    return {"status": "done"}
```

- `import asyncio` — модуль асинхронности из стандартной библиотеки;
- `asyncio.sleep(2)` — асинхронная пауза в две секунды; другие запросы за это время обслуживаются;
- `await` — «подожди результат и отдай управление»; ставится перед вызовом асинхронной функции. Без `await` паузы не будет, а Python выдаст предупреждение `coroutine was never awaited`.

Как выбирать:

- обработчик работает с библиотекой, которая умеет `await` (асинхронный клиент `httpx.AsyncClient`, асинхронная база) — пишите `async def`;
- обработчик вызывает обычную блокирующую библиотеку (`requests`, обычный драйвер базы, тяжёлые вычисления) — пишите обычный `def`;
- обработчик просто возвращает данные из памяти — подойдёт любой вариант.

Честно о студии: здесь нет потоков, поэтому `def` выполняется на месте, в том же потоке, а `asyncio.sleep` проходит мгновенно (часы виртуальные). Блокировка сервера из-за `time.sleep` в `async def` в студии не заметна, и на настоящем сервере она будет. Поэтому ошибку ищет проверка кода: она разбирает файл и находит блокирующие вызовы внутри `async def`, не запуская его.

### Частые ошибки

- Блокирующий вызов в `async def`. Неверно: `async def f(): time.sleep(2)`. Верно: `async def f(): await asyncio.sleep(2)` или обычный `def f(): time.sleep(2)`. Первый вариант на настоящем сервере остановит все запросы.
- Забытый `await`. Неверно: `asyncio.sleep(2)` без `await`: пауза не происходит. Верно: `await asyncio.sleep(2)`.
- Путь без начальной косой черты. Неверно: `@app.get("rooms")`. Верно: `@app.get("/rooms")`.
- Неверная запись запуска. Неверно: `uvicorn main.py:app`. Верно: `uvicorn main:app`: имя модуля пишется без `.py`.

### Шпаргалка

- Starlette — маршруты и ответы, Pydantic — проверка данных, FastAPI — связка и OpenAPI.
- Сервер (`uvicorn`) слушает сеть и вызывает приложение по правилам ASGI; студия вызывает `app` сама, без сети.
- `app = FastAPI()`; `@app.get("/путь")` над функцией; возвращаемые словари и списки становятся JSON.
- Неизвестный путь даёт `404`, неверный метод — `405`.
- `fastapi dev main.py`, `uvicorn main:app --reload` — запуск для разработки; в студии не нужны.
- `def` — отдельный поток на настоящем сервере; `async def` — общий поток, внутри только `await`.
- В `async def`: `await asyncio.sleep(...)`, не `time.sleep(...)`.

## task fa-tracker-hello

```json
{
  "type": "fastapi",
  "title": "Первые маршруты трекера",
  "xp": 10,
  "hints": [
    "Раздел «Первое приложение и маршрут»: декоратор `@app.get(...)` с путём и функция под ним, возвращающая словарь или список.",
    "Нужны три маршрута `GET`: `/`, `/health` и `/tasks`. Первые два возвращают словари, третий — список из двух словарей.",
    "Шаблон: `@app.get(\"/путь\")`, ниже `def имя():` и `return …`. Ключи словарей и значения возьмите из условия."
  ],
  "wrong": {
    "wrong-key": "в ответе корневого маршрута ключ называется не `service`",
    "post-health": "маршрут `/health` объявлен для `POST`, а запрос `GET /health` получает `405`"
  }
}
```

Вы пишете небольшой трекер задач. Приложение должно отвечать на три запроса `GET`:

- `/` отвечает `200` и `{"service": "tracker", "version": 1}`;
- `/health` отвечает `200` и `{"status": "ok"}`;
- `/tasks` отвечает `200` и списком из двух задач: `{"id": 1, "title": "Write spec", "done": false}` и `{"id": 2, "title": "Review pull request", "done": true}`.

Остальные пути должны отвечать `404`, это делает FastAPI сам.

```python starter
from fastapi import FastAPI

app = FastAPI()


@app.get("…")
def index():
    return {"…": "tracker", "version": 1}


@app.get("…")
def health():
    return {"status": "…"}


@app.get("…")
def list_tasks():
    return […]
```

```python solution
from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def index():
    return {"service": "tracker", "version": 1}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/tasks")
def list_tasks():
    return [
        {"id": 1, "title": "Write spec", "done": False},
        {"id": 2, "title": "Review pull request", "done": True},
    ]
```

```python wrong id=wrong-key
from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def index():
    return {"name": "tracker", "version": 1}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/tasks")
def list_tasks():
    return [
        {"id": 1, "title": "Write spec", "done": False},
        {"id": 2, "title": "Review pull request", "done": True},
    ]
```

```python wrong id=post-health
from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def index():
    return {"service": "tracker", "version": 1}


@app.post("/health")
def health():
    return {"status": "ok"}


@app.get("/tasks")
def list_tasks():
    return [
        {"id": 1, "title": "Write spec", "done": False},
        {"id": 2, "title": "Review pull request", "done": True},
    ]
```

```http tests
GET /
###
GET /health
###
GET /tasks
###
GET /missing
```

## task fa-which-blocks

```json
{
  "type": "choice",
  "title": "Какой обработчик остановит сервер",
  "hints": [
    "Раздел «def или async def».",
    "Обычный `def` настоящий сервер запускает в отдельном потоке, а `async def` работает в общем потоке сервера.",
    "Остановить других может только вызов, который блокирует общий поток. Посмотрите, какая из трёх функций выполняется в общем потоке и при этом вызывает `time.sleep`, а не `await asyncio.sleep`."
  ],
  "options": [
    "Первый: `async def` с `time.sleep(3)`",
    "Второй: `def` с `time.sleep(3)`",
    "Третий: `async def` с `await asyncio.sleep(3)`",
    "Ни один, пауза в три секунды всегда безопасна"
  ],
  "answer": [0],
  "explanation": "Первый обработчик выполняется в общем потоке сервера и блокирует его на три секунды: все другие запросы ждут. Второй обработчик — обычный `def`, сервер запускает его в отдельном потоке, и блокируется только он. Третий отдаёт управление на время паузы через `await`, поэтому сервер продолжает работать. Утверждение, что пауза безопасна всегда, неверно: всё зависит от того, где она вызвана."
}
```

На настоящем сервере работают три обработчика одного приложения:

```python
@app.get("/one")
async def one():
    time.sleep(3)
    return {"ok": True}


@app.get("/two")
def two():
    time.sleep(3)
    return {"ok": True}


@app.get("/three")
async def three():
    await asyncio.sleep(3)
    return {"ok": True}
```

Какой из них на три секунды остановит обработку всех остальных запросов?

## task fa-no-blocking

```json
{
  "type": "static",
  "title": "Экспорт без остановки сервера",
  "xp": 10,
  "hints": [
    "Раздел «def или async def»: в `async def` нельзя вызывать `time.sleep` и `requests.get`.",
    "Замените блокирующую паузу на `await asyncio.sleep(...)` и добавьте `import asyncio`. Пауза в обработчике должна остаться.",
    "Шаблон: `import asyncio`, затем `async def export_tasks():`, внутри `await asyncio.sleep(1)` и `return {…}`."
  ],
  "check": {
    "static": [
      { "rule": "no-blocking-in-async", "message": "В async def нельзя вызывать блокирующие функции вроде time.sleep или requests.get: они остановят весь сервер." }
    ],
    "code": [
      { "pattern": "sleep\\(", "message": "Пауза «подготовки выгрузки» должна остаться: замените способ ожидания, а не удаляйте его." }
    ]
  },
  "wrong": {
    "from-import": "блокирующий `sleep`, импортированный из `time`, внутри `async def`",
    "requests-call": "блокирующий `requests.get` внутри `async def`, хотя пауза сделана через `await`"
  }
}
```

Обработчик `GET /export` «готовит выгрузку задач» одну секунду. Сейчас он написан через `async def` и ждёт блокирующим `time.sleep`, поэтому на настоящем сервере остановит все запросы. Исправьте код так, чтобы обработчик не блокировал сервер, а пауза осталась. Проверка разбирает код, не запуская его.

```python starter
import time

from fastapi import FastAPI

app = FastAPI()


@app.get("/export")
async def export_tasks():
    time.sleep(1)
    return {"status": "ready", "count": 2}
```

```python solution
import asyncio

from fastapi import FastAPI

app = FastAPI()


@app.get("/export")
async def export_tasks():
    await asyncio.sleep(1)
    return {"status": "ready", "count": 2}
```

```python wrong id=from-import
from time import sleep

from fastapi import FastAPI

app = FastAPI()


@app.get("/export")
async def export_tasks():
    sleep(1)
    return {"status": "ready", "count": 2}
```

```python wrong id=requests-call
import asyncio

import requests
from fastapi import FastAPI

app = FastAPI()


@app.get("/export")
async def export_tasks():
    requests.get("http://localhost:9000/slow")
    await asyncio.sleep(1)
    return {"status": "ready", "count": 2}
```

## task fa-uvicorn-command

```json
{
  "type": "choice",
  "title": "Команда запуска",
  "hints": [
    "Раздел «Запуск: команды».",
    "Адрес приложения пишется как `модуль:переменная`. Модуль — это имя файла без расширения.",
    "Файл называется `tracker.py`, значит, модуль — `tracker`. Переменная с приложением называется `app`, а перезапуск при правках включает флаг `--reload`."
  ],
  "options": [
    "`uvicorn tracker.py:app --reload`",
    "`uvicorn tracker:app --reload`",
    "`uvicorn app:tracker --reload`",
    "`fastapi run tracker`"
  ],
  "answer": [1],
  "explanation": "Запись `tracker:app` читается как «модуль `tracker`, переменная `app`»: расширение `.py` не пишется, поэтому первый вариант неверен. В третьем варианте модуль и переменная перепутаны местами. Команда `fastapi run` запускает приложение для рабочего окружения и перезапуска при правках не включает."
}
```

В файле `tracker.py` лежит приложение: `app = FastAPI()`. Вы разрабатываете его на своём компьютере и хотите, чтобы сервер перезапускался при каждой правке файла. Какая команда подойдёт?
