# APIRouter и структура проекта

Сервис бронирования начинался с одного файла `main.py`. Через месяц в нём двести строк: переговорные, брони, отчёты, проверки ключей. Найти нужный маршрут трудно, а два человека правят один файл и мешают друг другу. FastAPI даёт для этого **роутеры**: группы маршрутов, которые живут в своих файлах и подключаются к приложению одной строкой.

### APIRouter

`APIRouter` — это «мини-приложение»: у него те же декораторы `@router.get`, `@router.post`, но запускается оно только в составе `FastAPI`.

```python
router = APIRouter(prefix="/путь", tags=["группа"], dependencies=[Depends(функция)])


@router.get("/{id}")
def обработчик(id: int): ...


app.include_router(router)
```

- `prefix="/путь"` — общее начало адреса для всех маршрутов роутера. Начинается с `/`, на `/` не заканчивается. Маршрут `@router.get("")` с пустым путём отвечает ровно на `/путь`.
- `tags=["группа"]` — тег для документации: на странице `/docs` маршруты собраны в раздел.
- `dependencies=[Depends(функция)]` — зависимости, которые выполняются перед каждым маршрутом роутера. Это список: в нём можно перечислить несколько. Результат такой зависимости обработчику не передаётся, она нужна ради проверки (ключ, права).
- `app.include_router(router)` — подключает роутер. Без этой строки маршруты роутера в приложении не появятся, и запросы к ним получат `404`.

```python example
from fastapi import APIRouter, FastAPI, HTTPException

app = FastAPI()
router = APIRouter(prefix="/rooms", tags=["rooms"])
ROOMS = {1: "Alpha", 2: "Beta"}


@router.get("")
def list_rooms():
    return [{"id": number, "name": name} for number, name in ROOMS.items()]


@router.get("/{room_id}")
def read_room(room_id: int):
    if room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"id": room_id, "name": ROOMS[room_id]}


app.include_router(router)
###
GET /rooms
###
GET /rooms/2
###
GET /rooms/9
```

Ответы: список из двух переговорных, `{"id": 2, "name": "Beta"}` и `404` с `{"detail": "Room not found"}`. Адреса собраны из префикса и пути маршрута: `/rooms` + `""` и `/rooms` + `/{room_id}`.

### Префикс и зависимости при подключении

`include_router` тоже принимает `prefix`, `tags` и `dependencies`. Они добавляются к тем, что заданы в самом роутере. Так одну версию API выносят под общий адрес: `/api/v1`, не трогая сами роутеры.

```python example
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException

app = FastAPI()


def require_key(x_key: Annotated[str | None, Header()] = None) -> None:
    if x_key != "k-1":
        raise HTTPException(status_code=401, detail="Bad key")


reports = APIRouter(prefix="/reports", dependencies=[Depends(require_key)])


@reports.get("/daily")
def daily_report():
    return {"bookings": 12}


@app.get("/health")
def health():
    return {"ok": True}


app.include_router(reports, prefix="/api/v1")
###
GET /health
###
GET /api/v1/reports/daily
###
GET /api/v1/reports/daily
X-Key: k-1
###
GET /reports/daily
X-Key: k-1
```

Что произошло:

- `/health` остался вне роутера и открыт всем: `200`;
- без ключа `/api/v1/reports/daily` вернул `401`: зависимость роутера сработала до обработчика;
- с ключом — `200` и `{"bookings": 12}`;
- `/reports/daily` без `/api/v1` — `404`: после подключения с префиксом старого адреса нет.

### Проект из нескольких файлов

Типичная раскладка небольшого сервиса:

```text
booking/
├── main.py            приложение и подключение роутеров
├── schemas.py         модели pydantic
├── deps.py            зависимости и их псевдонимы
└── routers/
    ├── __init__.py    пустой файл: папка становится пакетом
    ├── rooms.py       router для /rooms
    └── bookings.py    router для /bookings
```

`main.py` — единственный файл, который знает обо всех роутерах:

```python
# main.py
from fastapi import FastAPI

from routers.bookings import router as bookings_router
from routers.rooms import router as rooms_router

app = FastAPI(title="Booking")
app.include_router(rooms_router)
app.include_router(bookings_router)
```

