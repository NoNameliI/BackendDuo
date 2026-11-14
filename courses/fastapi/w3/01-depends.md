# Depends: общие части обработчиков

В трекере задач у десяти маршрутов одна и та же преамбула: разобрать `skip` и `limit`, узнать пользователя по заголовку, открыть соединение и не забыть его закрыть. Копировать это в каждый обработчик долго и опасно: в одном месте забудут проверку, и дыра готова. FastAPI выносит повторяющееся в **зависимости**: обычные функции или классы, которые фреймворк вызывает сам перед обработчиком и результат передаёт в него.

### Зависимость-функция

Зависимость — это функция с такими же параметрами, как у обработчика: путь, запрос, заголовки. Обработчик объявляет её через `Depends`.

```python
def имя_зависимости(параметр: тип = значение):
    return результат


@app.get("/путь")
def обработчик(имя: Annotated[тип, Depends(имя_зависимости)]):
    ...
```

- `Depends(имя_зависимости)` — «перед обработчиком вызови эту функцию». Скобок после имени нет: вы передаёте саму функцию, вызывает её FastAPI.
- Параметры зависимости (`skip`, `limit`) FastAPI разбирает так же, как параметры обработчика: из запроса, с проверкой и кодом `422` при ошибке. В документации OpenAPI они попадают в маршрут.
- `Annotated[тип, Depends(...)]` — тип значения и способ его получить. Подробнее об `Annotated` вы читали в мире «Основы» (урок про параметры), здесь он нужен именно так.
- Что вернула функция, то и получил обработчик в параметре.

```python example
from typing import Annotated

from fastapi import Depends, FastAPI

app = FastAPI()
NOTES = [{"id": number, "text": f"note {number}"} for number in range(1, 8)]


def paging(skip: int = 0, limit: int = 3) -> dict:
    return {"skip": skip, "limit": limit}


@app.get("/notes")
def list_notes(page: Annotated[dict, Depends(paging)]):
    return NOTES[page["skip"] : page["skip"] + page["limit"]]
###
GET /notes
###
GET /notes?skip=5&limit=10
```

Первый запрос вернул заметки с номерами 1, 2, 3: значения по умолчанию `skip=0`, `limit=3`. Второй — заметки 6 и 7: срез `NOTES[5:15]` заканчивается там, где кончается список. Параметры `skip` и `limit` обработчик в своей сигнатуре не объявлял, их взяла зависимость.

### Annotated-псевдоним

Если одна зависимость нужна во многих маршрутах, длинную запись `Annotated[dict, Depends(paging)]` заводят один раз как псевдоним:

```python
Paging = Annotated[dict, Depends(paging)]


@app.get("/notes")
def list_notes(page: Paging): ...
```

- `Paging = Annotated[...]` — обычное присваивание: имя `Paging` теперь означает «dict, полученный через `paging`».
- В обработчике остаётся `page: Paging`. Тип и зависимость описаны в одном месте, менять их приходится тоже в одном.
- Псевдонимы обычно лежат рядом с зависимостью, в `deps.py`, а обработчики их импортируют.

### Класс как зависимость

`Depends` принимает любой вызываемый объект. Класс тоже вызывают: `Paging(...)` создаёт объект. Поэтому класс с параметрами в `__init__` работает как зависимость, а обработчик получает готовый объект с атрибутами.

```python example
from typing import Annotated

from fastapi import Depends, FastAPI

app = FastAPI()
EVENTS = ["open", "talk", "lunch", "talk", "close"]


class Window:
    def __init__(self, first: int = 0, count: int = 2):
        self.first = first
        self.count = count


WindowDep = Annotated[Window, Depends(Window)]


@app.get("/events")
def list_events(window: WindowDep):
    return {"from": window.first, "items": EVENTS[window.first : window.first + window.count]}
###
GET /events
###
GET /events?first=3&count=5
```

Ответы: `{"from": 0, "items": ["open", "talk"]}` и `{"from": 3, "items": ["talk", "close"]}`. Параметры `__init__` (кроме `self`) — это параметры запроса, а `window.first` — обычный атрибут. Удобство в том, что у объекта можно держать и методы.

### Цепочки зависимостей

Зависимость сама может объявлять зависимости. FastAPI построит цепочку и вызовет всё по порядку, начиная с самой глубокой. Так собирают проверку доступа: сначала узнать пользователя, потом проверить его роль.

Заголовок читается через `Header()`: имя параметра `x_token` превращается в заголовок `x-token`, подчёркивание заменяется дефисом.

