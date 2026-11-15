# Фоновые задачи

Интернет-магазин принимает заказ и должен отправить покупателю квитанцию. Отправка письма занимает секунды, а клиенту нужно ответить сразу: заказ принят. Делать письмо до ответа значит заставлять человека ждать то, что его не касается. Для небольших дел «после ответа» в FastAPI есть `BackgroundTasks`. Урок объясняет, как ими пользоваться, чем они ограничены и когда пора переходить к очереди задач.

### BackgroundTasks: что делать после ответа

Фоновая задача — обычная функция, которую сервер запускает **после** того, как ответ отправлен клиенту.

```python
from fastapi import BackgroundTasks


@app.post("/путь")
def обработчик(данные: Модель, background_tasks: BackgroundTasks):
    background_tasks.add_task(функция, аргумент1, аргумент2, имя=значение)
    return {...}
```

- `background_tasks: BackgroundTasks` — параметр с таким типом FastAPI подставляет сам: из запроса он не берётся и в документации не виден. Имя параметра любое, важен тип.
- `add_task(функция, ...)` — поставить задачу в очередь на выполнение после ответа. Первым идёт сама функция **без скобок**, дальше её аргументы: позиционные и именованные.
- Задача не запускается в момент `add_task`. Обработчик возвращает ответ, сервер отправляет его, и только потом вызывает функцию.
- Задач можно добавить несколько: они выполняются по очереди, в порядке добавления.
- Функция может быть и `def`, и `async def`. Обычную `def` настоящий сервер выполняет в пуле потоков, `async def` — в цикле событий; правила блокировки из предыдущего урока действуют и здесь.
- Возвращаемое значение задачи никуда не попадает: клиент его не получит.

Честно о студии: фоновые задачи выполняются здесь внутри того же вызова, сразу после тела ответа. Для следующего запроса результат уже виден, а `print` задачи попадает в вывод того запроса, который её добавил.

```python example
from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel

app = FastAPI()
RECEIPTS: list[str] = []


class Order(BaseModel):
    email: str
    total: int


def send_receipt(email: str, total: int) -> None:
    RECEIPTS.append(f"{email}: {total}")
    print("receipt sent to", email)


@app.post("/orders", status_code=201)
def create_order(order: Order, background_tasks: BackgroundTasks):
    background_tasks.add_task(send_receipt, order.email, total=order.total)
    return {"status": "accepted"}


@app.get("/receipts")
def list_receipts():
    return RECEIPTS
###
GET /receipts
###
POST /orders
Content-Type: application/json

{"email": "ann@example.com", "total": 40}
###
GET /receipts
```

Первый `GET /receipts` возвращает пустой список: задач ещё не было. `POST /orders` отвечает `201` и `{"status": "accepted"}`, а в выводе запроса видна строка `receipt sent to ann@example.com`: функция выполнилась после ответа. Второй `GET /receipts` вернул `["ann@example.com: 40"]`.

### Фоновая задача в зависимости

`BackgroundTasks` можно запросить и в зависимости. Это тот же объект, что получит обработчик: задачи из зависимости и из обработчика складываются в один список и выполняются после ответа. Так общую побочную работу (журнал посещений, аудит) подключают к нескольким маршрутам, не повторяя код.

```python
def track_view(request: Request, background_tasks: BackgroundTasks) -> None:
    background_tasks.add_task(count_view, request.url.path)
```

- `request: Request` — объект запроса (он уже встречался в мире 3, в уроках про lifespan и middleware); `request.url.path` — путь без параметров запроса, например `/products/7`;
- зависимость ничего не возвращает: её работа в том, чтобы поставить задачу;
- подключают её в декораторе: `@app.get("/products", dependencies=[Depends(track_view)])`, результат обработчику не нужен.

