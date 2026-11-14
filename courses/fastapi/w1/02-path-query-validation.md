# Параметры пути и запроса, проверки

Клиент бронирования хочет открыть одну комнату по номеру, а потом отфильтровать список: только третий этаж, не меньше шести мест, первые десять результатов. Все эти значения приходят в адресе. Если сервер не проверяет их сам, в обработчик попадут строки вроде `"abc"` вместо номера. FastAPI делает проверку за вас: по типам в сигнатуре функции. В этом уроке вы научитесь принимать параметры пути и запроса, ограничивать их значения и читать ответ `422`, когда проверка не прошла.

### Параметры пути

Часть пути можно сделать переменной: заключить её в фигурные скобки и принять в функции параметром с тем же именем.

```python
@app.get("/books/{book_id}")
def read_book(book_id: int):
    ...
```

- `{book_id}` — переменная часть пути. Для `GET /books/7` значение будет `"7"`.
- `book_id: int` — параметр функции с тем же именем и **типом**. FastAPI превратит строку `"7"` в число `7`, а `"abc"` отклонит.
- Параметр пути всегда обязателен: без значения такого адреса просто нет.

Какие типы можно писать: `int`, `float`, `str`, `bool`, а также `Enum` (об этом в следующем уроке). Если тип не указан, значение остаётся строкой.

### Параметры запроса

Всё, что в сигнатуре функции не входит в путь, FastAPI считает **параметрами запроса**: они приходят после `?` в адресе, пары `имя=значение` разделены `&`.

```python
@app.get("/books")
def search_books(q: str | None = None, limit: int = 2, available: bool = False):
    ...
```

- `limit: int = 2` — параметр со значением по умолчанию: в адресе его можно не писать, тогда он равен `2`. Запрос `?limit=5` даст `5`.
- `q: str | None = None` — необязательный параметр без значения по умолчанию. Запись `str | None` читается «строка или `None`»; если `q` нет в адресе, внутри функции будет `None`.
- Параметр без `= значение` (например, `limit: int`) — **обязательный**: без него сервер ответит `422`.
- `available: bool` понимает значения `true`, `1`, `yes`, `on` как «да» и `false`, `0`, `no`, `off` как «нет».
- В Python параметры без значения по умолчанию должны стоять раньше параметров со значением по умолчанию: так устроен язык.

### Ответ 404 для отсутствующей записи

Если записи с таким номером нет, обработчик должен ответить `404`, а не вернуть пустой результат с кодом `200`. Для этого выбрасывают исключение `HTTPException`.

```python
from fastapi import HTTPException

raise HTTPException(status_code=404, detail="Book not found")
```

- `from fastapi import HTTPException` — подключение класса;
- `raise` — выбросить исключение: функция останавливается, а FastAPI превращает его в ответ;
- `status_code=404` — код ответа;
- `detail="..."` — текст; клиент получит тело `{"detail": "Book not found"}`.

Пример. Книга по номеру и поиск с параметрами запроса. Четвёртый и пятый запросы показывают значения по умолчанию и разбор `bool`:

```python example
from fastapi import FastAPI, HTTPException

app = FastAPI()
BOOKS = {1: "Dune", 2: "Emma", 3: "Ubik"}


@app.get("/books/{book_id}")
def read_book(book_id: int):
    if book_id not in BOOKS:
        raise HTTPException(status_code=404, detail="Book not found")
    return {"id": book_id, "title": BOOKS[book_id]}


@app.get("/books")
def search_books(q: str | None = None, limit: int = 2, available: bool = False):
    titles = [t for t in BOOKS.values() if q is None or q.lower() in t.lower()]
    return {"q": q, "limit": limit, "available": available, "titles": titles[:limit]}
###
GET /books/2
###
GET /books/9
###
GET /books/abc
###
GET /books
###
GET /books?q=u&limit=5&available=yes
###
GET /books?limit=1.5
```

Результат запросов:

- `GET /books/2` — `200`, `{"id": 2, "title": "Emma"}`;
- `GET /books/9` — `404`, `{"detail": "Book not found"}`;
- `GET /books/abc` — `422`: `abc` не число;
- `GET /books` — `200`, `q` равно `null`, `limit` равно `2`, `available` равно `false`, `titles` — `["Dune", "Emma"]`;
- `GET /books?q=u&limit=5&available=yes` — `200`, `available` равно `true`, а `titles` — `["Dune", "Ubik"]` (в обоих есть буква `u`);
- `GET /books?limit=1.5` — `422`: `1.5` не целое число.