- `from routers.rooms import router` — «из файла `routers/rooms.py` возьми переменную `router`». Папки записываются через точку, `.py` не пишется.
- `as rooms_router` — другое имя, чтобы два `router` не перекрывали друг друга.
- В файле роутера: `from schemas import Room` и `from deps import StoreDep`. Это **абсолютные импорты**: путь отсчитывается от корня проекта, потому что приложение запускают из него (`fastapi dev main.py`). В студии корень проекта устроен так же.

### __init__.py и относительные импорты

- `__init__.py` — файл в папке, который делает её **пакетом**. Он может быть пустым. Python 3 умеет импортировать и папки без него, но с ним поведение предсказуемо во всех инструментах, поэтому файл создают всегда.
- **Относительный импорт** отсчитывается от текущего файла: `from .rooms import ROOMS` — «из соседнего файла `rooms.py` той же папки», `from ..schemas import Room` — «на уровень выше». Первая форма работает внутри `routers/`, вторая — только если пакет `routers` лежит внутри другого пакета.
- Если `routers` лежит прямо в корне проекта, то `..` выходит за пределы верхнего пакета, и Python отвечает ошибкой `ImportError: attempted relative import beyond top-level package`. Выход: абсолютный импорт `from schemas import Room`.

Правило для новичка: между файлами проекта используйте абсолютные импорты от корня; относительные нужны только для соседей внутри одной папки.

### Циклический импорт

Файл A импортирует файл B, а B импортирует A. Python начинает загружать `main.py`, на строке `from routers.bookings import router` переходит в `routers/bookings.py`, там встречает `from main import BOOKINGS` и возвращается в `main`, который ещё не дочитан и о `BOOKINGS` пока не знает. Результат:

```text
ImportError: cannot import name 'BOOKINGS' from partially initialized module 'main'
(most likely due to a circular import)
```

Лечение одно: стрелки зависимостей должны идти в одну сторону. Общее (хранилище, настройки, зависимости) выносят в третий файл, который сам ничего из них не импортирует:

```text
main.py ──► routers/bookings.py ──► storage.py
   └────────────────────────────────► storage.py
```

Откладывание импорта внутрь функции тоже убирает ошибку, но прячет проблему. Если вы видите `partially initialized module`, ищите общий код и выносите его в отдельный модуль.

### Рефакторинг: переезд маршрутов без смены поведения

Рефакторинг меняет устройство кода, но не поведение. Переезд маршрутов из `main.py` в роутер делается так:

1. Создайте `routers/имя.py`, в нём `router = APIRouter(prefix=..., tags=[...])`.
2. Перенесите обработчики, замените `@app.get("/rooms/...")` на `@router.get("/...")`: общее начало адреса ушло в `prefix`.
3. Перенесите данные и импорты, которые нужны только этим обработчикам.
4. В `main.py` добавьте `app.include_router(router)`.
5. Сравните список адресов: те же методы и пути, те же ответы.

Типичная ошибка при переезде — «двойной» префикс: если `prefix="/rooms"` стоит и в `APIRouter`, и в `include_router`, адрес превращается в `/rooms/rooms`.

### Частые ошибки

- Роутер не подключён. Неверно: `router = APIRouter()` и обработчики, но нет `app.include_router(router)`. Верно: подключить в `main.py`; иначе все запросы получают `404`.
- Двойной префикс. Неверно: `APIRouter(prefix="/rooms")` и `include_router(router, prefix="/rooms")`. Верно: префикс в одном месте.
- Цикл импортов. Неверно: роутер делает `from main import STORE`, а `main` импортирует роутер. Верно: `STORE` в отдельном модуле, и оба берут его оттуда.
- Слишком высокий относительный импорт. Неверно: `from ..schemas import Room` в `routers/rooms.py`. Верно: `from schemas import Room`.
- Слэш в конце префикса. Неверно: `prefix="/rooms/"`. Верно: `prefix="/rooms"`.

### Шпаргалка