```python example
from fastapi import BackgroundTasks, Depends, FastAPI, Request

app = FastAPI()
VIEWS: dict[str, int] = {}


def count_view(path: str) -> None:
    VIEWS[path] = VIEWS.get(path, 0) + 1


def track_view(request: Request, background_tasks: BackgroundTasks) -> None:
    background_tasks.add_task(count_view, request.url.path)


@app.get("/products", dependencies=[Depends(track_view)])
def list_products():
    return ["tea", "coffee"]


@app.get("/products/{product_id}", dependencies=[Depends(track_view)])
def read_product(product_id: int):
    return {"id": product_id}


@app.get("/views")
def views():
    return VIEWS
###
GET /products
###
GET /products/7
###
GET /products
###
GET /views
```

Ответ последнего запроса: `{"/products": 2, "/products/7": 1}`. Сам `/views` подсчёт не включает: у него нет зависимости.

### Ошибки в фоновых задачах

К моменту выполнения задачи клиент уже получил ответ. Поэтому ошибка в задаче **не может изменить ответ**: клиент видит `201`, даже если письмо не ушло. Исключение попадёт в журнал сервера, и только там вы о нём узнаете.

Есть вторая неприятность: задачи идут по цепочке. Если задача упала с исключением, **следующие за ней задачи не выполняются**. Ошибка в письме лишит вас и записи в журнале аудита, добавленной после неё.

Что с этим делать:

- ловить ожидаемые ошибки внутри самой задачи (`try` / `except`) и записывать сбой туда, где его увидят: журнал, таблица «неудачных отправок», счётчик;
- не рассчитывать на то, что клиент узнает о сбое: ответ уже ушёл;
- важные вещи (деньги, склад) в фоновые задачи не отдавать: их нужно сделать до ответа или вынести в очередь с повторами.

```python example
from fastapi import BackgroundTasks, FastAPI

app = FastAPI()
SENT: list[str] = []
FAILED: list[str] = []
AUDIT: list[str] = []


def send_mail(email: str) -> None:
    try:
        if "@" not in email:
            raise ValueError("bad address")
        SENT.append(email)
    except ValueError as error:
        FAILED.append(f"{email}: {error}")


def write_audit(email: str) -> None:
    AUDIT.append(f"signup {email}")


@app.post("/signup", status_code=201)
def signup(email: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(send_mail, email)
    background_tasks.add_task(write_audit, email)
    return {"email": email}


@app.get("/report")
def report():
    return {"sent": SENT, "failed": FAILED, "audit": AUDIT}
###
POST /signup?email=nobody
###
GET /report
```

Адрес без `@` вызвал `ValueError` внутри `send_mail`, но задача сама поймала её и записала сбой в `FAILED`. Поэтому `write_audit` отработала, а `/report` вернул `{"sent": [], "failed": ["nobody: bad address"], "audit": ["signup nobody"]}`. Без `try` / `except` ошибка оборвала бы цепочку: записи в `audit` не было бы.

### Когда хватит BackgroundTasks, а когда нужна очередь

Подходит: короткая работа, потеря которой не страшна или поправима. Отправка уведомления, прогрев кеша, запись в журнал, пересчёт счётчика.

Не подходит, если важно хотя бы одно из этого:

- **Задача не должна пропасть.** `BackgroundTasks` живут в памяти процесса. Перезапуск сервера или падение процесса стирают всё, что ещё не выполнилось.
- **Нужны повторы.** Если письмо не ушло, сама задача не повторится: вам придётся писать повтор самим.
- **Работа долгая или тяжёлая.** Тяжёлые вычисления делят процесс с API и замедляют ответы. Лишний поток не ускоряет Python-код (урок о блокировке).
- **Нужно расписание или результат.** «Каждую ночь», «покажите прогресс выгрузки» фоновые задачи не умеют.
- **Серверов несколько.** Задача выполняется там, где принят запрос, и её нельзя передать другому исполнителю.

Тогда нужна **очередь задач**: обработчик кладёт описание работы в брокер сообщений, а отдельные процессы-исполнители (воркеры) берут её оттуда, повторяют при сбое и сообщают о результате. Для Python распространены Celery, RQ, arq и Dramatiq. В студии очередей и брокеров нет: идея разобрана в последнем уроке мира, там же ссылки на курсы по RabbitMQ и Kafka.

### Частые ошибки

