# Ошибки и логирование

Трекер задач работает, пока пользователи делают то, что ждёт разработчик. Потом кто-то закрывает задачу дважды, просит задачу, которой нет, а ночью база перестаёт отвечать. Каждой ситуации нужен свой ответ клиенту и своя запись для разработчика. Клиенту достаточно кода и короткого понятного текста. Подробности (что именно сломалось и где) нужны вам, и их пишут в журнал. В этом уроке вы настроите оба канала и проверите их тестами.

### Два вида ошибок

- **Ожидаемые ошибки** — часть бизнес-правил: задачи нет (`404`), задача уже закрыта (`409`), данные неверны (`422`). Это не поломка. Клиент получает точный код и сообщение, а в журнал идёт одна строка уровня `WARNING` или `INFO`.
- **Неожиданные ошибки** — баг или сбой: `KeyError`, недоступная база, деление на ноль. Клиент получает `500` и общий текст без подробностей, а в журнал идёт полная запись с трассировкой (`traceback`).

Подробности `500` клиенту не показывают: в тексте исключения бывают адреса серверов, имена таблиц, куски запросов с паролями. Всё это помогает злоумышленнику. Клиенту хватает слов «Internal server error»: детали вы прочитаете в журнале.

### Исключения домена

Правила предметной области (**домен**) выражают собственными исключениями. Функция бизнес-логики не знает про HTTP: она бросает `TaskClosed`, а код ответа выбирается отдельно. Тогда те же функции можно вызвать из скрипта или из другой части приложения.

```python
# errors.py
class DomainError(Exception):
    status_code = 400
    code = "domain_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class ИмяОшибки(DomainError):
    status_code = 404
    code = "имя_ошибки"
```

- `class DomainError(Exception)` — общий родитель всех ошибок домена. Свои исключения всегда наследуют `Exception` (или его наследника).
- `status_code` и `code` — **атрибуты класса**: у каждой ошибки они свои. `status_code` — код ответа, `code` — короткое машинное имя для клиента.
- `__init__` принимает текст сообщения и сохраняет его в `self.message`; `super().__init__(message)` передаёт текст самому исключению.
- Наследники переопределяют только то, что у них отличается.

В бизнес-логике исключение бросают оператором `raise`:

```python
def get_task(task_id: int) -> dict:
    task = TASKS.get(task_id)
    if task is None:
        raise TaskNotFound(f"Task {task_id} not found")
    return task
```

Здесь нет ни `HTTPException`, ни кода `404`. Это и есть разделение: слой логики говорит «что случилось», слой HTTP решает «что ответить».

### Один обработчик на всю иерархию

Функция-обработчик регистрируется декоратором `@app.exception_handler(Класс)`: если из обработчика маршрута вылетело исключение этого класса, FastAPI вызовет её и отправит клиенту то, что она вернёт.

```python
@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError):
    logger.warning("domain error %s: %s", exc.code, exc.message)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.code, "message": exc.message},
    )
```

- `Request` (из `fastapi`) и `JSONResponse` (из `fastapi.responses`) вам знакомы по прошлым мирам.
- Обработчик, зарегистрированный на базовый класс, срабатывает и для **всех его наследников**: `TaskNotFound`, `TaskClosed` и любая будущая ошибка домена обслуживаются одной функцией. Для нового вида ошибки достаточно объявить класс с нужными `status_code` и `code`.
- `exc.status_code`, `exc.code`, `exc.message` — атрибуты пойманного исключения.
- `content={"error": ..., "message": ...}` — единый формат тела: клиент всегда ищет ключи `error` и `message`.

Для неожиданных ошибок регистрируют обработчик самого общего класса `Exception`:

```python
@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "message": "Internal server error"},
    )
```

- `Exception` — родитель почти всех исключений, поэтому сюда попадает всё, что не поймали более точные обработчики. Точный обработчик (на `DomainError`) всегда побеждает общий.
- `logger.exception(...)` пишет сообщение уровня `ERROR` **вместе с трассировкой** — разработчик увидит файл, строку и текст исходной ошибки. Метод вызывают внутри обработки исключения; обработчик `Exception` как раз выполняется в таком контексте.
- Клиент получает фиксированный текст без подробностей.

Что обработчик `Exception` не делает: он не «лечит» ошибку, а только оформляет ответ и запись в журнал. Причину исправляют в коде.

### logging: журнал приложения

Для записей используют стандартный модуль `logging`, а не `print`: у записей есть уровень, имя источника и формат, и их можно включать и отключать без правки кода.

```python
import logging

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("tracker")

logger.info("task %s completed", task_id)
```

- `logging.basicConfig(...)` — настройка один раз при запуске приложения. Вызывается в главном модуле, до первого сообщения.
- `level=logging.INFO` — показывать записи уровня `INFO` и серьёзнее. Всё, что ниже, отбрасывается.
- `format="%(levelname)s %(name)s: %(message)s"` — вид строки: уровень, имя логгера, текст. Результат: `INFO tracker: task 5 completed`.
- `logging.getLogger("tracker")` — получить логгер по имени. Один и тот же логгер можно получить в разных файлах по одному имени; обычно имя — название приложения или модуля.
- `logger.info(текст, значение)` — записать сообщение. Значения подставляются в `%s`, `%d`.

Уровни от самого мелкого к самому важному:

