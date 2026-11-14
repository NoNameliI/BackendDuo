# Enum в пути, порядок маршрутов и пути с косой чертой

В сервисе есть адреса двух видов: `/members/12` — участник по номеру и `/members/me` — «я сам». Кроме того, статус или приоритет можно выбрать только из заранее известных значений, а ещё клиент иногда присылает в пути целое имя файла вместе с папками. Всё это решается тремя приёмами: `Enum`, правильным порядком маршрутов и конвертером `path`. Урок использует то, что вы знаете из предыдущих: параметры пути с типами и ответ `422`.

### Enum: фиксированный набор значений

**Enum** — класс, в котором перечислены допустимые значения. Если сделать его параметром пути, FastAPI примет только эти значения и сам вернёт `422` на остальные.

```python
from enum import Enum


class Priority(str, Enum):
    low = "low"
    high = "high"


@app.get("/queue/{priority}")
def read_queue(priority: Priority):
    ...
```

- `from enum import Enum` — подключение из стандартной библиотеки;
- `class Priority(str, Enum):` — класс-перечисление. Слово `str` перед `Enum` делает значения строками, и FastAPI может описать их в документации и сравнить с текстом из адреса;
- `low = "low"` — **член** перечисления: слева имя в коде, справа значение, которое клиент пишет в адресе;
- `priority: Priority` — параметр с типом-перечислением: допустимы только `low` и `high`.

Внутри функции `priority` — это член, а не строка. Его сравнивают с членом: `priority is Priority.high` (или `==`). Строку получают так: `priority.value`. Если вернуть член как есть, в JSON попадёт его значение.

### Порядок маршрутов

FastAPI проверяет маршруты **в том порядке, в котором они объявлены**, и берёт первый подходящий. Это важно, когда один путь подходит под шаблон другого:

- `/members/me` — конкретный путь;
- `/members/{member_id}` — шаблон, под который подходит и `me`.

Если шаблон объявлен первым, запрос `GET /members/me` попадёт в него: `member_id` получит значение `"me"`, а для типа `int` это ошибка. Правило: сначала конкретные пути, потом шаблоны с параметрами.

### Путь с косой чертой: конвертер path

Обычный параметр пути заканчивается на ближайшей `/`: `{file_path}` не примет `reports/2026/q1.txt`. Чтобы принять оставшуюся часть пути целиком, к имени добавляют конвертер.

```python
@app.get("/docs-store/{file_path:path}")
def read_file(file_path: str):
    ...
```

- `{file_path:path}` — после имени и двоеточия стоит `path`: переменная забирает всё до конца адреса, вместе с `/`;
- `file_path: str` — параметр функции с тем же именем; тип строка.

Если клиент хочет передать путь, начинающийся с `/`, адрес получается с двойной косой чертой: `/docs-store//home/ann/a.txt`. Это нормально, значение будет `/home/ann/a.txt`.

### Пример

В примере три приёма вместе: приоритет из перечисления, `/members/me` перед `/members/{member_id}` и путь с папками.

```python example
from enum import Enum

from fastapi import FastAPI

app = FastAPI()


class Priority(str, Enum):
    low = "low"
    high = "high"


@app.get("/queue/{priority}")
def read_queue(priority: Priority):
    if priority is Priority.high:
        return {"priority": priority, "wait_minutes": 5}
    return {"priority": priority.value, "wait_minutes": 60}


@app.get("/members/me")
def read_me():
    return {"name": "current member"}


@app.get("/members/{member_id}")
def read_member(member_id: int):
    return {"member_id": member_id}


@app.get("/docs-store/{file_path:path}")
def read_file(file_path: str):
    return {"file_path": file_path}
###
GET /queue/high
###
GET /queue/low
###
GET /queue/urgent
###
GET /members/me
###
GET /members/12
###
GET /members/ann
###
GET /docs-store/reports/2026/q1.txt
```

Результат:

- `GET /queue/high` — `200`, `{"priority": "high", "wait_minutes": 5}`;
- `GET /queue/low` — `200`, `{"priority": "low", "wait_minutes": 60}`;
- `GET /queue/urgent` — `422`: в `loc` стоит `["path", "priority"]`, `type` равен `enum`, а `msg` — `Input should be 'low' or 'high'`;
- `GET /members/me` — `200`, `{"name": "current member"}`;
- `GET /members/12` — `200`, `{"member_id": 12}`;
- `GET /members/ann` — `422`: `ann` не число;
- `GET /docs-store/reports/2026/q1.txt` — `200`, `{"file_path": "reports/2026/q1.txt"}`.