- `router = APIRouter(prefix="/x", tags=["x"], dependencies=[Depends(f)])`.
- `@router.get("")` — ровно `/x`; `@router.get("/{id}")` — `/x/{id}`.
- `app.include_router(router)`; с `prefix`, `tags`, `dependencies` — они добавляются к уже заданным.
- Раскладка: `main.py`, `schemas.py`, `deps.py`, `routers/__init__.py`, `routers/*.py`.
- Импорты от корня: `from routers.rooms import router`, `from schemas import Room`.
- `__init__.py` — делает папку пакетом.
- Цикл `partially initialized module` лечится общим модулем.
- Рефакторинг: поведение и список маршрутов прежние.

## task fa-routers-split
```json
{
  "type": "refactor",
  "title": "Вынесите переговорные в роутер",
  "xp": 15,
  "hints": [
    "Раздел «Рефакторинг: переезд маршрутов без смены поведения»: общее начало адреса уходит в `prefix`, а в `main.py` остаётся `include_router`.",
    "Создайте `routers/rooms.py` с `router = APIRouter(prefix=\"/rooms\", tags=[\"rooms\"])`, перенесите туда данные `ROOMS` и три обработчика. `GET /health` остаётся в `main.py`.",
    "Шаблон: в `routers/rooms.py` — `@router.get(\"\")`, `@router.get(\"/{room_id}\")`, `@router.post(\"\", status_code=…)`; в `main.py` — `from routers.rooms import router` и `app.include_router(router)` без `prefix`."
  ],
  "readonly": ["schemas.py", "routers/__init__.py"],
  "check": {
    "static": [
      { "rule": "router", "file": "routers/rooms.py", "message": "Маршруты переговорных должны жить в routers/rooms.py: там нужен APIRouter с маршрутами, а main.py должен подключить его через include_router." }
    ]
  },
  "wrong": {
    "unchanged": "маршруты остались в main.py, роутера нет",
    "double-prefix": "префикс /rooms задан и в роутере, и при подключении: адреса стали /rooms/rooms"
  }
}
```
В `main.py` сервиса бронирования лежат четыре маршрута: `GET /health`, `GET /rooms`, `GET /rooms/{room_id}` и `POST /rooms`. Вынесите три маршрута переговорных в `routers/rooms.py` и подключите роутер, поведение менять нельзя.

Остаться должно всё как есть: те же адреса и методы, те же ответы и коды (`404` с `{"detail": "Room not found"}` для неизвестной переговорной, `201` при создании). Проверка сравнивает ответы на скрытые запросы со старым поведением и список маршрутов в документации, а ещё смотрит на структуру кода: в `routers/rooms.py` должен быть `APIRouter`, подключённый в `main.py`. Модели лежат в `schemas.py`, их менять не нужно.

```python starter path=main.py
from fastapi import FastAPI, HTTPException

from schemas import Room, RoomIn

app = FastAPI(title="Booking")
ROOMS: dict[int, Room] = {1: Room(id=1, name="Alpha", seats=4)}


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/rooms", tags=["rooms"])
def list_rooms() -> list[Room]:
    return list(ROOMS.values())


@app.get("/rooms/{room_id}", tags=["rooms"])
def read_room(room_id: int) -> Room:
    if room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    return ROOMS[room_id]


@app.post("/rooms", status_code=201, tags=["rooms"])
def create_room(data: RoomIn) -> Room:
    room = Room(id=max(ROOMS) + 1, **data.model_dump())
    ROOMS[room.id] = room
    return room
```

```python starter path=schemas.py
from pydantic import BaseModel, Field


class RoomIn(BaseModel):
    name: str = Field(min_length=1)
    seats: int = Field(gt=0)


class Room(RoomIn):
    id: int
```

```python starter path=routers/__init__.py
```

```python solution path=main.py
from fastapi import FastAPI

from routers.rooms import router as rooms_router

app = FastAPI(title="Booking")
app.include_router(rooms_router)


@app.get("/health")
def health():
    return {"ok": True}
```

```python solution path=schemas.py
from pydantic import BaseModel, Field