- `DEBUG` — подробности для разработки (значения переменных, шаги алгоритма);
- `INFO` — обычные события: «задача закрыта», «пользователь вошёл»;
- `WARNING` — что-то необычное, но приложение справилось: ошибка клиента, повторная попытка;
- `ERROR` — операция не удалась; нужно разобраться;
- `CRITICAL` — приложение не может работать.

Методы называются так же: `logger.debug`, `logger.info`, `logger.warning`, `logger.error`, `logger.critical`, плюс `logger.exception` (это `error` с трассировкой).

**Значения передают отдельно, а не через f-строку.** Неверно: `logger.info(f"task {task_id} completed")`. Верно: `logger.info("task %s completed", task_id)`. Логгер подставляет значения только если запись реально пишется; для отброшенных записей (например, `DEBUG` при уровне `INFO`) он не тратит время на сборку строки. Кроме того, шаблон остаётся постоянным, и однотипные записи легко искать и группировать.

### Что писать в журнал и чего нет

В журнал пишут то, что помогает разобраться: **что** произошло, **с чем** (идентификаторы), **чем закончилось**. Примеры: номер задачи, имя пользователя, код ошибки, длительность.

Никогда не пишите:

- пароли, токены, ключи API, содержимое заголовка `Authorization`;
- номера банковских карт, коды из SMS;
- тело запроса целиком (в нём бывают любые личные данные);
- текст исключения в ответ клиенту (мы уже решили: его место в журнале).

Журнал читают многие: сопровождающие, системы сбора, иногда сторонние сервисы. Утекший пароль из журнала считается утечкой так же, как из базы. Если нужно записать, кто вошёл, пишут имя пользователя, а не его пароль.

Выбор уровня: ошибка клиента (`404`, `409`) — `INFO` или `WARNING`; сбой на нашей стороне — `ERROR`. Если писать `ERROR` на каждый «не найдено», настоящие сбои потеряются в шуме.

### Вкладка «Лог» в студии

В студии всё, что приложение вывело во время запроса (`print`, `logging`), собирается во вкладку **«Лог»**. Рядом студия добавляет свои строки: по строке на каждый запрос. Если в приложении вызван `logging.basicConfig(level=logging.INFO, ...)`, записи уровня `INFO` и выше видны с вашим форматом, `DEBUG` скрыт. Исключение с трассировкой тоже попадает туда.

Так вы проверяете журнал, не запуская сервер: отправьте запрос во вкладке «Запрос» и прочитайте «Лог». На своём компьютере то же самое выводит терминал, где запущен `fastapi dev`; сервер `uvicorn` дополнительно пишет строки доступа вида `INFO: 127.0.0.1:52000 - "GET /tasks/1 HTTP/1.1" 200 OK`, а его уровень задаёт ключ `--log-level`. В студии строку `INFO` по каждому запросу записывает сама студия: сервера uvicorn здесь нет.

Примечание о студии: файлов и сетевых сборщиков журналов здесь нет, поэтому все записи идут в текстовый вывод. В боевых проектах журнал отправляют в системы сбора (об этом в мире 8), а формат часто делают структурным (JSON).

Пример: бронирование комнат. Бизнес-правила бросают исключения домена, один обработчик отвечает клиенту, а каждая запись идёт в журнал.

```python example
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("booking")
app = FastAPI()
ROOMS = {1: {"name": "Blue", "booked": False}, 2: {"name": "Green", "booked": False}}


class DomainError(Exception):
    status_code = 400
    code = "domain_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class RoomNotFound(DomainError):
    status_code = 404
    code = "room_not_found"


class RoomBusy(DomainError):
    status_code = 409
    code = "room_busy"


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError):
    logger.warning("domain error %s: %s", exc.code, exc.message)
    return JSONResponse(status_code=exc.status_code, content={"error": exc.code, "message": exc.message})


@app.post("/rooms/{room_id}/book")
def book_room(room_id: int):
    room = ROOMS.get(room_id)
    if room is None:
        raise RoomNotFound(f"Room {room_id} not found")
    if room["booked"]:
        raise RoomBusy(f"Room {room['name']} is busy")
    room["booked"] = True
    logger.info("room %s booked", room_id)
    return {"id": room_id, "name": room["name"], "booked": True}
###
POST /rooms/1/book
###
POST /rooms/1/book
###
POST /rooms/9/book
```

Результат по запросам:

- первый запрос: `200` и `{"id": 1, "name": "Blue", "booked": true}`; в «Логе» строка `INFO booking: room 1 booked`;
- второй: `409` и `{"error": "room_busy", "message": "Room Blue is busy"}`; в «Логе» `WARNING booking: domain error room_busy: Room Blue is busy`;
- третий: `404` и `{"error": "room_not_found", "message": "Room 9 not found"}`; запись `WARNING` с кодом `room_not_found`.

Бизнес-функция не знает про коды ответа, а клиент получает единый формат для любой ошибки домена.

### Тест: ошибка даёт правильный код

Ошибки проверяют так же, как успешные ответы: отправляют запрос и сверяют код и тело. Для журнала и для `500` нужны два приёма.

**`raise_server_exceptions=False`.** По умолчанию `TestClient` пробрасывает исключение приложения прямо в тест: тест упадёт с исходным исключением, даже если обработчик `Exception` вернул аккуратный ответ `500` (Starlette после отправки ответа поднимает ошибку снова, чтобы её увидел сервер). Чтобы проверить сам ответ, клиент создают так:

```python
@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)
```

- `raise_server_exceptions=False` — не пробрасывать необработанные исключения, а вернуть ответ, который увидел бы настоящий клиент.

**Фикстура `caplog`.** Её предоставляет сам pytest: она собирает записи журнала, написанные во время теста.

```python
def test_complete_is_logged(client, caplog):
    caplog.set_level("INFO")
    task_id = client.post("/tasks", json={"title": "Report"}).json()["id"]
    client.post(f"/tasks/{task_id}/complete")
    assert f"task {task_id} completed" in caplog.text
```

- `caplog` — просто называется в параметрах теста, как любая фикстура.
- `caplog.set_level("INFO")` — собирать записи от уровня `INFO`. Записи собираются начиная с эффективного уровня логгера (по умолчанию корневой логгер пропускает только `WARNING` и выше, но если приложение вызвало `basicConfig(level=INFO)`, `INFO` дойдёт и без вызова); `set_level` делает уровень явным.
- `caplog.text` — все собранные записи одной строкой: удобно проверять `in`.
- `caplog.records` — список записей; у каждой есть `levelname` (`"WARNING"`) и метод `getMessage()` (готовый текст). Так проверяют уровень: `[r for r in caplog.records if r.levelname == "WARNING"]`.
- Кроме ваших записей, в `caplog` попадают записи библиотек (например, `httpx` пишет строку на каждый запрос). Если нужно отделить свои, смотрите `record.name`; проверка `in caplog.text` обычно достаточна.

Что проверять в тестах ошибок:

1. Код ответа и тело `{"error": ..., "message": ...}` для каждой ошибки домена.
2. Для `500` — общий текст и **отсутствие** секрета из исключения в `response.text`.
3. Что запись в журнале появилась и имеет нужный уровень.

### Частые ошибки

- Пароль в журнале. Неверно: `logger.info("login %s %s", username, password)`. Верно: `logger.info("login %s", username)`.
- f-строка в логгере. Неверно: `logger.warning(f"failed for {user}")`. Верно: `logger.warning("failed for %s", user)`.
- `print` вместо логгера. Неверно: `print("task done")`. Верно: `logger.info("task %s done", task_id)`: у записи есть уровень и имя.
- Текст исключения клиенту. Неверно: `except Exception as exc: return {"error": str(exc)}`. Верно: обработчик `Exception`, который пишет `logger.exception(...)` и отвечает общим текстом.
- Проверка `500` без `raise_server_exceptions=False`. Неверно: `TestClient(app)` и `client.get("/report")` — тест упадёт с исходным исключением. Верно: `TestClient(app, raise_server_exceptions=False)`.
- `HTTPException` в бизнес-логике. Неверно: `raise HTTPException(404, ...)` внутри `service.py`. Верно: `raise TaskNotFound(...)`, а код ответа — в обработчике.

### Шпаргалка

- Ошибки клиента: код `4xx` и сообщение; сбои: `500`, общий текст, детали в журнале.
- Исключения домена: `class DomainError(Exception)` с `status_code`, `code`, `message`; наследники.
- `@app.exception_handler(DomainError)` — один обработчик на всю иерархию; `@app.exception_handler(Exception)` — для неожиданных ошибок.
- `logging.basicConfig(level=logging.INFO, format="...")`; `logger = logging.getLogger("имя")`.
- Уровни: `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`; `logger.exception(...)` — `ERROR` с трассировкой.
- Значения: `logger.info("task %s", task_id)`, не f-строка.
- Не писать в журнал пароли, токены, ключи, тело запроса.
- Вкладка «Лог» показывает `print` и записи `logging` во время запроса.
- Тест `500`: `TestClient(app, raise_server_exceptions=False)`.
- Тест журнала: `caplog.set_level("INFO")`, `caplog.text`, `caplog.records`.

## task fa-errors-refactor
```json
{
  "type": "refactor",
  "title": "Исключения домена вместо HTTPException",
  "xp": 15,
  "hints": [
    "Разделы «Исключения домена» и «Один обработчик на всю иерархию»: бизнес-логика бросает свои исключения, а код ответа выбирает обработчик.",
    "В errors.py объявите DomainError с status_code и message и наследников TaskNotFound (404) и TaskClosed (409). В service.py замените raise HTTPException(...) на raise TaskNotFound(...) и raise TaskClosed(...); в main.py зарегистрируйте обработчик DomainError.",
    "Шаблон: class DomainError(Exception): status_code = 400; def __init__(self, message): super().__init__(message); self.message = message; в main.py: @app.exception_handler(DomainError) async def handler(request: Request, exc: DomainError): return JSONResponse(status_code=exc.status_code, content={\"detail\": exc.message})."
  ],
  "readonly": ["schemas.py"],
  "check": {
    "static": [
      { "rule": "uses", "name": "DomainError", "file": "errors.py", "message": "В errors.py нужен общий класс DomainError." },
      { "rule": "uses", "name": "exception_handler", "file": "main.py", "message": "Зарегистрируйте обработчик через @app.exception_handler в main.py." },
      { "rule": "pattern", "regex": "HTTPException", "forbid": true, "message": "HTTPException больше не нужен: бизнес-логика бросает исключения домена, а ответ собирает обработчик." }
    ]
  },
  "wrong": {
    "http-stays": "бизнес-логика по-прежнему бросает HTTPException: слой логики знает про HTTP",
    "one-status": "обработчик отвечает одним и тем же кодом на все ошибки домена вместо кода из исключения"
  }
}
```
В проекте трекера бизнес-логика из `service.py` бросает `HTTPException` с кодами `404` и `409`: слой логики знает про HTTP. Перенесите это знание в обработчик.