- Скобки у функции. Неверно: `add_task(send_receipt(email, total))` — функция вызывается сразу, до ответа, а в `add_task` попадает её результат. Верно: `add_task(send_receipt, email, total)`.
- Важная работа в фоне. Неверно: списание денег в `add_task`: сбой не заметит ни клиент, ни сервер. Верно: сделать до ответа или отдать очереди с повторами.
- Ошибка не поймана. Неверно: задача без `try` / `except` падает и обрывает остальные. Верно: перехватить ожидаемое исключение и записать сбой.
- Блокировка в `async def`. Неверно: `async def` задача с `time.sleep` останавливает цикл. Верно: правила предыдущего урока.

### Шпаргалка

- `background_tasks: BackgroundTasks` в обработчике или зависимости; `add_task(функция, аргументы)` без скобок после имени функции.
- Выполняются после ответа, по очереди, в порядке добавления; возвращаемое значение теряется.
- Ошибка задачи не меняет ответ клиента и обрывает следующие задачи: ловите её внутри.
- В студии задача выполняется в том же вызове после тела ответа; `print` попадает в вывод запроса.
- Не хватает: нужна гарантия, повторы, расписание, тяжёлая работа, много серверов → очередь задач.

## task fa-bg-confirmation

```json
{
  "type": "fastapi",
  "title": "Подтверждение бронирования после ответа",
  "xp": 15,
  "hints": [
    "Раздел «BackgroundTasks: что делать после ответа»: параметр `BackgroundTasks` и `add_task(функция, аргументы)` без скобок.",
    "Обработчик `POST /bookings` создаёт бронь, ставит в фон `send_confirmation` с адресом и названием комнаты и сразу отвечает `201`. Запись в `OUTBOX` делает уже сама функция.",
    "Шаблон: параметр `background_tasks: BackgroundTasks`, затем `background_tasks.add_task(send_confirmation, data.email, data.room)` и `return {\"room\": data.room, \"status\": \"booked\"}`."
  ],
  "check": {
    "code": [
      { "pattern": "add_task\\(", "message": "Подтверждение нужно поставить в фон через background_tasks.add_task: отправка не должна задерживать ответ." }
    ]
  },
  "wrong": {
    "inline": "функция вызывается прямо в обработчике: письмо «отправлено» до ответа, фоновой задачи нет",
    "no-task": "подтверждение вообще не отправляется: `OUTBOX` остаётся пустым"
  }
}
```

Сервис бронирования переговорных должен подтверждать бронь письмом. Функция `send_confirmation(email, room)` уже есть: она добавляет строку в список `OUTBOX` (так студия изображает отправленные письма). Напишите `POST /bookings` с телом `{"email": ..., "room": ...}`:

- отвечает `201` и `{"room": <комната>, "status": "booked"}`;
- подтверждение отправляется **в фоновой задаче**, после ответа.

`GET /outbox` уже написан и показывает отправленные письма. Идея проверки: после запросов `POST /bookings` скрытый `GET /outbox` должен показать все подтверждения; кроме того, в коде ищется `add_task`.

```python starter
from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel

app = FastAPI(title="Booking")
OUTBOX: list[str] = []


class BookingIn(BaseModel):
    email: str
    room: str


def send_confirmation(email: str, room: str) -> None:
    OUTBOX.append(f"to {email}: room {room} is booked")


@app.get("/outbox")
def outbox():
    return OUTBOX


@app.post("/bookings", status_code=201)
def create_booking(data: BookingIn, background_tasks: BackgroundTasks):
    ...
```

```python solution
from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel

app = FastAPI(title="Booking")
OUTBOX: list[str] = []


class BookingIn(BaseModel):
    email: str
    room: str


def send_confirmation(email: str, room: str) -> None:
    OUTBOX.append(f"to {email}: room {room} is booked")


@app.get("/outbox")
def outbox():
    return OUTBOX


@app.post("/bookings", status_code=201)
def create_booking(data: BookingIn, background_tasks: BackgroundTasks):
    background_tasks.add_task(send_confirmation, data.email, data.room)
    return {"room": data.room, "status": "booked"}
```

```python wrong id=inline
from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel

app = FastAPI(title="Booking")
OUTBOX: list[str] = []