class RoomIn(BaseModel):
    name: str = Field(min_length=1)
    seats: int = Field(gt=0)


class Room(RoomIn):
    id: int
```

```python solution path=routers/__init__.py
```

```python solution path=routers/rooms.py
from fastapi import APIRouter, HTTPException

from schemas import Room, RoomIn

router = APIRouter(prefix="/rooms", tags=["rooms"])
ROOMS: dict[int, Room] = {1: Room(id=1, name="Alpha", seats=4)}


@router.get("")
def list_rooms() -> list[Room]:
    return list(ROOMS.values())


@router.get("/{room_id}")
def read_room(room_id: int) -> Room:
    if room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    return ROOMS[room_id]


@router.post("", status_code=201)
def create_room(data: RoomIn) -> Room:
    room = Room(id=max(ROOMS) + 1, **data.model_dump())
    ROOMS[room.id] = room
    return room
```

```python wrong id=unchanged path=main.py
from fastapi import FastAPI, HTTPException

from schemas import Room, RoomIn

app = FastAPI(title="Booking")
ROOMS: dict[int, Room] = {1: Room(id=1, name="Alpha", seats=4)}


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/rooms", tags=["rooms"])
def list_rooms() -> list[Room]:
    return list(ROOMS.values())


@app.get("/rooms/{room_id}", tags=["rooms"])
def read_room(room_id: int) -> Room:
    if room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    return ROOMS[room_id]


@app.post("/rooms", status_code=201, tags=["rooms"])
def create_room(data: RoomIn) -> Room:
    room = Room(id=max(ROOMS) + 1, **data.model_dump())
    ROOMS[room.id] = room
    return room
```

```python wrong id=double-prefix path=main.py
from fastapi import FastAPI

from routers.rooms import router as rooms_router

app = FastAPI(title="Booking")
app.include_router(rooms_router, prefix="/rooms")


@app.get("/health")
def health():
    return {"ok": True}
```

```python wrong id=double-prefix path=routers/rooms.py
from fastapi import APIRouter, HTTPException

from schemas import Room, RoomIn

router = APIRouter(prefix="/rooms", tags=["rooms"])
ROOMS: dict[int, Room] = {1: Room(id=1, name="Alpha", seats=4)}


@router.get("")
def list_rooms() -> list[Room]:
    return list(ROOMS.values())


@router.get("/{room_id}")
def read_room(room_id: int) -> Room:
    if room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    return ROOMS[room_id]


@router.post("", status_code=201)
def create_room(data: RoomIn) -> Room:
    room = Room(id=max(ROOMS) + 1, **data.model_dump())
    ROOMS[room.id] = room
    return room
```

```http tests
GET /health
###
GET /rooms
###
GET /rooms/1
###
GET /rooms/9
###
POST /rooms
Content-Type: application/json

{"name": "Gamma", "seats": 6}
###
GET /rooms
###
POST /rooms
Content-Type: application/json

{"name": "", "seats": 6}
```

## task fa-routers-bookings
```json
{
  "type": "fastapi",
  "title": "Брони за ключом доступа",
  "xp": 20,
  "hints": [
    "Разделы «APIRouter» и «Префикс и зависимости при подключении»: проверка ключа — это `dependencies=[Depends(require_key)]` в `APIRouter`, а общий адрес `/api/v1` — `prefix` в `include_router`.",
    "В `routers/bookings.py` укажите `prefix=\"/bookings\"`, `tags=[\"bookings\"]` и зависимость `require_key` из `deps.py`; в `main.py` подключите оба роутера с `prefix=\"/api/v1\"`.",
    "Шаблон: `router = APIRouter(prefix=…, tags=[…], dependencies=[Depends(…)])`, затем `app.include_router(bookings_router, prefix=\"/api/v1\")`."
  ],
  "readonly": ["schemas.py", "deps.py", "routers/__init__.py", "routers/rooms.py"],
  "wrong": {
    "no-router-dependency": "ключ не проверяется: роутер броней создан без dependencies",
    "not-included": "роутер броней не подключён, все адреса /api/v1/bookings отвечают 404"
  }
}
```
Переговорные уже вынесены в роутер `routers/rooms.py` и подключены. Осталось сделать брони. Все адреса сервиса начинаются с `/api/v1`.

Поведение:

- `GET /api/v1/rooms` и `GET /api/v1/rooms/{room_id}` открыты всем (готово);
- все маршруты `/api/v1/bookings` требуют заголовок `X-Key: k-1`, иначе `401` и `{"detail": "Bad key"}` (проверку делает готовая зависимость `require_key` из `deps.py`);
- `GET /api/v1/bookings` — список броней;
- `POST /api/v1/bookings` с телом `{"room_id": число, "guest": "имя"}` создаёт бронь и отвечает `201` с `{"id", "room_id", "guest"}`; если переговорной с таким номером нет, отвечает `404` и `{"detail": "Room not found"}`.

Маршруты броней уже написаны, но роутер не знает ни префикса, ни тега, ни проверки ключа, и `main.py` его не подключает. Проверку ключа ставьте на весь роутер, а не в каждый обработчик.

```python starter path=main.py
from fastapi import FastAPI