Нужно:

- в `errors.py`: базовый `DomainError(Exception)` с атрибутом класса `status_code`, сообщением `message` (параметр `__init__`), и наследники `TaskNotFound` (`404`) и `TaskClosed` (`409`);
- в `service.py`: бросать `TaskNotFound` и `TaskClosed` с теми же текстами сообщений;
- в `main.py`: один обработчик `DomainError`, который отвечает кодом из `exc.status_code` и телом `{"detail": сообщение}`.

Формат ответов не меняется: клиент увидит то же, что и раньше (`{"detail": "Task 9 not found"}` с кодом `404`). Идея проверки: запросы уходят в эталон и в ваш проект, ответы сравниваются; затем проверка читает код: нужны `DomainError`, `exception_handler` и ни одного упоминания `HTTPException`.

```python starter path=schemas.py
from pydantic import BaseModel, Field


class TaskIn(BaseModel):
    title: str = Field(min_length=1)
```

```python starter path=errors.py
# Здесь нужны DomainError, TaskNotFound и TaskClosed.
```

```python starter path=service.py
from fastapi import HTTPException

TASKS = {
    1: {"id": 1, "title": "Write report", "done": False},
    2: {"id": 2, "title": "Review plan", "done": True},
}


def create_task(title: str) -> dict:
    task = {"id": max(TASKS) + 1, "title": title, "done": False}
    TASKS[task["id"]] = task
    return task


def get_task(task_id: int) -> dict:
    task = TASKS.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return task


def complete_task(task_id: int) -> dict:
    task = get_task(task_id)
    if task["done"]:
        raise HTTPException(status_code=409, detail=f"Task {task_id} is already done")
    task["done"] = True
    return task
```

```python starter path=main.py
from fastapi import FastAPI

import service
from schemas import TaskIn

app = FastAPI(title="Tracker")


@app.post("/tasks", status_code=201)
def create(data: TaskIn):
    return service.create_task(data.title)


@app.get("/tasks/{task_id}")
def read(task_id: int):
    return service.get_task(task_id)


@app.post("/tasks/{task_id}/complete")
def complete(task_id: int):
    return service.complete_task(task_id)
```

```python solution path=schemas.py
from pydantic import BaseModel, Field


class TaskIn(BaseModel):
    title: str = Field(min_length=1)
```

```python solution path=errors.py
class DomainError(Exception):
    status_code = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class TaskNotFound(DomainError):
    status_code = 404


class TaskClosed(DomainError):
    status_code = 409
```

```python solution path=service.py
from errors import TaskClosed, TaskNotFound

TASKS = {
    1: {"id": 1, "title": "Write report", "done": False},
    2: {"id": 2, "title": "Review plan", "done": True},
}


def create_task(title: str) -> dict:
    task = {"id": max(TASKS) + 1, "title": title, "done": False}
    TASKS[task["id"]] = task
    return task


def get_task(task_id: int) -> dict:
    task = TASKS.get(task_id)
    if task is None:
        raise TaskNotFound(f"Task {task_id} not found")
    return task


def complete_task(task_id: int) -> dict:
    task = get_task(task_id)
    if task["done"]:
        raise TaskClosed(f"Task {task_id} is already done")
    task["done"] = True
    return task
```

```python solution path=main.py
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

import service
from errors import DomainError
from schemas import TaskIn

app = FastAPI(title="Tracker")


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.post("/tasks", status_code=201)
def create(data: TaskIn):
    return service.create_task(data.title)


@app.get("/tasks/{task_id}")
def read(task_id: int):
    return service.get_task(task_id)


@app.post("/tasks/{task_id}/complete")
def complete(task_id: int):
    return service.complete_task(task_id)
```

```python wrong id=http-stays path=service.py
from fastapi import HTTPException

TASKS = {
    1: {"id": 1, "title": "Write report", "done": False},
    2: {"id": 2, "title": "Review plan", "done": True},
}


def create_task(title: str) -> dict:
    task = {"id": max(TASKS) + 1, "title": title, "done": False}
    TASKS[task["id"]] = task
    return task


def get_task(task_id: int) -> dict:
    task = TASKS.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return task


def complete_task(task_id: int) -> dict:
    task = get_task(task_id)
    if task["done"]:
        raise HTTPException(status_code=409, detail=f"Task {task_id} is already done")
    task["done"] = True
    return task
```

```python wrong id=one-status path=main.py
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

import service
from errors import DomainError
from schemas import TaskIn

app = FastAPI(title="Tracker")


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError):
    return JSONResponse(status_code=404, content={"detail": exc.message})


@app.post("/tasks", status_code=201)
def create(data: TaskIn):
    return service.create_task(data.title)


@app.get("/tasks/{task_id}")
def read(task_id: int):
    return service.get_task(task_id)


@app.post("/tasks/{task_id}/complete")
def complete(task_id: int):
    return service.complete_task(task_id)
```