```python example
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException

app = FastAPI()
TOKENS = {"t-ann": {"name": "ann", "admin": True}, "t-bob": {"name": "bob", "admin": False}}


def get_user(x_token: Annotated[str | None, Header()] = None) -> dict:
    if x_token is None:
        raise HTTPException(status_code=401, detail="Missing token")
    if x_token not in TOKENS:
        raise HTTPException(status_code=401, detail="Unknown token")
    return TOKENS[x_token]


def get_admin(user: Annotated[dict, Depends(get_user)]) -> dict:
    if not user["admin"]:
        raise HTTPException(status_code=403, detail="Admin only")
    return user


@app.get("/profile")
def profile(user: Annotated[dict, Depends(get_user)]):
    return {"user": user["name"]}


@app.get("/admin/stats")
def stats(admin: Annotated[dict, Depends(get_admin)]):
    return {"admin": admin["name"], "users": len(TOKENS)}
###
GET /profile
###
GET /profile
X-Token: t-bob
###
GET /admin/stats
X-Token: t-bob
###
GET /admin/stats
X-Token: t-ann
```

Четыре ответа:

- без заголовка — `401` и `{"detail": "Missing token"}`: `get_user` остановил запрос;
- `t-bob` на `/profile` — `200` и `{"user": "bob"}`;
- `t-bob` на `/admin/stats` — `403` и `{"detail": "Admin only"}`: `get_user` пропустил, `get_admin` отклонил;
- `t-ann` на `/admin/stats` — `200` и `{"admin": "ann", "users": 2}`.

Код `401` значит «не удалось узнать, кто вы», `403` — «вы известны, но вам нельзя». Исключение `HTTPException`, поднятое в зависимости, останавливает запрос: обработчик не вызывается совсем.

### yield-зависимости: открыть и закрыть

Иногда зависимость должна не только выдать значение, но и убрать за собой: закрыть соединение, снять блокировку. Для этого вместо `return` пишут `yield`: всё до `yield` выполняется перед обработчиком, всё после — после него. Принцип тот же, что у менеджеров контекста из мира «Мост от Python к FastAPI»: подготовка, блок работы, уборка.

```python
def get_connection():
    connection = открыть()
    try:
        yield connection
    finally:
        connection.close()
```

- `yield connection` — выдаёт значение обработчику и ждёт, пока запрос обработается.
- `try ... finally` — обязательная обёртка. Если обработчик поднял исключение (`HTTPException` с `404`, ошибка в коде), оно возвращается в зависимость на строку `yield`. Без `finally` код очистки в этом случае просто не выполнится, и соединение останется открытым.
- Очистка не должна менять ответ: он уже сформирован.

```python example
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException

app = FastAPI()
LOG: list[str] = []
SHELF = {1: "atlas"}


def get_connection():
    LOG.append("open")
    try:
        yield "connection"
    finally:
        LOG.append("close")


@app.get("/shelf/{item_id}")
def read_item(item_id: int, connection: Annotated[str, Depends(get_connection)]):
    if item_id not in SHELF:
        raise HTTPException(status_code=404, detail="Not found")
    return {"item": SHELF[item_id]}


@app.get("/log")
def read_log():
    return LOG
###
GET /shelf/1
###
GET /shelf/7
###
GET /log
```

Первые два запроса дали `200` и `404`. Журнал показывает: `["open", "close", "open", "close"]`. Соединение закрыто в обоих случаях, потому что очистка стоит в `finally`.

### Кэш внутри запроса

Если одну и ту же зависимость запрашивают несколько раз за один запрос (напрямую и через другие зависимости), FastAPI вызывает её один раз и всем отдаёт один результат. Так «пользователь» и «проверка прав» не ходят в базу по два раза.

- `Depends(функция)` — результат кэшируется на время запроса.
- `Depends(функция, use_cache=False)` — вызвать заново, даже если результат уже есть.
- Кэш живёт только один запрос. Следующий запрос вызовет функцию снова.

```python example
from typing import Annotated

from fastapi import Depends, FastAPI

app = FastAPI()
CALLS = {"count": 0}


def get_stamp() -> int:
    CALLS["count"] += 1
    return CALLS["count"]


Stamp = Annotated[int, Depends(get_stamp)]
Fresh = Annotated[int, Depends(get_stamp, use_cache=False)]


@app.get("/stamps")
def stamps(first: Stamp, second: Stamp, fresh: Fresh):
    return {"first": first, "second": second, "fresh": fresh}
###
GET /stamps
###
GET /stamps
```