Теперь тот же код с переставленными маршрутами:

```python example
from fastapi import FastAPI

app = FastAPI()


@app.get("/members/{member_id}")
def read_member(member_id: int):
    return {"member_id": member_id}


@app.get("/members/me")
def read_me():
    return {"name": "current member"}
###
GET /members/me
```

Ответ: `422`, `loc` равен `["path", "member_id"]`, `type` равен `int_parsing`, `input` равен `me`. Маршрут `/members/me` написан, но до него запрос не дошёл: раньше сработал шаблон. Признак такой ошибки: ответ `422` или чужой результат на «особенный» адрес. Ищите, какой маршрут объявлен выше.

### Частые ошибки

- Шаблон выше конкретного пути. Неверно: сначала `/users/{user_id}`, потом `/users/me`. Верно: сначала `/users/me`.
- Строка вместо перечисления. Неверно: `status: str` и проверка `if status not in (...)` вручную. Верно: `status: Status`, неверное значение даст `422` само.
- Класс без `str`. Неверно: `class Priority(Enum)` — значения не строки, и сравнение с текстом из адреса не работает. Верно: `class Priority(str, Enum)`.
- Забытый конвертер `path`. Неверно: `/files/{file_path}` для `files/a/b.txt` отвечает `404`. Верно: `/files/{file_path:path}`.

### Шпаргалка

- `class Имя(str, Enum): имя = "значение"` — допустимые значения; параметр `x: Имя`.
- Неверное значение: `422`, `type` равен `enum`.
- `x is Имя.член`, `x.value` — сравнение и получение строки.
- Маршруты проверяются сверху вниз: конкретные пути объявляйте раньше шаблонов.
- `{имя:path}` — принимает остаток пути вместе с `/`.

## task fa-task-status-enum

```json
{
  "type": "fastapi",
  "title": "Задачи по статусу",
  "xp": 10,
  "hints": [
    "Раздел «Enum: фиксированный набор значений».",
    "Создайте класс `Status(str, Enum)` с тремя членами и сделайте его типом параметра пути `status`. Количество считайте по значению `status.value`.",
    "Шаблон: `class Status(str, Enum): open = \"open\"; …`, `@app.get(\"/tasks/{status}\")`, `def count_tasks(status: Status):`, `return {\"status\": status.value, \"count\": …}`."
  ],
  "wrong": {
    "plain-str": "статус принимается как обычная строка: неизвестный статус даёт `200` с нулём вместо `422`",
    "bad-value": "член перечисления назван `in_progress` с другим значением, поэтому `/tasks/in_progress` отклоняется"
  }
}
```

В трекере задач у каждой задачи один из трёх статусов: `open`, `in_progress` и `done`. Список `TASKS` уже есть. Добавьте маршрут `GET /tasks/{status}`:

- статус берётся из перечисления `Status` с членами `open`, `in_progress`, `done` (значения совпадают с именами);
- ответ `200`: `{"status": "<статус>", "count": <сколько задач в этом статусе>}`;
- любой другой статус даёт `422`.

```python starter
from enum import Enum

from fastapi import FastAPI

app = FastAPI()
TASKS = [
    {"id": 1, "status": "open"},
    {"id": 2, "status": "done"},
    {"id": 3, "status": "open"},
    {"id": 4, "status": "in_progress"},
]


class Status(str, Enum):
    open = "…"
    …


@app.get("/tasks/{…}")
def count_tasks(status: …):
    count = len([t for t in TASKS if t["status"] == status.value])
    return {"status": status.value, "count": count}
```

```python solution
from enum import Enum

from fastapi import FastAPI

app = FastAPI()
TASKS = [
    {"id": 1, "status": "open"},
    {"id": 2, "status": "done"},
    {"id": 3, "status": "open"},
    {"id": 4, "status": "in_progress"},
]


class Status(str, Enum):
    open = "open"
    in_progress = "in_progress"
    done = "done"


@app.get("/tasks/{status}")
def count_tasks(status: Status):
    count = len([t for t in TASKS if t["status"] == status.value])
    return {"status": status.value, "count": count}
```

```python wrong id=plain-str
from fastapi import FastAPI