```http tests
GET /tasks/1
###
GET /tasks/9
###
POST /tasks/1/complete
###
POST /tasks/1/complete
###
POST /tasks/2/complete
###
POST /tasks
Content-Type: application/json

{"title": "Plan sprint"}
###
GET /tasks/3
###
POST /tasks
Content-Type: application/json

{"title": ""}
```

## task fa-logging-static
```json
{
  "type": "static",
  "title": "Журнал входа без паролей",
  "xp": 15,
  "hints": [
    "Разделы «logging: журнал приложения» и «Что писать в журнал и чего нет»: логгер получают через getLogger, значения передают отдельно от текста.",
    "Нужно: import logging, logging.basicConfig(...), logger = logging.getLogger(...), все print заменить вызовами logger, пароль в журнал не передавать, неудачный вход писать через logger.warning, без f-строк в логгере.",
    "Шаблон: import logging; logging.basicConfig(level=logging.INFO, format=\"%(levelname)s %(name)s: %(message)s\"); logger = logging.getLogger(\"auth\"); logger.info(\"login attempt for %s\", data.username); logger.warning(\"login failed for %s\", data.username)."
  ],
  "check": {
    "static": [
      { "rule": "imports", "module": "logging", "message": "Подключите модуль logging." },
      { "rule": "pattern", "regex": "logging\\.getLogger\\(", "message": "Получите логгер: logger = logging.getLogger(\"имя\")." },
      { "rule": "pattern", "regex": "\\bprint\\(", "forbid": true, "message": "Уберите print: используйте logger с уровнем." },
      { "rule": "pattern", "regex": "logger\\.\\w+\\([^\\n]*data\\.password", "forbid": true, "message": "Пароль нельзя передавать в журнал: оставьте в записи только имя пользователя." },
      { "rule": "pattern", "regex": "logger\\.\\w+\\(f[\"']", "forbid": true, "message": "Не используйте f-строки в логгере: передавайте значения отдельно (\"...%s\", значение)." },
      { "rule": "pattern", "regex": "logger\\.warning\\(", "message": "Неудачный вход записывайте уровнем WARNING." }
    ]
  },
  "wrong": {
    "password-logged": "логгер подключён, но пароль по-прежнему попадает в запись журнала",
    "fstring": "значения подставлены f-строкой, а не переданы отдельным аргументом логгера"
  }
}
```
Обработчик входа пишет события через `print`, и в запись попадает пароль пользователя. Исправьте код:

- подключите `logging`, настройте `basicConfig` с уровнем `INFO` и получите логгер `logger = logging.getLogger("auth")`;
- замените все `print` вызовами логгера: попытку входа и успешный вход пишите уровнем `INFO`, неудачный — `WARNING` (`logger.warning`);
- значения передавайте отдельными аргументами с `%s`, не через f-строку;
- пароль (`data.password`) в журнал не передавайте: только имя пользователя.

Проверка разбирает код, не запуская его.

```python starter
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()
USERS = {"anna": "tiger-9", "boris": "lion-4"}


class LoginIn(BaseModel):
    username: str
    password: str


def check_password(username: str, password: str) -> bool:
    # учебная проверка; настоящие пароли хранят хешами (мир 5)
    return USERS.get(username) == password


@app.post("/login")
def login(data: LoginIn):
    print(f"login attempt {data.username} {data.password}")
    if not check_password(data.username, data.password):
        print(f"login failed for {data.username}")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    print(f"login ok for {data.username}")
    return {"ok": True}
```

```python solution
import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("auth")
app = FastAPI()
USERS = {"anna": "tiger-9", "boris": "lion-4"}


class LoginIn(BaseModel):
    username: str
    password: str


def check_password(username: str, password: str) -> bool:
    # учебная проверка; настоящие пароли хранят хешами (мир 5)
    return USERS.get(username) == password


@app.post("/login")
def login(data: LoginIn):
    logger.info("login attempt for %s", data.username)
    if not check_password(data.username, data.password):
        logger.warning("login failed for %s", data.username)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    logger.info("login ok for %s", data.username)
    return {"ok": True}
```

```python wrong id=password-logged
import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("auth")
app = FastAPI()
USERS = {"anna": "tiger-9", "boris": "lion-4"}


class LoginIn(BaseModel):
    username: str
    password: str


def check_password(username: str, password: str) -> bool:
    return USERS.get(username) == password


@app.post("/login")
def login(data: LoginIn):
    logger.info("login attempt for %s with %s", data.username, data.password)
    if not check_password(data.username, data.password):
        logger.warning("login failed for %s", data.username)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    logger.info("login ok for %s", data.username)
    return {"ok": True}
```

```python wrong id=fstring
import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("auth")
app = FastAPI()
USERS = {"anna": "tiger-9", "boris": "lion-4"}


class LoginIn(BaseModel):
    username: str
    password: str


def check_password(username: str, password: str) -> bool:
    return USERS.get(username) == password


@app.post("/login")
def login(data: LoginIn):
    logger.info(f"login attempt for {data.username}")
    if not check_password(data.username, data.password):
        logger.warning(f"login failed for {data.username}")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    logger.info(f"login ok for {data.username}")
    return {"ok": True}
```