from routers.rooms import router as rooms_router

app = FastAPI(title="Booking")
app.include_router(rooms_router, prefix="/api/v1")
```

```python starter path=routers/bookings.py
from fastapi import APIRouter, HTTPException

from routers.rooms import ROOMS
from schemas import Booking, BookingIn

router = APIRouter()
BOOKINGS: list[Booking] = []


@router.get("")
def list_bookings() -> list[Booking]:
    return BOOKINGS


@router.post("", status_code=201)
def create_booking(data: BookingIn) -> Booking:
    if data.room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    booking = Booking(id=len(BOOKINGS) + 1, **data.model_dump())
    BOOKINGS.append(booking)
    return booking
```

```python starter path=routers/rooms.py
from fastapi import APIRouter, HTTPException

from schemas import Room

router = APIRouter(prefix="/rooms", tags=["rooms"])
ROOMS: dict[int, Room] = {1: Room(id=1, name="Alpha", seats=4), 2: Room(id=2, name="Beta", seats=8)}


@router.get("")
def list_rooms() -> list[Room]:
    return list(ROOMS.values())


@router.get("/{room_id}")
def read_room(room_id: int) -> Room:
    if room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    return ROOMS[room_id]
```

```python starter path=routers/__init__.py
```

```python starter path=deps.py
from typing import Annotated

from fastapi import Header, HTTPException


def require_key(x_key: Annotated[str | None, Header()] = None) -> None:
    if x_key != "k-1":
        raise HTTPException(status_code=401, detail="Bad key")
```

```python starter path=schemas.py
from pydantic import BaseModel, Field


class Room(BaseModel):
    id: int
    name: str
    seats: int


class BookingIn(BaseModel):
    room_id: int
    guest: str = Field(min_length=1)


class Booking(BookingIn):
    id: int
```

```python solution path=main.py
from fastapi import FastAPI

from routers.bookings import router as bookings_router
from routers.rooms import router as rooms_router

app = FastAPI(title="Booking")
app.include_router(rooms_router, prefix="/api/v1")
app.include_router(bookings_router, prefix="/api/v1")
```

```python solution path=routers/bookings.py
from fastapi import APIRouter, Depends, HTTPException

from deps import require_key
from routers.rooms import ROOMS
from schemas import Booking, BookingIn

router = APIRouter(prefix="/bookings", tags=["bookings"], dependencies=[Depends(require_key)])
BOOKINGS: list[Booking] = []


@router.get("")
def list_bookings() -> list[Booking]:
    return BOOKINGS


@router.post("", status_code=201)
def create_booking(data: BookingIn) -> Booking:
    if data.room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    booking = Booking(id=len(BOOKINGS) + 1, **data.model_dump())
    BOOKINGS.append(booking)
    return booking
```

```python solution path=routers/rooms.py
from fastapi import APIRouter, HTTPException

from schemas import Room

router = APIRouter(prefix="/rooms", tags=["rooms"])
ROOMS: dict[int, Room] = {1: Room(id=1, name="Alpha", seats=4), 2: Room(id=2, name="Beta", seats=8)}