app = FastAPI()
TASKS = [
    {"id": 1, "status": "open"},
    {"id": 2, "status": "done"},
    {"id": 3, "status": "open"},
    {"id": 4, "status": "in_progress"},
]


@app.get("/tasks/{status}")
def count_tasks(status: str):
    count = len([t for t in TASKS if t["status"] == status])
    return {"status": status, "count": count}
```

```python wrong id=bad-value
from enum import Enum

from fastapi import FastAPI

app = FastAPI()
TASKS = [
    {"id": 1, "status": "open"},
    {"id": 2, "status": "done"},
    {"id": 3, "status": "open"},
    {"id": 4, "status": "in_progress"},
]


class Status(str, Enum):
    open = "open"
    in_progress = "in-progress"
    done = "done"


@app.get("/tasks/{status}")
def count_tasks(status: Status):
    count = len([t for t in TASKS if t["status"] == status.value])
    return {"status": status.value, "count": count}
```

```http tests
GET /tasks/open
###
GET /tasks/in_progress
###
GET /tasks/done
###
GET /tasks/blocked
```

## task fa-fix-me-route

```json
{
  "type": "fix-bug",
  "title": "Профиль «me» не открывается",
  "xp": 15,
  "hints": [
    "Раздел «Порядок маршрутов». Прочитайте тело ответа `422`: `loc` и `input` подсказывают, какой маршрут перехватил запрос.",
    "Запрос `GET /users/me` обрабатывает шаблон `/users/{user_id}`, потому что он объявлен раньше. Нужно поменять порядок функций, а не менять пути.",
    "Шаблон: сначала `@app.get(\"/users/me\")` и его функция, ниже `@app.get(\"/users/{user_id}\")`."
  ],
  "wrong": {
    "id-as-str": "параметр `user_id` стал строкой: запрос `/users/me` больше не даёт `422`, но падает с `500` (`int(me)` не число), а профиль по-прежнему не открывается; номер в ответе стал строкой",
    "renamed": "маршрут `me` переименован в `/users/current`: запрос `GET /users/me` по-прежнему обрабатывается шаблоном"
  }
}
```

В трекере есть профили пользователей. `GET /users/{user_id}` возвращает пользователя по номеру, а `GET /users/me` — профиль текущего пользователя. Запрос `GET /users/me` почему-то отвечает `422`. Найдите ошибку и исправьте приложение, не меняя адреса и ответы маршрутов.

Правильное поведение: `/users/me` — `200` и `{"id": 0, "name": "current user"}`; `/users/2` — `200` и `{"id": 2, "name": "Ann"}`; `/users/9` — `404` и `{"detail": "User not found"}`; `/users/abc` — `422`.

```python starter
from fastapi import FastAPI, HTTPException

app = FastAPI()
USERS = {1: "Bob", 2: "Ann"}


@app.get("/users/{user_id}")
def read_user(user_id: int):
    if user_id not in USERS:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user_id, "name": USERS[user_id]}


@app.get("/users/me")
def read_me():
    return {"id": 0, "name": "current user"}
```

```python solution
from fastapi import FastAPI, HTTPException

app = FastAPI()
USERS = {1: "Bob", 2: "Ann"}


@app.get("/users/me")
def read_me():
    return {"id": 0, "name": "current user"}


@app.get("/users/{user_id}")
def read_user(user_id: int):
    if user_id not in USERS:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user_id, "name": USERS[user_id]}
```

```python wrong id=id-as-str
from fastapi import FastAPI, HTTPException

app = FastAPI()
USERS = {1: "Bob", 2: "Ann"}


@app.get("/users/{user_id}")
def read_user(user_id: str):
    if int(user_id) not in USERS:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user_id, "name": USERS[int(user_id)]}


@app.get("/users/me")
def read_me():
    return {"id": 0, "name": "current user"}
```

```python wrong id=renamed
from fastapi import FastAPI, HTTPException

app = FastAPI()
USERS = {1: "Bob", 2: "Ann"}


@app.get("/users/{user_id}")
def read_user(user_id: int):
    if user_id not in USERS:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user_id, "name": USERS[user_id]}


@app.get("/users/current")
def read_me():
    return {"id": 0, "name": "current user"}