## task fa-errors-pytest
```json
{
  "type": "pytest",
  "title": "Тесты ошибок и журнала трекера",
  "xp": 20,
  "hints": [
    "Раздел «Тест: ошибка даёт правильный код»: клиент без проброса исключений уже создан в tests/conftest.py, а запись журнала проверяет фикстура caplog.",
    "Нужны тесты: создание (201), задача не найдена (404 с error и message), закрытие и повторное закрытие (409), запись о закрытии в журнале (INFO), запись WARNING об ошибке домена, ответ 500 на GET /report без секрета из текста исключения.",
    "Шаблон: def test_имя(client, caplog): caplog.set_level(\"INFO\"); response = client.get(...); assert response.status_code == ...; assert response.json() == {\"error\": ..., \"message\": ...}; assert \"текст записи\" in caplog.text."
  ],
  "readonly": ["main.py", "errors.py", "service.py", "tests/conftest.py"],
  "check": { "minTests": 6 },
  "mutants": {
    "no-closed": "повторное закрытие задачи принимается и отвечает 200 вместо 409",
    "leaks-error": "ответ 500 содержит текст внутреннего исключения с секретом",
    "silent-complete": "закрытие задачи не пишется в журнал",
    "no-warning": "ошибки домена не пишутся в журнал"
  },
  "wrong": {
    "codes-only": "тесты проверяют только коды ответов: утечка текста в 500 и пропавшие записи журнала остаются незамеченными",
    "no-log-checks": "тесты не смотрят в журнал: пропавшие записи остаются незамеченными"
  }
}
```
Трекер задач готов, в нём всё из урока. Напишите `tests/test_errors.py`. Файлы приложения и `tests/conftest.py` закрыты для правки: в `conftest.py` фикстура `client` создана с `raise_server_exceptions=False`.

Приложение работает так:

- `POST /tasks` с телом `{"title": "..."}` создаёт задачу и отвечает `201` и `{"id", "title", "done": false}`;
- `GET /tasks/{id}` — задача или `404` с `{"error": "task_not_found", "message": "Task 999 not found"}` (с реальным номером);
- `POST /tasks/{id}/complete` — закрывает задачу (`200`, `done` равно `true`) и пишет в журнал `INFO`-запись `task <id> completed`; закрытая задача даёт `409` и `{"error": "task_closed", "message": "Task <id> is already done"}`;
- ошибки домена пишутся в журнал уровнем `WARNING` с кодом ошибки в тексте (`domain error task_closed: ...`);
- `GET /report` падает с неожиданной ошибкой: ответ `500` и `{"error": "internal_error", "message": "Internal server error"}`; в тексте ответа не должно быть строки `s3cret` из исключения, а в журнале есть трассировка (`RuntimeError`).

Номера задач в тестах не угадывайте: берите из ответа создания. Идея проверки: ваши тесты запускаются на правильном приложении (все проходят), затем на копиях с ошибками; на каждой копии хотя бы один тест должен упасть. Тесты могут импортировать только `pytest`, `fastapi`, стандартные `json`, `typing` и модули проекта.

```python starter path=main.py
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import service
from errors import DomainError

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("tracker")
app = FastAPI(title="Tracker")


class TaskIn(BaseModel):
    title: str = Field(min_length=1)


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError):
    logger.warning("domain error %s: %s", exc.code, exc.message)
    return JSONResponse(status_code=exc.status_code, content={"error": exc.code, "message": exc.message})


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"error": "internal_error", "message": "Internal server error"})


@app.post("/tasks", status_code=201)
def create(data: TaskIn):
    return service.create_task(data.title)


@app.get("/tasks/{task_id}")
def read(task_id: int):
    return service.get_task(task_id)


@app.post("/tasks/{task_id}/complete")
def complete(task_id: int):
    return service.complete_task(task_id)


@app.get("/report")
def report():
    raise RuntimeError("connection failed: postgresql://app:s3cret@db/tracker")
```

```python starter path=errors.py
class DomainError(Exception):
    status_code = 400
    code = "domain_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class TaskNotFound(DomainError):
    status_code = 404
    code = "task_not_found"


class TaskClosed(DomainError):
    status_code = 409
    code = "task_closed"
```

```python starter path=service.py
import logging

from errors import TaskClosed, TaskNotFound

logger = logging.getLogger("tracker")
TASKS: dict[int, dict] = {}


def create_task(title: str) -> dict:
    task = {"id": len(TASKS) + 1, "title": title, "done": False}
    TASKS[task["id"]] = task
    return task


def get_task(task_id: int) -> dict:
    task = TASKS.get(task_id)
    if task is None:
        raise TaskNotFound(f"Task {task_id} not found")
    return task


def complete_task(task_id: int) -> dict:
    task = get_task(task_id)
    if task["done"]:
        raise TaskClosed(f"Task {task_id} is already done")
    task["done"] = True
    logger.info("task %s completed", task_id)
    return task
```

```python starter path=tests/conftest.py
import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)
```

```python starter path=tests/test_errors.py
def test_create_task(client):
    response = client.post("/tasks", json={"title": "Write report"})
    assert response.status_code == 201
```