@router.get("")
def list_rooms() -> list[Room]:
    return list(ROOMS.values())


@router.get("/{room_id}")
def read_room(room_id: int) -> Room:
    if room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    return ROOMS[room_id]
```

```python solution path=routers/__init__.py
```

```python solution path=deps.py
from typing import Annotated

from fastapi import Header, HTTPException


def require_key(x_key: Annotated[str | None, Header()] = None) -> None:
    if x_key != "k-1":
        raise HTTPException(status_code=401, detail="Bad key")
```

```python solution path=schemas.py
from pydantic import BaseModel, Field


class Room(BaseModel):
    id: int
    name: str
    seats: int


class BookingIn(BaseModel):
    room_id: int
    guest: str = Field(min_length=1)


class Booking(BookingIn):
    id: int
```

```python wrong id=no-router-dependency path=routers/bookings.py
from fastapi import APIRouter, HTTPException

from routers.rooms import ROOMS
from schemas import Booking, BookingIn

router = APIRouter(prefix="/bookings", tags=["bookings"])
BOOKINGS: list[Booking] = []


@router.get("")
def list_bookings() -> list[Booking]:
    return BOOKINGS


@router.post("", status_code=201)
def create_booking(data: BookingIn) -> Booking:
    if data.room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    booking = Booking(id=len(BOOKINGS) + 1, **data.model_dump())
    BOOKINGS.append(booking)
    return booking
```

```python wrong id=no-router-dependency path=main.py
from fastapi import FastAPI

from routers.bookings import router as bookings_router
from routers.rooms import router as rooms_router

app = FastAPI(title="Booking")
app.include_router(rooms_router, prefix="/api/v1")
app.include_router(bookings_router, prefix="/api/v1")
```

```python wrong id=not-included path=main.py
from fastapi import FastAPI

from routers.rooms import router as rooms_router

app = FastAPI(title="Booking")
app.include_router(rooms_router, prefix="/api/v1")
```

```http tests
GET /api/v1/rooms
###
GET /api/v1/bookings
###
GET /api/v1/bookings
X-Key: wrong
###
GET /api/v1/bookings
X-Key: k-1
###
POST /api/v1/bookings
X-Key: k-1
Content-Type: application/json

{"room_id": 2, "guest": "Ann"}
###
POST /api/v1/bookings
X-Key: k-1
Content-Type: application/json

{"room_id": 7, "guest": "Bob"}
###
POST /api/v1/bookings
Content-Type: application/json

{"room_id": 1, "guest": "Cat"}
###
GET /api/v1/bookings
X-Key: k-1
###
GET /bookings
X-Key: k-1
```

## task fa-routers-circular
```json
{
  "type": "fix-bug",
  "title": "Приложение не запускается: цикл импортов",
  "xp": 15,
  "hints": [
    "Раздел «Циклический импорт»: прочитайте сообщение об ошибке при запуске, в нём названы файл и имя, которое нельзя импортировать.",
    "`main.py` импортирует роутер, а роутер — список `BOOKINGS` из `main.py`. Общий список нужно вынести в третий файл, который ничего из проекта не импортирует.",
    "Шаблон: создайте `storage.py` с `BOOKINGS: list[dict] = []`, а в `main.py` и `routers/bookings.py` напишите `from storage import BOOKINGS`. Список должен остаться один: счётчик `/stats` считает те же брони."
  ],
  "readonly": ["routers/__init__.py"],
  "wrong": {
    "two-lists": "у роутера свой отдельный список, а /stats в main.py считает другой: счётчик остаётся нулевым"
  }
}
```
Сервис бронирования не стартует: при загрузке падает `ImportError`. В `main.py` подключён роутер из `routers/bookings.py` и есть маршрут `GET /stats` со счётчиком броней, а роутер хранит брони в списке `BOOKINGS`.

Исправьте проект так, чтобы он запускался и не потерял поведение: `POST /bookings` с телом `{"guest": "имя"}` отвечает `201` и `{"id": номер, "guest": "имя"}`, `GET /bookings` возвращает все брони, а `GET /stats` отвечает `{"bookings": число}` — число всех созданных броней. Список должен быть общим для роутера и `/stats`.

```python starter path=main.py
from fastapi import FastAPI