class BookingIn(BaseModel):
    email: str
    room: str


def send_confirmation(email: str, room: str) -> None:
    OUTBOX.append(f"to {email}: room {room} is booked")


@app.get("/outbox")
def outbox():
    return OUTBOX


@app.post("/bookings", status_code=201)
def create_booking(data: BookingIn, background_tasks: BackgroundTasks):
    send_confirmation(data.email, data.room)
    return {"room": data.room, "status": "booked"}
```

```python wrong id=no-task
from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel

app = FastAPI(title="Booking")
OUTBOX: list[str] = []


class BookingIn(BaseModel):
    email: str
    room: str


def send_confirmation(email: str, room: str) -> None:
    OUTBOX.append(f"to {email}: room {room} is booked")


@app.get("/outbox")
def outbox():
    return OUTBOX


@app.post("/bookings", status_code=201)
def create_booking(data: BookingIn, background_tasks: BackgroundTasks):
    return {"room": data.room, "status": "booked"}
```

```http tests
GET /outbox
###
POST /bookings
Content-Type: application/json

{"email": "ann@example.com", "room": "Alpha"}
###
POST /bookings
Content-Type: application/json

{"email": "bob@example.com", "room": "Beta"}
###
GET /outbox
```

## task fa-bg-dependency

```json
{
  "type": "fastapi",
  "title": "Счётчик просмотров комнат в зависимости",
  "xp": 15,
  "hints": [
    "Раздел «Фоновая задача в зависимости»: зависимость принимает `BackgroundTasks` и `Request` и ставит задачу, а маршруты подключают её через `dependencies=[Depends(...)]`.",
    "Напишите `track_view(request, background_tasks)`: она ставит в фон `count_view` с путём `request.url.path`. Подключите зависимость к `GET /rooms` и `GET /rooms/{room_id}`, но не к `GET /stats`.",
    "Шаблон: `def track_view(request: Request, background_tasks: BackgroundTasks) -> None:` и `background_tasks.add_task(count_view, request.url.path)`; в декораторах — `dependencies=[Depends(track_view)]`."
  ],
  "wrong": {
    "only-list": "зависимость подключена только к списку: просмотры отдельных комнат не считаются",
    "stats-counted": "зависимость подключена и к `/stats`: счётчик считает и обращения к самой статистике"
  }
}
```

В сервисе бронирования нужно считать просмотры. Функция `count_view(path)` увеличивает счётчик пути в словаре `VIEWS`. Маршруты `GET /rooms`, `GET /rooms/{room_id}` и `GET /stats` уже написаны. Допишите зависимость `track_view` и подключите её так, чтобы:

- каждый запрос к `/rooms` и `/rooms/{room_id}` увеличивал счётчик своего пути (например, `/rooms/2`) в фоновой задаче;
- `GET /stats` отвечал `{"views": {...}}` с накопленными счётчиками и сам не считался.

Идея проверки: серия запросов к комнатам и затем `GET /stats`; сравниваются ответы со счётчиками.

```python starter
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request

app = FastAPI(title="Booking")
VIEWS: dict[str, int] = {}
ROOMS = {1: "Alpha", 2: "Beta"}


def count_view(path: str) -> None:
    VIEWS[path] = VIEWS.get(path, 0) + 1


def track_view(…) -> None:
    …


@app.get("/rooms")
def list_rooms():
    return [{"id": room_id, "name": name} for room_id, name in ROOMS.items()]


@app.get("/rooms/{room_id}")
def read_room(room_id: int):
    if room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"id": room_id, "name": ROOMS[room_id]}


@app.get("/stats")
def stats():
    return {"views": VIEWS}
```

```python solution
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request

app = FastAPI(title="Booking")
VIEWS: dict[str, int] = {}
ROOMS = {1: "Alpha", 2: "Beta"}


def count_view(path: str) -> None:
    VIEWS[path] = VIEWS.get(path, 0) + 1


def track_view(request: Request, background_tasks: BackgroundTasks) -> None:
    background_tasks.add_task(count_view, request.url.path)