```python solution path=main.py
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import service
from errors import DomainError

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("tracker")
app = FastAPI(title="Tracker")


class TaskIn(BaseModel):
    title: str = Field(min_length=1)


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError):
    logger.warning("domain error %s: %s", exc.code, exc.message)
    return JSONResponse(status_code=exc.status_code, content={"error": exc.code, "message": exc.message})


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"error": "internal_error", "message": "Internal server error"})


@app.post("/tasks", status_code=201)
def create(data: TaskIn):
    return service.create_task(data.title)


@app.get("/tasks/{task_id}")
def read(task_id: int):
    return service.get_task(task_id)


@app.post("/tasks/{task_id}/complete")
def complete(task_id: int):
    return service.complete_task(task_id)


@app.get("/report")
def report():
    raise RuntimeError("connection failed: postgresql://app:s3cret@db/tracker")
```

```python solution path=errors.py
class DomainError(Exception):
    status_code = 400
    code = "domain_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class TaskNotFound(DomainError):
    status_code = 404
    code = "task_not_found"


class TaskClosed(DomainError):
    status_code = 409
    code = "task_closed"
```

```python solution path=service.py
import logging

from errors import TaskClosed, TaskNotFound

logger = logging.getLogger("tracker")
TASKS: dict[int, dict] = {}


def create_task(title: str) -> dict:
    task = {"id": len(TASKS) + 1, "title": title, "done": False}
    TASKS[task["id"]] = task
    return task


def get_task(task_id: int) -> dict:
    task = TASKS.get(task_id)
    if task is None:
        raise TaskNotFound(f"Task {task_id} not found")
    return task


def complete_task(task_id: int) -> dict:
    task = get_task(task_id)
    if task["done"]:
        raise TaskClosed(f"Task {task_id} is already done")
    task["done"] = True
    logger.info("task %s completed", task_id)
    return task
```

```python solution path=tests/conftest.py
import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)
```

```python solution path=tests/test_errors.py
def create_task(client, title="Write report"):
    return client.post("/tasks", json={"title": title}).json()["id"]


def test_create_task(client):
    response = client.post("/tasks", json={"title": "Write report"})
    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "Write report"
    assert body["done"] is False


def test_missing_task(client):
    response = client.get("/tasks/999")
    assert response.status_code == 404
    assert response.json() == {"error": "task_not_found", "message": "Task 999 not found"}


def test_complete_task(client):
    task_id = create_task(client)
    response = client.post(f"/tasks/{task_id}/complete")
    assert response.status_code == 200
    assert response.json()["done"] is True


def test_complete_twice(client):
    task_id = create_task(client)
    client.post(f"/tasks/{task_id}/complete")
    response = client.post(f"/tasks/{task_id}/complete")
    assert response.status_code == 409
    assert response.json() == {"error": "task_closed", "message": f"Task {task_id} is already done"}


def test_complete_is_logged(client, caplog):
    caplog.set_level("INFO")
    task_id = create_task(client)
    client.post(f"/tasks/{task_id}/complete")
    assert f"task {task_id} completed" in caplog.text


def test_domain_error_is_warning(client, caplog):
    caplog.set_level("INFO")
    client.get("/tasks/999")
    warnings = [record.getMessage() for record in caplog.records if record.levelname == "WARNING"]
    assert any("task_not_found" in message for message in warnings)


def test_unexpected_error(client, caplog):
    response = client.get("/report")
    assert response.status_code == 500
    assert response.json() == {"error": "internal_error", "message": "Internal server error"}
    assert "s3cret" not in response.text
    assert "RuntimeError" in caplog.text
```

```python wrong id=codes-only path=tests/test_errors.py
def create_task(client, title="Write report"):
    return client.post("/tasks", json={"title": title}).json()["id"]


def test_create_task(client):
    response = client.post("/tasks", json={"title": "Write report"})
    assert response.status_code == 201


def test_missing_task(client):
    assert client.get("/tasks/999").status_code == 404


def test_complete_task(client):
    task_id = create_task(client)
    assert client.post(f"/tasks/{task_id}/complete").status_code == 200


def test_complete_twice(client):
    task_id = create_task(client)
    client.post(f"/tasks/{task_id}/complete")
    assert client.post(f"/tasks/{task_id}/complete").status_code == 409


def test_unexpected_error(client):
    assert client.get("/report").status_code == 500


def test_validation(client):
    assert client.post("/tasks", json={"title": ""}).status_code == 422
```

```python wrong id=no-log-checks path=tests/test_errors.py
def create_task(client, title="Write report"):
    return client.post("/tasks", json={"title": title}).json()["id"]


def test_create_task(client):
    response = client.post("/tasks", json={"title": "Write report"})
    assert response.status_code == 201
    assert response.json()["done"] is False


def test_missing_task(client):
    response = client.get("/tasks/999")
    assert response.status_code == 404
    assert response.json() == {"error": "task_not_found", "message": "Task 999 not found"}


def test_complete_task(client):
    task_id = create_task(client)
    response = client.post(f"/tasks/{task_id}/complete")
    assert response.status_code == 200
    assert response.json()["done"] is True


def test_complete_twice(client):
    task_id = create_task(client)
    client.post(f"/tasks/{task_id}/complete")
    response = client.post(f"/tasks/{task_id}/complete")
    assert response.status_code == 409
    assert response.json() == {"error": "task_closed", "message": f"Task {task_id} is already done"}


def test_unexpected_error(client):
    response = client.get("/report")
    assert response.status_code == 500
    assert response.json() == {"error": "internal_error", "message": "Internal server error"}
    assert "s3cret" not in response.text
```