Первый ответ: `{"first": 1, "second": 1, "fresh": 2}`. Параметры идут по порядку: `first` вызвал функцию, `second` взял результат из кэша, `fresh` потребовал новый вызов. Второй запрос даёт `{"first": 3, "second": 3, "fresh": 4}`: счётчик общий, а кэш в новом запросе пустой.

### Частые ошибки

- Скобки у функции. Неверно: `Depends(get_user())` — вызов произойдёт при загрузке модуля и вернёт не функцию. Верно: `Depends(get_user)`.
- `return` вместо `yield`, когда нужна очистка. Неверно: открыть ресурс и вернуть его, закрытия нет. Верно: `yield` внутри `try ... finally`.
- Очистка без `finally`. Неверно: `yield x` и следом `x.close()` — при `404` из обработчика закрытие пропустится. Верно: `try: yield x` и `finally: x.close()`.
- Ожидание нового вызова. Неверно: надеяться, что `Depends(f)` дважды в одном обработчике вызовет `f` дважды. Верно: один вызов; повторный нужен с `use_cache=False`.

### Шпаргалка

- `Depends(функция)` — FastAPI сам вызывает функцию перед обработчиком; результат приходит в параметр.
- Параметры зависимости разбираются как параметры запроса; `HTTPException` в ней останавливает запрос.
- Псевдоним: `Dep = Annotated[Тип, Depends(функция)]`, в обработчике `имя: Dep`.
- Класс: `Depends(Класс)`, параметры берутся из `__init__`.
- Цепочка: зависимость объявляет свои `Depends`. `401` — неизвестен, `403` — нельзя.
- `yield` + `try/finally` — очистка после ответа, в том числе при ошибке.
- Кэш в пределах запроса; `use_cache=False` отключает.

## task fa-depends-paging
```json
{
  "type": "fastapi",
  "title": "Страницы списка задач",
  "xp": 10,
  "hints": [
    "Разделы «Класс как зависимость» и «Annotated-псевдоним»: параметры `skip` и `limit` описываются в `__init__` класса, а обработчик получает объект.",
    "У `skip` нужна проверка `ge=0`, у `limit` — `ge=1, le=5`; проверки пишутся через `Annotated[int, Query(...)]`, как в мире «Основы». Значения по умолчанию: 0 и 3.",
    "Шаблон: `class Pagination: def __init__(self, skip: Annotated[int, Query(ge=0)] = 0, limit: Annotated[int, Query(…)] = 3): self.skip = skip; self.limit = limit`, затем `Page = Annotated[Pagination, Depends(Pagination)]`."
  ],
  "wrong": {
    "no-limits": "параметры принимают любые числа: limit=9 отвечает 200 вместо 422",
    "ignores-skip": "смещение skip игнорируется, страница всегда начинается с первой задачи"
  }
}
```
В приложении есть два списка: `GET /tasks` (все задачи) и `GET /tasks/done` (только выполненные). Оба должны уметь постраничный вывод через параметры запроса `skip` (сколько задач пропустить, по умолчанию `0`, не меньше `0`) и `limit` (сколько вернуть, по умолчанию `3`, от `1` до `5`). Недопустимое значение даёт `422`.

Постраничная логика одна на два маршрута, поэтому её нужно вынести в зависимость: класс `Pagination` и псевдоним `Page`, уже подставленный в обработчики. Допишите класс.

Ответ маршрута — список задач `{"id", "title", "done"}` в порядке номеров: срез от `skip` длиной `limit`.

```python starter
from typing import Annotated

from fastapi import Depends, FastAPI, Query

app = FastAPI()
TASKS = [{"id": number, "title": f"Task {number}", "done": number % 2 == 0} for number in range(1, 9)]


class Pagination:
    def __init__(self, …):
        …


Page = Annotated[Pagination, Depends(Pagination)]


@app.get("/tasks")
def list_tasks(page: Page):
    return TASKS[page.skip : page.skip + page.limit]


@app.get("/tasks/done")
def list_done(page: Page):
    done = [task for task in TASKS if task["done"]]
    return done[page.skip : page.skip + page.limit]
```