```

```http tests
GET /users/me
###
GET /users/2
###
GET /users/9
###
GET /users/abc
```

## task fa-attachment-path

```json
{
  "type": "fastapi",
  "title": "Вложение по пути с папками",
  "xp": 15,
  "hints": [
    "Раздел «Путь с косой чертой: конвертер path» и «Ограничения: Annotated, Path, Query» в прошлом уроке.",
    "Адрес `/projects/{project_id}/files/{file_path:path}`. Номер проекта — `int` не меньше `1`, путь — строка. Имя файла — последняя часть после `/`.",
    "Шаблон: `project_id: Annotated[int, Path(ge=…)]`, `file_path: str`, `name = file_path.split(\"/\")[-1]`, `return {\"project\": …, \"path\": …, \"name\": …}`."
  ],
  "wrong": {
    "no-path-converter": "в адресе нет конвертера `path`: вложенные папки дают `404`",
    "no-project-limit": "номер проекта не ограничен снизу: проект `0` проходит вместо `422`"
  }
}
```

К задачам трекера прикрепляют файлы, а в адресе путь к файлу лежит внутри проекта вместе с папками. Добавьте маршрут `GET /projects/{project_id}/files/{file_path}`, который принимает путь целиком (с `/`) и отвечает `200`:

```json
{"project": <номер проекта>, "path": "<путь>", "name": "<последняя часть пути>"}
```

Номер проекта — целое число не меньше `1`, иначе `422`.

```python starter
from typing import Annotated

from fastapi import FastAPI, Path

app = FastAPI()


@app.get("/projects/{project_id}/files/{…}")
def read_attachment(project_id: Annotated[int, Path(…)], file_path: str):
    name = file_path.split("/")[-1]
    return {"project": project_id, "path": file_path, "name": name}
```

```python solution
from typing import Annotated

from fastapi import FastAPI, Path

app = FastAPI()


@app.get("/projects/{project_id}/files/{file_path:path}")
def read_attachment(project_id: Annotated[int, Path(ge=1)], file_path: str):
    name = file_path.split("/")[-1]
    return {"project": project_id, "path": file_path, "name": name}
```

```python wrong id=no-path-converter
from typing import Annotated

from fastapi import FastAPI, Path

app = FastAPI()


@app.get("/projects/{project_id}/files/{file_path}")
def read_attachment(project_id: Annotated[int, Path(ge=1)], file_path: str):
    name = file_path.split("/")[-1]
    return {"project": project_id, "path": file_path, "name": name}
```

```python wrong id=no-project-limit
from fastapi import FastAPI

app = FastAPI()


@app.get("/projects/{project_id}/files/{file_path:path}")
def read_attachment(project_id: int, file_path: str):
    name = file_path.split("/")[-1]
    return {"project": project_id, "path": file_path, "name": name}
```

```http tests
GET /projects/3/files/readme.txt
###
GET /projects/3/files/design/2026/spec.pdf
###
GET /projects/0/files/readme.txt
###
GET /projects/abc/files/readme.txt
```

## task fa-read-422

```json
{
  "type": "review",
  "title": "Какой параметр не прошёл проверку",
  "hints": [
    "Раздел «Тело ответа 422» в прошлом уроке.",
    "Смотрите на поле `loc`: первый элемент — место параметра, второй — его имя. Поле `type` называет причину.",
    "Строка `loc` содержит `query` и `limit`, а `type` равен `less_than_equal`: значение оказалось больше допустимого максимума."
  ],
  "code": "{\n  \"detail\": [\n    {\n      \"type\": \"less_than_equal\",\n      \"loc\": [\"query\", \"limit\"],\n      \"msg\": \"Input should be less than or equal to 50\",\n      \"input\": \"100\",\n      \"ctx\": {\"le\": 50}\n    }\n  ]\n}",
  "codeLanguage": "json",
  "lines": [3, 4, 5],
  "options": [
    "Параметр запроса `limit` больше допустимого максимума 50",
    "Параметр пути `limit` не удалось преобразовать в число",
    "Параметр запроса `limit` не передан",
    "В теле запроса поле `limit` слишком маленькое"
  ],
  "answer": [0],
  "explanation": "В `loc` первое слово `query` означает параметр запроса, второе — имя `limit`. Причина в `type` и `msg`: `less_than_equal`, значение `100` больше допустимых `50` (это показывает и `ctx`). Не число было бы с `type` `int_parsing`, а непереданный параметр — с `missing`. Место `body` относится к телу запроса, здесь его нет."
}
```

Клиент отправил запрос `GET /rooms?limit=100`, и сервис ответил кодом `422` с таким телом. Что произошло?