```python mutant id=no-closed path=service.py
import logging

from errors import TaskClosed, TaskNotFound

logger = logging.getLogger("tracker")
TASKS: dict[int, dict] = {}


def create_task(title: str) -> dict:
    task = {"id": len(TASKS) + 1, "title": title, "done": False}
    TASKS[task["id"]] = task
    return task


def get_task(task_id: int) -> dict:
    task = TASKS.get(task_id)
    if task is None:
        raise TaskNotFound(f"Task {task_id} not found")
    return task


def complete_task(task_id: int) -> dict:
    task = get_task(task_id)
    task["done"] = True
    logger.info("task %s completed", task_id)
    return task
```

```python mutant id=silent-complete path=service.py
import logging

from errors import TaskClosed, TaskNotFound

logger = logging.getLogger("tracker")
TASKS: dict[int, dict] = {}


def create_task(title: str) -> dict:
    task = {"id": len(TASKS) + 1, "title": title, "done": False}
    TASKS[task["id"]] = task
    return task


def get_task(task_id: int) -> dict:
    task = TASKS.get(task_id)
    if task is None:
        raise TaskNotFound(f"Task {task_id} not found")
    return task


def complete_task(task_id: int) -> dict:
    task = get_task(task_id)
    if task["done"]:
        raise TaskClosed(f"Task {task_id} is already done")
    task["done"] = True
    return task
```

```python mutant id=leaks-error path=main.py
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import service
from errors import DomainError

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("tracker")
app = FastAPI(title="Tracker")


class TaskIn(BaseModel):
    title: str = Field(min_length=1)


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError):
    logger.warning("domain error %s: %s", exc.code, exc.message)
    return JSONResponse(status_code=exc.status_code, content={"error": exc.code, "message": exc.message})


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"error": "internal_error", "message": str(exc)})


@app.post("/tasks", status_code=201)
def create(data: TaskIn):
    return service.create_task(data.title)


@app.get("/tasks/{task_id}")
def read(task_id: int):
    return service.get_task(task_id)


@app.post("/tasks/{task_id}/complete")
def complete(task_id: int):
    return service.complete_task(task_id)


@app.get("/report")
def report():
    raise RuntimeError("connection failed: postgresql://app:s3cret@db/tracker")
```

```python mutant id=no-warning path=main.py
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import service
from errors import DomainError

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("tracker")
app = FastAPI(title="Tracker")


class TaskIn(BaseModel):
    title: str = Field(min_length=1)


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.code, "message": exc.message})


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"error": "internal_error", "message": "Internal server error"})


@app.post("/tasks", status_code=201)
def create(data: TaskIn):
    return service.create_task(data.title)


@app.get("/tasks/{task_id}")
def read(task_id: int):
    return service.get_task(task_id)


@app.post("/tasks/{task_id}/complete")
def complete(task_id: int):
    return service.complete_task(task_id)


@app.get("/report")
def report():
    raise RuntimeError("connection failed: postgresql://app:s3cret@db/tracker")
```

## task fa-errors-review
```json
{
  "type": "review",
  "title": "Вход, который всё скрывает и всё выдаёт",
  "xp": 15,
  "hints": [
    "Разделы «Два вида ошибок», «Что писать в журнал и чего нет» и «Частые ошибки»: что можно писать в журнал и что нельзя отдавать клиенту.",
    "Проблемы в строке с logger.info (что в неё попадает) и в блоке except (что он делает с любой ошибкой и что возвращает клиенту).",
    "Верны два исправления: убрать пароль из записи журнала и убрать широкий except, оставив исключение обработчику (в журнал с трассировкой, клиенту общий ответ)."
  ],
  "lines": [3, 8],
  "options": [
    "Убрать `data.password` из записи журнала: оставить только имя пользователя",
    "Убрать `try/except Exception`: неожиданную ошибку обработает общий обработчик, который пишет её в журнал с трассировкой и отвечает клиенту `500` без подробностей",
    "Заменить `logger.error(\"login failed\")` на `print(\"login failed\")`: так запись точно появится в консоли",
    "Вернуть клиенту `{\"error\": repr(exc)}`: тогда пользователю будет проще понять, что пошло не так"
  ],
  "answer": [0, 1],
  "explanation": "В запись на строке 3 попадает пароль: журнал читают многие, и утечка из него считается утечкой пароля. Блок `except Exception` делает сразу три вредных вещи: прячет настоящую причину (в журнале только «login failed» без трассировки), отвечает кодом `200` при сбое и отдаёт клиенту текст исключения, в котором бывают адреса, имена таблиц и куски запросов. Правильнее не ловить всё подряд: неожиданную ошибку подберёт обработчик `Exception`, а ожидаемую (неверные данные) нужно выбросить как исключение домена с кодом `401`. Замена на `print` теряет уровень и имя источника, а `repr(exc)` усугубляет утечку."
}
```
Разработчик написал обработчик входа и проверил, что он «не падает». Ниже его код. Выберите все верные исправления.

```python code
@app.post("/login")
def login(data: LoginIn):
    logger.info(f"login attempt {data.username} {data.password}")
    try:
        user = authenticate(data)
    except Exception as exc:
        logger.error("login failed")
        return {"error": repr(exc)}
    return {"token": make_token(user)}
```