```python solution
from typing import Annotated

from fastapi import Depends, FastAPI, Query

app = FastAPI()
TASKS = [{"id": number, "title": f"Task {number}", "done": number % 2 == 0} for number in range(1, 9)]


class Pagination:
    def __init__(
        self,
        skip: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=1, le=5)] = 3,
    ):
        self.skip = skip
        self.limit = limit


Page = Annotated[Pagination, Depends(Pagination)]


@app.get("/tasks")
def list_tasks(page: Page):
    return TASKS[page.skip : page.skip + page.limit]


@app.get("/tasks/done")
def list_done(page: Page):
    done = [task for task in TASKS if task["done"]]
    return done[page.skip : page.skip + page.limit]
```

```python wrong id=no-limits
from typing import Annotated

from fastapi import Depends, FastAPI, Query

app = FastAPI()
TASKS = [{"id": number, "title": f"Task {number}", "done": number % 2 == 0} for number in range(1, 9)]


class Pagination:
    def __init__(self, skip: int = 0, limit: int = 3):
        self.skip = skip
        self.limit = limit


Page = Annotated[Pagination, Depends(Pagination)]


@app.get("/tasks")
def list_tasks(page: Page):
    return TASKS[page.skip : page.skip + page.limit]


@app.get("/tasks/done")
def list_done(page: Page):
    done = [task for task in TASKS if task["done"]]
    return done[page.skip : page.skip + page.limit]
```

```python wrong id=ignores-skip
from typing import Annotated

from fastapi import Depends, FastAPI, Query

app = FastAPI()
TASKS = [{"id": number, "title": f"Task {number}", "done": number % 2 == 0} for number in range(1, 9)]


class Pagination:
    def __init__(
        self,
        skip: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=1, le=5)] = 3,
    ):
        self.skip = 0
        self.limit = limit


Page = Annotated[Pagination, Depends(Pagination)]


@app.get("/tasks")
def list_tasks(page: Page):
    return TASKS[page.skip : page.skip + page.limit]


@app.get("/tasks/done")
def list_done(page: Page):
    done = [task for task in TASKS if task["done"]]
    return done[page.skip : page.skip + page.limit]
```

```http tests
GET /tasks
###
GET /tasks?skip=6&limit=5
###
GET /tasks?limit=9
###
GET /tasks?skip=-1
###
GET /tasks/done?skip=1&limit=2
###
GET /tasks/done?limit=0
```

## task fa-depends-chain
```json
{
  "type": "fastapi",
  "title": "Цепочка проверок доступа",
  "xp": 15,
  "hints": [
    "Раздел «Цепочки зависимостей»: `401` отвечает на вопрос «кто вы», `403` — «можно ли вам».",
    "В `get_user` проверьте два случая: заголовка нет и имени нет в `USERS`, оба дают `401` (тексты `detail` в условии). В `require_admin` получите пользователя через `Depends(get_user)` и откажите с `403`, если роль не `admin`.",
    "Шаблон: `def require_admin(user: Annotated[dict, Depends(get_user)]) -> dict: if user[\"role\"] != …: raise HTTPException(status_code=403, detail=…); return user`, а в конце `AdminUser = Annotated[dict, Depends(require_admin)]`."
  ],
  "readonly": ["main.py"],
  "wrong": {
    "forbidden-as-401": "обычному пользователю отвечает 401 вместо 403",
    "no-unknown-check": "неизвестное имя пользователя пропускается и приводит к ошибке 500"
  }
}
```
В проекте два файла. `main.py` закрыт для правки: в нём `GET /tasks` (доступен любому известному пользователю) и `DELETE /tasks/{task_id}` (только администратору). Допишите `deps.py`.

Пользователя определяет заголовок `X-User` с именем из словаря `USERS`:

- заголовка нет — `401` и `{"detail": "Missing X-User header"}`;
- имя не из `USERS` — `401` и `{"detail": "Unknown user"}`;
- известный пользователь не администратор, а маршрут для администратора — `403` и `{"detail": "Admin only"}`.

Зависимость `get_user` возвращает словарь `{"name", "role"}`. Зависимость `require_admin` строится на ней, а `AdminUser` и `CurrentUser` — псевдонимы, которые импортирует `main.py`.

```python starter path=main.py
from fastapi import FastAPI, HTTPException

from deps import AdminUser, CurrentUser

app = FastAPI()
TASKS = {1: "Write report", 2: "Review code"}


@app.get("/tasks")
def list_tasks(user: CurrentUser):
    return {"user": user["name"], "tasks": list(TASKS.values())}


@app.delete("/tasks/{task_id}")
def delete_task(task_id: int, admin: AdminUser):
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail="Task not found")
    del TASKS[task_id]
    return {"deleted": task_id, "by": admin["name"]}