### Ограничения: Annotated, Path, Query

Тип проверяет только вид значения. Чтобы ограничить его дальше (номер не меньше `1`, лимит не больше `100`), используют `Path` для параметров пути и `Query` для параметров запроса, а подключают их через `Annotated`.

```python
from typing import Annotated

from fastapi import Path, Query


@app.get("/rooms/{room_id}")
def read_room(room_id: Annotated[int, Path(ge=1)]):
    ...


@app.get("/rooms")
def list_rooms(limit: Annotated[int, Query(ge=1, le=100)] = 10):
    ...
```

- `from typing import Annotated` — подключение из стандартной библиотеки.
- `Annotated[тип, Query(...)]` — «значение этого типа, и к нему дополнительные правила». Первым пишут тип, вторым — `Path(...)` или `Query(...)` с ограничениями.
- Значение по умолчанию остаётся после знака равенства: `... ] = 10`. У `Path` значения по умолчанию нет.
- `Path` нужен для параметров пути, `Query` — для параметров запроса. Подключаются они из `fastapi`.

Ограничения, которые можно передать:

- числа: `ge=1` (не меньше 1), `gt=0` (больше 0), `le=100` (не больше 100), `lt=100` (меньше 100);
- строки: `min_length=3`, `max_length=20` — границы длины;
- `pattern="^BK-[0-9]{4}$"` — регулярное выражение, которому должна подойти вся строка. В этом примере: `BK-` и четыре цифры. Знак `^` означает «начало строки», `$` — «конец», `[0-9]{4}` — ровно четыре цифры.

Если значение не подходит, обработчик не вызывается: клиент сразу получает `422`.

Чтобы не повторять один и тот же `Annotated` в нескольких обработчиках, его можно сохранить в переменную: `RoomId = Annotated[int, Path(ge=1)]`, а потом писать `room_id: RoomId`.

### Списки в запросе

Одно имя может встречаться в адресе несколько раз: `?tag=a&tag=b`. Чтобы получить все значения, пишут тип «список» и обязательно `Query()`.

```python
tag: Annotated[list[str] | None, Query()] = None
```

- `list[str]` — список строк; для чисел — `list[int]`;
- `Query()` без ограничений нужен именно здесь: без него FastAPI решил бы, что список лежит в теле запроса, а не в адресе;
- `= None` — параметр необязателен: если тегов нет, внутри будет `None`, а не пустой список.

### Тело ответа 422

Когда проверка не прошла, FastAPI отвечает кодом `422` и списком ошибок в поле `detail`. Пример со всеми ограничениями и разными ошибками:

```python example
from typing import Annotated

from fastapi import FastAPI, Path, Query

app = FastAPI()


@app.get("/lots/{lot_id}")
def read_lot(lot_id: Annotated[int, Path(ge=1)]):
    return {"id": lot_id}


@app.get("/lots")
def list_lots(
    limit: Annotated[int, Query(ge=1, le=10)] = 2,
    genre: str | None = None,
    tag: Annotated[list[str] | None, Query()] = None,
):
    return {"limit": limit, "genre": genre, "tag": tag}
###
GET /lots/7
###
GET /lots/0
###
GET /lots
###
GET /lots?limit=50&genre=sf&tag=a&tag=b
###
GET /lots?limit=5&genre=sf&tag=a&tag=b
```

Ответы:

- `GET /lots/7` — `200`, `{"id": 7}`;
- `GET /lots/0` — `422`;
- `GET /lots` — `200`, `{"limit": 2, "genre": null, "tag": null}`;
- `GET /lots?limit=50&genre=sf&tag=a&tag=b` — `422`;
- последний запрос — `200`, `{"limit": 5, "genre": "sf", "tag": ["a", "b"]}`.

Тело ответа на второй запрос (`/lots/0`):

```json
{"detail": [{"type": "greater_than_equal", "loc": ["path", "lot_id"], "msg": "Input should be greater than or equal to 1", "input": "0", "ctx": {"ge": 1}}]}
```

Как его читать:

- `detail` — список: ошибок может быть несколько, по одной на каждый неверный параметр;
- `loc` — **где** ошибка: первый элемент — место (`path`, `query`, `body`), второй — имя параметра. Здесь `["path", "lot_id"]`;
- `msg` — объяснение человеческим языком;
- `type` — короткое имя причины: `int_parsing` (не число), `greater_than_equal` (меньше допустимого), `less_than_equal` (больше допустимого), `missing` (параметр не передан), `string_pattern_mismatch` (не подошёл `pattern`);
- `input` — что именно прислал клиент.

Для запроса с `limit=50` в `loc` будет `["query", "limit"]`, а `type` — `less_than_equal`. По `loc` сразу видно, какой параметр исправить.

### Чего избегать: старая запись

В старых примерах ограничения пишут через значение по умолчанию: `limit: int = Query(10, ge=1)`. Эта запись работает, но в современной документации её заменил `Annotated`. Минусы старой записи: по умолчанию и ограничениям сложнее понять, где что, а функция перестаёт быть обычной функцией Python с нормальными значениями параметров. В новом коде пишите `limit: Annotated[int, Query(ge=1)] = 10`.

### Частые ошибки

- Тип не указан. Неверно: `def read(room_id):` и сравнение `room_id == 1`: `room_id` будет строкой `"1"`. Верно: `room_id: int`.
- Параметр запроса случайно обязателен. Неверно: `floor: int` — без `?floor=` приходит `422`. Верно: `floor: int | None = None`.
- Список без `Query()`. Неверно: `tag: list[str] | None = None`: FastAPI ждёт список в теле. Верно: `tag: Annotated[list[str] | None, Query()] = None`.
- Значение по умолчанию внутри `Annotated`. Неверно: `limit: Annotated[int, Query(ge=1)] = Query(10)`. Верно: `limit: Annotated[int, Query(ge=1)] = 10`.
- Параметр без значения после параметра со значением. Неверно: `def f(limit: int = 10, floor: int)` — это ошибка Python. Верно: сначала обязательные, потом необязательные.

### Шпаргалка

- `@app.get("/rooms/{room_id}")` и `room_id: int` — параметр пути; тип проверяется автоматически.
- Параметр не в пути — параметр запроса: `limit: int = 10`, `q: str | None = None`; без значения по умолчанию он обязателен.
- `raise HTTPException(status_code=404, detail="...")` — ответ `404` с телом `{"detail": "..."}`.
- `Annotated[int, Path(ge=1)]`, `Annotated[int, Query(ge=1, le=100)] = 10`.
- Ограничения: `ge`, `gt`, `le`, `lt`, `min_length`, `max_length`, `pattern`.
- Список в адресе: `Annotated[list[str] | None, Query()] = None`; `?tag=a&tag=b`.
- `422`: `detail` — список ошибок, `loc` — `["query", "имя"]` или `["path", "имя"]`.
- Старый стиль `= Query(10, ge=1)` — только чтобы узнавать его в чужом коде.

## task fa-room-by-id

```json
{
  "type": "fastapi",
  "title": "Комната по номеру",
  "xp": 10,
  "hints": [
    "Разделы «Параметры пути» и «Ответ 404 для отсутствующей записи».",
    "Путь `/rooms/{room_id}`, параметр `room_id: int`. Если номера нет в словаре `ROOMS`, выбросите `HTTPException` с кодом `404`.",
    "Шаблон: `@app.get(\"/rooms/{…}\")`, `def read_room(room_id: …):`, `room = ROOMS.get(room_id)`, `if room is None: raise HTTPException(status_code=…, detail=\"…\")`, `return room`."
  ],
  "wrong": {
    "str-id": "номер принимается как строка: `abc` не отклоняется с `422`, а существующие комнаты не находятся",
    "null-room": "для несуществующей комнаты возвращается `null` с кодом `200` вместо `404`"
  }
}
```

В сервисе бронирования есть комнаты. Они лежат в словаре `ROOMS`, ключ — номер комнаты. Добавьте маршрут `GET /rooms/{room_id}`:

- существующая комната: `200` и сама комната (например, `{"id": 2, "name": "Baikal", "floor": 1, "seats": 8}`);
- комнаты с таким номером нет: `404` и `{"detail": "Room not found"}`;
- номер не целое число (например, `/rooms/abc`): `422`, это должна обеспечить проверка типа.

```python starter
from fastapi import FastAPI, HTTPException