@app.get("/rooms", dependencies=[Depends(track_view)])
def list_rooms():
    return [{"id": room_id, "name": name} for room_id, name in ROOMS.items()]


@app.get("/rooms/{room_id}", dependencies=[Depends(track_view)])
def read_room(room_id: int):
    if room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"id": room_id, "name": ROOMS[room_id]}


@app.get("/stats")
def stats():
    return {"views": VIEWS}
```

```python wrong id=only-list
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request

app = FastAPI(title="Booking")
VIEWS: dict[str, int] = {}
ROOMS = {1: "Alpha", 2: "Beta"}


def count_view(path: str) -> None:
    VIEWS[path] = VIEWS.get(path, 0) + 1


def track_view(request: Request, background_tasks: BackgroundTasks) -> None:
    background_tasks.add_task(count_view, request.url.path)


@app.get("/rooms", dependencies=[Depends(track_view)])
def list_rooms():
    return [{"id": room_id, "name": name} for room_id, name in ROOMS.items()]


@app.get("/rooms/{room_id}")
def read_room(room_id: int):
    if room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"id": room_id, "name": ROOMS[room_id]}


@app.get("/stats")
def stats():
    return {"views": VIEWS}
```

```python wrong id=stats-counted
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request

app = FastAPI(title="Booking")
VIEWS: dict[str, int] = {}
ROOMS = {1: "Alpha", 2: "Beta"}


def count_view(path: str) -> None:
    VIEWS[path] = VIEWS.get(path, 0) + 1


def track_view(request: Request, background_tasks: BackgroundTasks) -> None:
    background_tasks.add_task(count_view, request.url.path)


@app.get("/rooms", dependencies=[Depends(track_view)])
def list_rooms():
    return [{"id": room_id, "name": name} for room_id, name in ROOMS.items()]


@app.get("/rooms/{room_id}", dependencies=[Depends(track_view)])
def read_room(room_id: int):
    if room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"id": room_id, "name": ROOMS[room_id]}


@app.get("/stats", dependencies=[Depends(track_view)])
def stats():
    return {"views": VIEWS}
```

```http tests
GET /rooms
###
GET /rooms/2
###
GET /rooms
###
GET /rooms/9
###
GET /stats
###
GET /stats
```

## task fa-bg-chain

```json
{
  "type": "fix-bug",
  "title": "Сбой письма оборвал журнал",
  "xp": 20,
  "hints": [
    "Раздел «Ошибки в фоновых задачах»: исключение в задаче обрывает следующие задачи, и клиент о нём не узнает.",
    "Функция `send_mail` падает на адресе без `@`, и `write_audit`, поставленная следом, не выполняется. Поймайте ошибку внутри `send_mail` и запишите сбой в `FAILED`.",
    "Шаблон: внутри `send_mail` — `try:` с проверкой и `SENT.append(email)`, затем `except ValueError as error:` и `FAILED.append(f\"{email}: {error}\")`."
  ],
  "wrong": {
    "swallow": "ошибка перехвачена, но сбой нигде не записан: в `FAILED` пусто",
    "audit-first": "порядок задач поменян: журнал пишется, а сбой письма по-прежнему никуда не попадает"
  }
}
```

`POST /signup?email=...` принимает адрес, ставит в фон отправку письма (`send_mail`) и запись в журнал (`write_audit`) и отвечает `201`. `GET /report` показывает три списка: `sent` (отправленные), `failed` (сбои) и `audit` (журнал).

Для адреса без `@` `send_mail` падает с `ValueError`. Из-за этого `write_audit` не выполняется, а сбой нигде не записан. Исправьте код так, чтобы для плохого адреса:

- ответ по-прежнему был `201`;
- в `failed` появлялась строка вида `nobody: bad address` (адрес, двоеточие, текст ошибки);
- журнал `audit` получал запись `signup nobody`.

Для нормального адреса всё остаётся как есть: он попадает в `sent`, а в журнале появляется `signup ann@example.com`.

```python starter
from fastapi import BackgroundTasks, FastAPI

app = FastAPI(title="Booking")
SENT: list[str] = []
FAILED: list[str] = []
AUDIT: list[str] = []