from routers.bookings import router

BOOKINGS: list[dict] = []

app = FastAPI(title="Booking")
app.include_router(router)


@app.get("/stats")
def stats():
    return {"bookings": len(BOOKINGS)}
```

```python starter path=routers/__init__.py
```

```python starter path=routers/bookings.py
from fastapi import APIRouter

from main import BOOKINGS

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.get("")
def list_bookings():
    return BOOKINGS


@router.post("", status_code=201)
def create_booking(data: dict):
    booking = {"id": len(BOOKINGS) + 1, "guest": data["guest"]}
    BOOKINGS.append(booking)
    return booking
```

```python solution path=main.py
from fastapi import FastAPI

from routers.bookings import router
from storage import BOOKINGS

app = FastAPI(title="Booking")
app.include_router(router)


@app.get("/stats")
def stats():
    return {"bookings": len(BOOKINGS)}
```

```python solution path=routers/__init__.py
```

```python solution path=routers/bookings.py
from fastapi import APIRouter

from storage import BOOKINGS

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.get("")
def list_bookings():
    return BOOKINGS


@router.post("", status_code=201)
def create_booking(data: dict):
    booking = {"id": len(BOOKINGS) + 1, "guest": data["guest"]}
    BOOKINGS.append(booking)
    return booking
```

```python solution path=storage.py
BOOKINGS: list[dict] = []
```

```python wrong id=two-lists path=routers/bookings.py
from fastapi import APIRouter

router = APIRouter(prefix="/bookings", tags=["bookings"])
BOOKINGS: list[dict] = []


@router.get("")
def list_bookings():
    return BOOKINGS


@router.post("", status_code=201)
def create_booking(data: dict):
    booking = {"id": len(BOOKINGS) + 1, "guest": data["guest"]}
    BOOKINGS.append(booking)
    return booking
```

```python wrong id=two-lists path=main.py
from fastapi import FastAPI

from routers.bookings import router

BOOKINGS: list[dict] = []

app = FastAPI(title="Booking")
app.include_router(router)


@app.get("/stats")
def stats():
    return {"bookings": len(BOOKINGS)}
```

```http tests
GET /stats
###
POST /bookings
Content-Type: application/json

{"guest": "Ann"}
###
POST /bookings
Content-Type: application/json

{"guest": "Bob"}
###
GET /bookings
###
GET /stats
```

## task fa-routers-imports
```json
{
  "type": "choice",
  "title": "Что случится с импортом",
  "xp": 10,
  "hints": [
    "Раздел «__init__.py и относительные импорты».",
    "Папка `routers` лежит прямо в корне проекта и сама является верхним пакетом. Подумайте, что находится «на уровень выше» неё.",
    "Выше верхнего пакета пакета нет, поэтому `..` туда выйти не может. Какая форма импорта работает всегда, если проект запускают из корня?"
  ],
  "options": [
    "Работает: `..` означает корневую папку проекта",
    "Ошибка `attempted relative import beyond top-level package`: выше пакета `routers` пакета нет",
    "Ошибка «модуль schemas не найден»: корень проекта не входит в пути поиска",
    "Работает, но только если удалить `routers/__init__.py`"
  ],
  "answer": [1],
  "explanation": "Относительный импорт отсчитывается от пакетов. `routers` — верхний пакет, и `..` из него выходит за его границы, поэтому Python сообщает об ошибке `attempted relative import beyond top-level package`. Корень проекта при запуске из него входит в пути поиска, значит, `from schemas import Booking` сработает; это и есть исправление. Удаление `__init__.py` ничего не меняет в этом правиле."
}
```
Проект лежит так: `main.py`, `schemas.py` и папка `routers/` с файлами `__init__.py` и `bookings.py`. Приложение запускают из корня командой `fastapi dev main.py`. В `routers/bookings.py` написана строка:

```python
from ..schemas import Booking
```

Что произойдёт при запуске?