```

```python starter path=deps.py
from typing import Annotated

from fastapi import Depends, Header, HTTPException

USERS = {"ann": "admin", "bob": "member"}


def get_user(x_user: Annotated[str | None, Header()] = None) -> dict:
    if x_user is None:
        raise HTTPException(status_code=401, detail="Missing X-User header")
    return {"name": x_user, "role": USERS.get(x_user)}


def require_admin(user: Annotated[dict, Depends(get_user)]) -> dict:
    return user


CurrentUser = Annotated[dict, Depends(get_user)]
AdminUser = Annotated[dict, Depends(require_admin)]
```

```python solution path=main.py
from fastapi import FastAPI, HTTPException

from deps import AdminUser, CurrentUser

app = FastAPI()
TASKS = {1: "Write report", 2: "Review code"}


@app.get("/tasks")
def list_tasks(user: CurrentUser):
    return {"user": user["name"], "tasks": list(TASKS.values())}


@app.delete("/tasks/{task_id}")
def delete_task(task_id: int, admin: AdminUser):
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail="Task not found")
    del TASKS[task_id]
    return {"deleted": task_id, "by": admin["name"]}
```

```python solution path=deps.py
from typing import Annotated

from fastapi import Depends, Header, HTTPException

USERS = {"ann": "admin", "bob": "member"}


def get_user(x_user: Annotated[str | None, Header()] = None) -> dict:
    if x_user is None:
        raise HTTPException(status_code=401, detail="Missing X-User header")
    if x_user not in USERS:
        raise HTTPException(status_code=401, detail="Unknown user")
    return {"name": x_user, "role": USERS[x_user]}


def require_admin(user: Annotated[dict, Depends(get_user)]) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


CurrentUser = Annotated[dict, Depends(get_user)]
AdminUser = Annotated[dict, Depends(require_admin)]
```

```python wrong id=forbidden-as-401 path=deps.py
from typing import Annotated

from fastapi import Depends, Header, HTTPException

USERS = {"ann": "admin", "bob": "member"}


def get_user(x_user: Annotated[str | None, Header()] = None) -> dict:
    if x_user is None:
        raise HTTPException(status_code=401, detail="Missing X-User header")
    if x_user not in USERS:
        raise HTTPException(status_code=401, detail="Unknown user")
    return {"name": x_user, "role": USERS[x_user]}


def require_admin(user: Annotated[dict, Depends(get_user)]) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=401, detail="Admin only")
    return user


CurrentUser = Annotated[dict, Depends(get_user)]
AdminUser = Annotated[dict, Depends(require_admin)]
```

```python wrong id=no-unknown-check path=deps.py
from typing import Annotated

from fastapi import Depends, Header, HTTPException

USERS = {"ann": "admin", "bob": "member"}


def get_user(x_user: Annotated[str | None, Header()] = None) -> dict:
    if x_user is None:
        raise HTTPException(status_code=401, detail="Missing X-User header")
    return {"name": x_user, "role": USERS[x_user]}


def require_admin(user: Annotated[dict, Depends(get_user)]) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


CurrentUser = Annotated[dict, Depends(get_user)]
AdminUser = Annotated[dict, Depends(require_admin)]
```

```http tests
GET /tasks
###
GET /tasks
X-User: bob
###
GET /tasks
X-User: zoe
###
DELETE /tasks/1
X-User: bob
###
DELETE /tasks/1
###
DELETE /tasks/9
X-User: ann
###
DELETE /tasks/1
X-User: ann
###
GET /tasks
X-User: ann
```

## task fa-depends-session
```json
{
  "type": "fix-bug",
  "title": "Сессия остаётся открытой",
  "xp": 15,
  "hints": [
    "Раздел «yield-зависимости: открыть и закрыть»: что происходит с кодом после `yield`, если обработчик поднял `HTTPException`?",
    "Счётчик `/stats` показывает число незакрытых сессий. После запроса несуществующей задачи он не возвращается к нулю: очистка пропускается, когда обработчик отвечает `404`.",
    "Шаблон: `session = Session()`, затем `try: yield session`, затем `finally: session.close()`. Менять нужно только `deps.py`."
  ],
  "readonly": ["main.py"],
  "wrong": {
    "except-only": "сессия закрывается только при ошибке, а после успешного запроса остаётся открытой"
  }
}
```
Каждый запрос к трекеру открывает «сессию» (объект `Session` из `deps.py`) и должен её закрывать. Маршрут `GET /stats` показывает, сколько сессий остаются незакрытыми: после любых запросов там должно быть `{"open": 0}`. Сейчас после запроса несуществующей задачи (`404`) в `/stats` появляется `1`.

Найдите причину и исправьте `deps.py`. `main.py` менять нельзя: ошибка не в маршрутах. Правильное поведение: `GET /tasks/{task_id}` отвечает `200` с задачей или `404` с `{"detail": "Task not found"}`, и в обоих случаях сессия закрыта.

```python starter path=main.py
from fastapi import FastAPI, HTTPException