def send_mail(email: str) -> None:
    if "@" not in email:
        raise ValueError("bad address")
    SENT.append(email)


def write_audit(email: str) -> None:
    AUDIT.append(f"signup {email}")


@app.post("/signup", status_code=201)
def signup(email: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(send_mail, email)
    background_tasks.add_task(write_audit, email)
    return {"email": email}


@app.get("/report")
def report():
    return {"sent": SENT, "failed": FAILED, "audit": AUDIT}
```

```python solution
from fastapi import BackgroundTasks, FastAPI

app = FastAPI(title="Booking")
SENT: list[str] = []
FAILED: list[str] = []
AUDIT: list[str] = []


def send_mail(email: str) -> None:
    try:
        if "@" not in email:
            raise ValueError("bad address")
        SENT.append(email)
    except ValueError as error:
        FAILED.append(f"{email}: {error}")


def write_audit(email: str) -> None:
    AUDIT.append(f"signup {email}")


@app.post("/signup", status_code=201)
def signup(email: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(send_mail, email)
    background_tasks.add_task(write_audit, email)
    return {"email": email}


@app.get("/report")
def report():
    return {"sent": SENT, "failed": FAILED, "audit": AUDIT}
```

```python wrong id=swallow
from fastapi import BackgroundTasks, FastAPI

app = FastAPI(title="Booking")
SENT: list[str] = []
FAILED: list[str] = []
AUDIT: list[str] = []


def send_mail(email: str) -> None:
    try:
        if "@" not in email:
            raise ValueError("bad address")
        SENT.append(email)
    except ValueError:
        pass


def write_audit(email: str) -> None:
    AUDIT.append(f"signup {email}")


@app.post("/signup", status_code=201)
def signup(email: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(send_mail, email)
    background_tasks.add_task(write_audit, email)
    return {"email": email}


@app.get("/report")
def report():
    return {"sent": SENT, "failed": FAILED, "audit": AUDIT}
```

```python wrong id=audit-first
from fastapi import BackgroundTasks, FastAPI

app = FastAPI(title="Booking")
SENT: list[str] = []
FAILED: list[str] = []
AUDIT: list[str] = []


def send_mail(email: str) -> None:
    if "@" not in email:
        raise ValueError("bad address")
    SENT.append(email)


def write_audit(email: str) -> None:
    AUDIT.append(f"signup {email}")


@app.post("/signup", status_code=201)
def signup(email: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(write_audit, email)
    background_tasks.add_task(send_mail, email)
    return {"email": email}


@app.get("/report")
def report():
    return {"sent": SENT, "failed": FAILED, "audit": AUDIT}
```

```http tests
POST /signup?email=ann@example.com
###
POST /signup?email=nobody
###
GET /report
```

## task fa-bg-queue

```json
{
  "type": "choice",
  "title": "Хватит ли BackgroundTasks",
  "hints": [
    "Раздел «Когда хватит BackgroundTasks, а когда нужна очередь».",
    "Фоновые задачи живут в памяти процесса: при перезапуске всё невыполненное пропадает, повторов и расписания у них нет.",
    "Ищите случаи, где работу нельзя терять или нужно повторять. Короткая запись в журнал и пересчёт счётчика к таким не относятся."
  ],
  "options": [
    "Выгрузка отчёта на 20 минут, о которой пользователь запрашивает прогресс",
    "Запись строки в журнал посещений после ответа",
    "Списание денег за бронь, которое нельзя потерять при перезапуске сервера",
    "Отправка письма «Спасибо за заказ»: если оно не уйдёт, ничего страшного не случится"
  ],
  "answer": [0, 2],
  "explanation": "Очередь нужна там, где работа долгая, её прогресс или результат надо отслеживать (выгрузка отчёта) и где задачу нельзя терять (списание денег): `BackgroundTasks` живут в памяти процесса и пропадают при перезапуске. Запись в журнал и необязательное письмо — короткие дела, потеря которых не критична: для них `BackgroundTasks` достаточно."
}
```

Для каких задач одних `BackgroundTasks` недостаточно и нужна очередь задач? Выберите все подходящие варианты.