app = FastAPI()
ROOMS = {
    1: {"id": 1, "name": "Alpine", "floor": 1, "seats": 4},
    2: {"id": 2, "name": "Baikal", "floor": 1, "seats": 8},
    3: {"id": 3, "name": "Carpathian", "floor": 2, "seats": 6},
}


@app.get("/rooms/{…}")
def read_room(room_id: …):
    room = ROOMS.get(room_id)
    if room is None:
        raise HTTPException(status_code=…, detail="…")
    return room
```

```python solution
from fastapi import FastAPI, HTTPException

app = FastAPI()
ROOMS = {
    1: {"id": 1, "name": "Alpine", "floor": 1, "seats": 4},
    2: {"id": 2, "name": "Baikal", "floor": 1, "seats": 8},
    3: {"id": 3, "name": "Carpathian", "floor": 2, "seats": 6},
}


@app.get("/rooms/{room_id}")
def read_room(room_id: int):
    room = ROOMS.get(room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return room
```

```python wrong id=str-id
from fastapi import FastAPI, HTTPException

app = FastAPI()
ROOMS = {
    1: {"id": 1, "name": "Alpine", "floor": 1, "seats": 4},
    2: {"id": 2, "name": "Baikal", "floor": 1, "seats": 8},
    3: {"id": 3, "name": "Carpathian", "floor": 2, "seats": 6},
}


@app.get("/rooms/{room_id}")
def read_room(room_id: str):
    room = ROOMS.get(room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return room
```

```python wrong id=null-room
from fastapi import FastAPI

app = FastAPI()
ROOMS = {
    1: {"id": 1, "name": "Alpine", "floor": 1, "seats": 4},
    2: {"id": 2, "name": "Baikal", "floor": 1, "seats": 8},
    3: {"id": 3, "name": "Carpathian", "floor": 2, "seats": 6},
}


@app.get("/rooms/{room_id}")
def read_room(room_id: int):
    return ROOMS.get(room_id)
```

```http tests
GET /rooms/1
###
GET /rooms/2
###
GET /rooms/3
###
GET /rooms/9
###
GET /rooms/abc
```

## task fa-room-search

```json
{
  "type": "fastapi",
  "title": "Поиск комнаты с ограничениями",
  "xp": 15,
  "hints": [
    "Разделы «Параметры запроса» и «Ограничения: Annotated, Path, Query».",
    "Три параметра запроса: `min_seats` (по умолчанию 1, не меньше 1), `limit` (по умолчанию 10, от 1 до 50) и необязательный `floor`. Ограничения пишутся в `Query(...)` внутри `Annotated`.",
    "Шаблон: `floor: int | None = None`, `min_seats: Annotated[int, Query(ge=…)] = …`, `limit: Annotated[int, Query(ge=…, le=…)] = …`. Обязательные параметры стоят раньше необязательных, у `floor` значение по умолчанию есть, поэтому порядок свободный."
  ],
  "wrong": {
    "no-limits": "параметры принимаются без ограничений: `min_seats=0` и `limit=51` проходят вместо ответа `422`",
    "required-floor": "параметр `floor` сделан обязательным, и запрос без него получает `422`"
  }
}
```

Добавьте маршрут `GET /rooms` с поиском. Список комнат `ROOMS` уже есть, тело функции написано: нужно описать параметры запроса.

- `floor` — этаж, необязательный; если не указан, фильтра по этажу нет;
- `min_seats` — минимум мест, целое число не меньше `1`, по умолчанию `1`;
- `limit` — сколько комнат вернуть, целое число от `1` до `50`, по умолчанию `10`.

Значения вне диапазона или не числа должны давать `422`. Комнаты возвращаются в порядке списка `ROOMS`.

```python starter
from typing import Annotated

from fastapi import FastAPI, Query

app = FastAPI()
ROOMS = [
    {"id": 1, "name": "Alpine", "floor": 1, "seats": 4},
    {"id": 2, "name": "Baikal", "floor": 1, "seats": 8},
    {"id": 3, "name": "Carpathian", "floor": 2, "seats": 6},
    {"id": 4, "name": "Dolomite", "floor": 2, "seats": 12},
    {"id": 5, "name": "Elbrus", "floor": 3, "seats": 2},
]


@app.get("/rooms")
def search_rooms(
    floor: …,
    min_seats: Annotated[…, Query(…)] = …,
    limit: Annotated[…, Query(…)] = …,
):
    found = [r for r in ROOMS if r["seats"] >= min_seats and (floor is None or r["floor"] == floor)]
    return found[:limit]
```

```python solution
from typing import Annotated

from fastapi import FastAPI, Query

app = FastAPI()
ROOMS = [
    {"id": 1, "name": "Alpine", "floor": 1, "seats": 4},
    {"id": 2, "name": "Baikal", "floor": 1, "seats": 8},
    {"id": 3, "name": "Carpathian", "floor": 2, "seats": 6},
    {"id": 4, "name": "Dolomite", "floor": 2, "seats": 12},
    {"id": 5, "name": "Elbrus", "floor": 3, "seats": 2},
]


@app.get("/rooms")
def search_rooms(
    floor: int | None = None,
    min_seats: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
):
    found = [r for r in ROOMS if r["seats"] >= min_seats and (floor is None or r["floor"] == floor)]
    return found[:limit]
```

```python wrong id=no-limits
from fastapi import FastAPI

app = FastAPI()
ROOMS = [
    {"id": 1, "name": "Alpine", "floor": 1, "seats": 4},
    {"id": 2, "name": "Baikal", "floor": 1, "seats": 8},
    {"id": 3, "name": "Carpathian", "floor": 2, "seats": 6},
    {"id": 4, "name": "Dolomite", "floor": 2, "seats": 12},
    {"id": 5, "name": "Elbrus", "floor": 3, "seats": 2},
]


@app.get("/rooms")
def search_rooms(floor: int | None = None, min_seats: int = 1, limit: int = 10):
    found = [r for r in ROOMS if r["seats"] >= min_seats and (floor is None or r["floor"] == floor)]
    return found[:limit]
```

```python wrong id=required-floor
from typing import Annotated

from fastapi import FastAPI, Query

app = FastAPI()
ROOMS = [
    {"id": 1, "name": "Alpine", "floor": 1, "seats": 4},
    {"id": 2, "name": "Baikal", "floor": 1, "seats": 8},
    {"id": 3, "name": "Carpathian", "floor": 2, "seats": 6},
    {"id": 4, "name": "Dolomite", "floor": 2, "seats": 12},
    {"id": 5, "name": "Elbrus", "floor": 3, "seats": 2},
]


@app.get("/rooms")
def search_rooms(
    floor: int,
    min_seats: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
):
    found = [r for r in ROOMS if r["seats"] >= min_seats and (floor is None or r["floor"] == floor)]
    return found[:limit]
```

```http tests
GET /rooms
###
GET /rooms?floor=2
###
GET /rooms?min_seats=6
###
GET /rooms?min_seats=6&limit=2
###
GET /rooms?floor=3&min_seats=5
###
GET /rooms?min_seats=0
###
GET /rooms?limit=51
###
GET /rooms?limit=0
###
GET /rooms?floor=top
```

## task fa-booking-lookup

```json
{
  "type": "fastapi",
  "title": "Брони: список статусов и код",
  "xp": 15,
  "hints": [
    "Разделы «Списки в запросе» и «Ограничения: Annotated, Path, Query» (про `pattern`).",
    "Список статусов — `Annotated[list[str] | None, Query()] = None`. Код брони — параметр пути с `Path(pattern=...)`: `BK-` и четыре цифры.",
    "Шаблон: `status: Annotated[list[str] | None, Query()] = None` и `code: Annotated[str, Path(pattern=\"^BK-[0-9]{4}$\")]`. Для отсутствующей брони — `HTTPException` с кодом `404`."
  ],
  "wrong": {
    "single-status": "статус принимается как одна строка: при `?status=a&status=b` учитывается только последний",
    "no-pattern": "код брони не проверяется по шаблону: неверный формат даёт `404`, а нужен `422`"
  }
}
```

В сервисе бронирования есть словарь броней `BOOKINGS`, ключ — код брони. Нужны два маршрута:

- `GET /bookings` возвращает список броней в порядке словаря. Необязательный параметр запроса `status` может повторяться (`?status=confirmed&status=pending`): тогда нужны брони с любым из этих статусов. Без параметра — все брони;
- `GET /bookings/{code}` возвращает одну бронь. Код должен выглядеть как `BK-` и ровно четыре цифры, иначе `422`. Если код верный, но такой брони нет, — `404` и `{"detail": "Booking not found"}`.

```python starter
from typing import Annotated

from fastapi import FastAPI, HTTPException, Path, Query

app = FastAPI()
BOOKINGS = {
    "BK-1001": {"code": "BK-1001", "room": "Alpine", "status": "confirmed"},
    "BK-1002": {"code": "BK-1002", "room": "Baikal", "status": "pending"},
    "BK-1003": {"code": "BK-1003", "room": "Elbrus", "status": "cancelled"},
    "BK-1004": {"code": "BK-1004", "room": "Alpine", "status": "confirmed"},
}


@app.get("/bookings")
def list_bookings(status: …):
    items = list(BOOKINGS.values())
    if status:
        items = [b for b in items if b["status"] in status]
    return items


@app.get("/bookings/{code}")
def read_booking(code: …):
    booking = BOOKINGS.get(code)
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking not found")
    return booking
```

```python solution
from typing import Annotated

from fastapi import FastAPI, HTTPException, Path, Query

app = FastAPI()
BOOKINGS = {
    "BK-1001": {"code": "BK-1001", "room": "Alpine", "status": "confirmed"},
    "BK-1002": {"code": "BK-1002", "room": "Baikal", "status": "pending"},
    "BK-1003": {"code": "BK-1003", "room": "Elbrus", "status": "cancelled"},
    "BK-1004": {"code": "BK-1004", "room": "Alpine", "status": "confirmed"},
}


@app.get("/bookings")
def list_bookings(status: Annotated[list[str] | None, Query()] = None):
    items = list(BOOKINGS.values())
    if status:
        items = [b for b in items if b["status"] in status]
    return items


@app.get("/bookings/{code}")
def read_booking(code: Annotated[str, Path(pattern="^BK-[0-9]{4}$")]):
    booking = BOOKINGS.get(code)
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking not found")
    return booking
```

```python wrong id=single-status
from typing import Annotated

from fastapi import FastAPI, HTTPException, Path, Query

app = FastAPI()
BOOKINGS = {
    "BK-1001": {"code": "BK-1001", "room": "Alpine", "status": "confirmed"},
    "BK-1002": {"code": "BK-1002", "room": "Baikal", "status": "pending"},
    "BK-1003": {"code": "BK-1003", "room": "Elbrus", "status": "cancelled"},
    "BK-1004": {"code": "BK-1004", "room": "Alpine", "status": "confirmed"},
}


@app.get("/bookings")
def list_bookings(status: str | None = None):
    items = list(BOOKINGS.values())
    if status:
        items = [b for b in items if b["status"] == status]
    return items


@app.get("/bookings/{code}")
def read_booking(code: Annotated[str, Path(pattern="^BK-[0-9]{4}$")]):
    booking = BOOKINGS.get(code)
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking not found")
    return booking
```

```python wrong id=no-pattern
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query

app = FastAPI()
BOOKINGS = {
    "BK-1001": {"code": "BK-1001", "room": "Alpine", "status": "confirmed"},
    "BK-1002": {"code": "BK-1002", "room": "Baikal", "status": "pending"},
    "BK-1003": {"code": "BK-1003", "room": "Elbrus", "status": "cancelled"},
    "BK-1004": {"code": "BK-1004", "room": "Alpine", "status": "confirmed"},
}


@app.get("/bookings")
def list_bookings(status: Annotated[list[str] | None, Query()] = None):
    items = list(BOOKINGS.values())
    if status:
        items = [b for b in items if b["status"] in status]
    return items


@app.get("/bookings/{code}")
def read_booking(code: str):
    booking = BOOKINGS.get(code)
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking not found")
    return booking
```

```http tests
GET /bookings
###
GET /bookings?status=confirmed
###
GET /bookings?status=confirmed&status=pending
###
GET /bookings?status=unknown
###
GET /bookings/BK-1002
###
GET /bookings/BK-9999
###
GET /bookings/xyz
###
GET /bookings/bk-1002
```

## task fa-annotated-desks

```json
{
  "type": "refactor",
  "title": "Столы: переход на Annotated",
  "xp": 15,
  "hints": [
    "Разделы «Ограничения: Annotated, Path, Query» и «Чего избегать: старая запись».",
    "Перенесите ограничения из `= Query(...)` в `Annotated[тип, Query(...)]`, а значение по умолчанию оставьте после знака равенства. Не забудьте `from typing import Annotated`.",
    "Шаблон: `zone: Annotated[str | None, Query(min_length=…, max_length=…)] = None`, `limit: Annotated[int, Query(ge=…, le=…)] = …`, `offset: Annotated[int, Query(ge=…)] = …`."
  ],
  "check": {
    "static": [
      { "rule": "uses", "name": "Annotated", "message": "Опишите параметры через Annotated: Annotated[тип, Query(...)]." },
      { "rule": "pattern", "regex": "=\\s*Query\\(", "forbid": true, "message": "Старая запись `= Query(...)` не нужна: ограничения пишутся внутри Annotated, значение по умолчанию — после знака равенства." }
    ]
  },
  "wrong": {
    "lost-limit": "после переноса потерян верхний предел `limit`: значение больше 20 больше не отклоняется"
  }
}
```

Обработчик `GET /desks` рабочих мест написан в старом стиле: ограничения лежат в значениях по умолчанию. Перепишите сигнатуру через `Annotated`, поведение не меняйте:

- `zone` — необязательная строка длиной от `1` до `10` символов;
- `limit` — целое число от `1` до `20`, по умолчанию `5`;
- `offset` — целое число не меньше `0`, по умолчанию `0`.

Идея проверки: сначала проверяются правила кода (есть `Annotated`, нет `= Query(`), затем те же запросы отправляются в ваше приложение и в эталонное, а ответы сравниваются, включая то, какие параметры отклонены с `422`.

```python starter
from fastapi import FastAPI, Query

app = FastAPI()
DESKS = [
    {"id": 1, "zone": "A", "free": True},
    {"id": 2, "zone": "A", "free": False},
    {"id": 3, "zone": "B", "free": True},
    {"id": 4, "zone": "B", "free": True},
    {"id": 5, "zone": "C", "free": False},
    {"id": 6, "zone": "C", "free": True},
]


@app.get("/desks")
def list_desks(
    zone: str | None = Query(None, min_length=1, max_length=10),
    limit: int = Query(5, ge=1, le=20),
    offset: int = Query(0, ge=0),
):
    found = [d for d in DESKS if zone is None or d["zone"] == zone]
    return found[offset : offset + limit]
```

```python solution
from typing import Annotated

from fastapi import FastAPI, Query

app = FastAPI()
DESKS = [
    {"id": 1, "zone": "A", "free": True},
    {"id": 2, "zone": "A", "free": False},
    {"id": 3, "zone": "B", "free": True},
    {"id": 4, "zone": "B", "free": True},
    {"id": 5, "zone": "C", "free": False},
    {"id": 6, "zone": "C", "free": True},
]


@app.get("/desks")
def list_desks(
    zone: Annotated[str | None, Query(min_length=1, max_length=10)] = None,
    limit: Annotated[int, Query(ge=1, le=20)] = 5,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    found = [d for d in DESKS if zone is None or d["zone"] == zone]
    return found[offset : offset + limit]
```

```python wrong id=lost-limit
from typing import Annotated

from fastapi import FastAPI, Query

app = FastAPI()
DESKS = [
    {"id": 1, "zone": "A", "free": True},
    {"id": 2, "zone": "A", "free": False},
    {"id": 3, "zone": "B", "free": True},
    {"id": 4, "zone": "B", "free": True},
    {"id": 5, "zone": "C", "free": False},
    {"id": 6, "zone": "C", "free": True},
]


@app.get("/desks")
def list_desks(
    zone: Annotated[str | None, Query(min_length=1, max_length=10)] = None,
    limit: Annotated[int, Query(ge=1)] = 5,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    found = [d for d in DESKS if zone is None or d["zone"] == zone]
    return found[offset : offset + limit]
```

```http tests
GET /desks
###
GET /desks?zone=B
###
GET /desks?limit=2&offset=1
###
GET /desks?limit=0
###
GET /desks?limit=21
###
GET /desks?offset=-1
###
GET /desks?zone=ABCDEFGHIJK
```