from deps import STATS, SessionDep

app = FastAPI()
TASKS = {1: {"id": 1, "title": "Write report"}}


@app.get("/tasks/{task_id}")
def read_task(task_id: int, session: SessionDep):
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail="Task not found")
    return TASKS[task_id]


@app.get("/stats")
def read_stats():
    return {"open": STATS["opened"] - STATS["closed"]}
```

```python starter path=deps.py
from typing import Annotated

from fastapi import Depends

STATS = {"opened": 0, "closed": 0}


class Session:
    def __init__(self) -> None:
        STATS["opened"] += 1

    def close(self) -> None:
        STATS["closed"] += 1


def get_session():
    session = Session()
    yield session
    session.close()


SessionDep = Annotated[Session, Depends(get_session)]
```

```python solution path=main.py
from fastapi import FastAPI, HTTPException

from deps import STATS, SessionDep

app = FastAPI()
TASKS = {1: {"id": 1, "title": "Write report"}}


@app.get("/tasks/{task_id}")
def read_task(task_id: int, session: SessionDep):
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail="Task not found")
    return TASKS[task_id]


@app.get("/stats")
def read_stats():
    return {"open": STATS["opened"] - STATS["closed"]}
```

```python solution path=deps.py
from typing import Annotated

from fastapi import Depends

STATS = {"opened": 0, "closed": 0}


class Session:
    def __init__(self) -> None:
        STATS["opened"] += 1

    def close(self) -> None:
        STATS["closed"] += 1


def get_session():
    session = Session()
    try:
        yield session
    finally:
        session.close()


SessionDep = Annotated[Session, Depends(get_session)]
```

```python wrong id=except-only path=deps.py
from typing import Annotated

from fastapi import Depends, HTTPException

STATS = {"opened": 0, "closed": 0}


class Session:
    def __init__(self) -> None:
        STATS["opened"] += 1

    def close(self) -> None:
        STATS["closed"] += 1


def get_session():
    session = Session()
    try:
        yield session
    except HTTPException:
        session.close()
        raise


SessionDep = Annotated[Session, Depends(get_session)]
```

```http tests
GET /tasks/1
###
GET /stats
###
GET /tasks/9
###
GET /stats
```

## task fa-depends-cache
```json
{
  "type": "choice",
  "title": "Сколько раз вызовется зависимость",
  "xp": 10,
  "hints": [
    "Раздел «Кэш внутри запроса».",
    "Параметры разбираются по порядку. Первое обращение вызывает функцию, повторное с тем же `Depends(get_slot)` берёт результат из кэша.",
    "Параметры `a` и `b` используют кэш: вместе это один вызов. Параметр `c` с `use_cache=False` всегда вызывает функцию заново."
  ],
  "options": [
    "Один раз: все три параметра получат одно значение",
    "Два раза: `a` и `b` делят один результат, `c` получает свой",
    "Три раза: каждый параметр вызывает функцию отдельно",
    "Ни разу: функцию вызывает только сам обработчик"
  ],
  "answer": [1],
  "explanation": "Первый вызов делает параметр `a`, результат кэшируется на время запроса, и `b` берёт его из кэша. Параметр `c` объявлен с `use_cache=False`, поэтому делает второй вызов. Один раз было бы без `use_cache=False`; три раза — если отключить кэш у всех. Вариант «ни разу» неверен: зависимость вызывает FastAPI, а не обработчик, и делает это до него."
}
```
Для одного запроса к маршруту ниже функция `get_slot` увеличивает счётчик на единицу при каждом вызове. Сколько раз она будет вызвана?

```python
def get_slot() -> int:
    COUNTER["calls"] += 1
    return COUNTER["calls"]


Slot = Annotated[int, Depends(get_slot)]
Fresh = Annotated[int, Depends(get_slot, use_cache=False)]


@app.get("/slots")
def read_slots(a: Slot, b: Slot, c: Fresh):
    return [a, b, c]
```
