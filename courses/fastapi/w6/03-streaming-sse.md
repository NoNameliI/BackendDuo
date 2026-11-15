# Потоковые ответы и SSE

Магазин выгружает заказы за год: миллион строк. Собрать их в один список, превратить в текст и отдать целиком значит занять сотни мегабайт памяти и заставить клиента ждать, пока всё будет готово. Лучше отдавать данные по мере чтения, строка за строкой. А если сервер должен сам сообщать клиенту новости (статус заказа, ход выгрузки), нужен поток событий. В уроке разберём оба случая: `StreamingResponse` и формат SSE.

### StreamingResponse: ответ частями

`StreamingResponse` принимает **генератор** и отправляет клиенту всё, что он выдаёт, по мере выдачи. Генератор — функция с `yield`: каждый `yield` отдаёт очередную порцию, после чего функция «замирает» до следующего запроса порции (подробнее — в уроке о генераторах в мире 0).

```python
from fastapi.responses import StreamingResponse


def порции():
    yield "первая порция\n"
    yield "вторая порция\n"


@app.get("/путь")
def обработчик():
    return StreamingResponse(порции(), media_type="тип", headers={"Имя": "значение"})
```

- `StreamingResponse` — класс из `fastapi.responses`; обработчик возвращает его объект вместо словаря;
- первый аргумент — генератор, вызванный **со скобками**: `порции()`. Он выдаёт строки или байты;
- `media_type` — значение заголовка `Content-Type`: для таблицы `text/csv`, для потока событий `text/event-stream`, для обычного текста `text/plain`;
- `headers` — словарь дополнительных заголовков (необязательно);
- генератор может быть обычным (`def` с `yield`) или асинхронным (`async def` с `yield` и `await`): в асинхронном можно ждать через `await asyncio.sleep(...)`.

Заголовка `Content-Length` у потока нет: полный размер заранее неизвестен. Для скачивания файла браузеру подсказывают имя: заголовок `Content-Disposition: attachment; filename=orders.csv`.

Честно о студии: здесь поток не идёт «вживую». Студия собирает все порции в одно тело и показывает его целиком; число порций видно как `chunks`. Время (паузы между порциями) в студии виртуальное. Проверки сравнивают итоговое тело, а не моменты прихода порций.

```python example
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI()
ORDERS = [(1, "tea", 2), (2, "coffee", 1), (3, "cocoa", 5)]


def order_lines(min_qty: int):
    yield "id,product,qty\n"
    for order_id, product, qty in ORDERS:
        if qty >= min_qty:
            yield f"{order_id},{product},{qty}\n"


@app.get("/orders/export")
def export_orders(min_qty: int = 0):
    return StreamingResponse(
        order_lines(min_qty),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=orders.csv"},
    )
###
GET /orders/export
###
GET /orders/export?min_qty=2
```

Первый ответ — полная таблица `id,product,qty` и три строки. Во втором остались заказы с количеством от двух: `1,tea,2` и `3,cocoa,5`. В заголовках `content-type: text/csv; charset=utf-8` и имя файла в `content-disposition`. Запрос с `?min_qty=2` показывает ещё одно удобство: генератор фильтрует на ходу, не строя промежуточный список.

### SSE: события от сервера

**SSE** (Server-Sent Events, события от сервера) — простой стандарт: клиент открывает один обычный запрос `GET`, а сервер не закрывает его и присылает события, когда они появляются. Браузер читает такой поток встроенным объектом `EventSource`. В отличие от WebSocket (следующий урок), данные идут только в одну сторону: от сервера к клиенту.

Формат — обычный текст. Событие — несколько строк `поле: значение`, **заканчивающихся пустой строкой**.

```text
event: имя_события
data: {"любой": "текст, чаще JSON"}
id: 1

```

- `data:` — содержимое события; обязательное поле. Несколько строк `data:` подряд склеиваются в одно значение;
- `event:` — имя события: на него подписывается клиент (`addEventListener("status", ...)`). Без него событие получает имя `message`;
- `id:` — номер события; при обрыве связи браузер при переподключении присылает последний полученный номер в заголовке `Last-Event-ID`, и сервер может продолжить с этого места;
- `retry:` — через сколько миллисекунд клиенту переподключаться;
- строка с `:` в начале — комментарий, клиент его игнорирует; такие строки используют как «пинг», чтобы соединение не закрыл прокси;
- **пустая строка завершает событие**. Без неё браузер не увидит событие, и это самая частая ошибка.

Руками это делают через `StreamingResponse` с типом `text/event-stream`:

```python example
import asyncio
import json

from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI()


async def progress(job: str):
    for percent in (30, 70, 100):
        await asyncio.sleep(1)
        yield f"event: progress\ndata: {json.dumps({'job': job, 'percent': percent})}\n\n"


@app.get("/jobs/{job}/events")
async def job_events(job: str):
    return StreamingResponse(
        progress(job),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )
###
GET /jobs/export/events
```

Тело ответа — три события подряд, между ними пустые строки:

```text
event: progress
data: {"job": "export", "percent": 30}

event: progress
data: {"job": "export", "percent": 70}

event: progress
data: {"job": "export", "percent": 100}

```

`json.dumps(...)` превращает словарь в строку JSON. На настоящем сервере события приходили бы с паузой в секунду; студия показывает итоговый текст.

### EventSourceResponse и ServerSentEvent

Ручная сборка строк подходит для понимания формата, но в современном FastAPI (с версии 0.135) для событий есть готовый класс. Обработчик сам становится генератором, а FastAPI превращает каждое значение в событие.

```python
from collections.abc import AsyncIterable

from fastapi.sse import EventSourceResponse, ServerSentEvent


@app.get("/путь", response_class=EventSourceResponse)
async def обработчик() -> AsyncIterable[ServerSentEvent]:
    yield ServerSentEvent(data=значение, event="имя", id="1")
```

- `response_class=EventSourceResponse` в декораторе включает режим SSE: заголовок `Content-Type: text/event-stream` ставится сам;
- в теле обработчика стоит `yield`, а не `return`: каждый `yield` — одно событие;
- `ServerSentEvent(...)` — событие с полями: `data` (любое значение, которое можно превратить в JSON: словарь, список, модель Pydantic), `event`, `id`, `retry` (число), `comment`;
- `raw_data="текст"` вместо `data` отправляет текст **без** кодирования в JSON: так отправляют строки журнала или условный маркер конца `[DONE]`. `data` и `raw_data` одновременно нельзя;
- если `yield` выдаёт просто значение (словарь, модель), оно уходит как `data:` без имени события;
- тип результата `AsyncIterable[ServerSentEvent]` (из `collections.abc`) подсказывает документации, что обработчик выдаёт события; для обычной `def` с `yield` подходит `Iterable[...]`;
- FastAPI сам ставит заголовки `Cache-Control: no-cache` и `X-Accel-Buffering: no`, а при долгом молчании присылает комментарий `: ping`.

```python example
import asyncio
from collections.abc import AsyncIterable

from fastapi import FastAPI
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel

app = FastAPI()


class Reading(BaseModel):
    sensor: str
    celsius: float


READINGS = [Reading(sensor="s1", celsius=21.5), Reading(sensor="s1", celsius=22.0)]


@app.get("/temperature/stream", response_class=EventSourceResponse)
async def temperature() -> AsyncIterable[ServerSentEvent]:
    for number, reading in enumerate(READINGS, start=1):
        await asyncio.sleep(1)
        yield ServerSentEvent(data=reading, event="reading", id=str(number))
    yield ServerSentEvent(raw_data="[DONE]", event="done")
###
GET /temperature/stream
```

Ответ состоит из трёх событий, порядок полей в тексте задаёт FastAPI (`event`, затем `data`, `id`):

```text
event: reading
data: {"sensor":"s1","celsius":21.5}
id: 1

event: reading
data: {"sensor":"s1","celsius":22.0}
id: 2

event: done
data: [DONE]

```

Модель `Reading` превратилась в JSON, а `[DONE]` ушло как есть, потому что отправлено через `raw_data`. Заголовки ответа: `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache`, `x-accel-buffering: no`.

### Заголовки потока и поведение при обрыве

- `Content-Type` — `text/event-stream` для событий, нужный тип данных для остального.
- `Cache-Control: no-cache` — поток не должен кешироваться: каждое подключение получает свежие данные. `EventSourceResponse` ставит его сам, а при ручной сборке его нужно добавить в `headers`.
- `X-Accel-Buffering: no` — просьба к обратному прокси nginx не накапливать ответ: без неё он может держать события и отдать клиенту пачкой. `EventSourceResponse` добавляет его сам.
- Если клиент закрыл соединение, сервер перестаёт читать генератор. Ресурсы, которые генератор держит (файл, соединение с базой), освобождайте в блоке `finally`.
- Клиентом может быть `curl -N` (флаг `-N` отключает буфер) или `EventSource` в браузере. В студии эти программы не запускаются.

```sh
curl -N http://127.0.0.1:8000/temperature/stream
```

### Частые ошибки

- Нет пустой строки в конце события. Неверно: `yield "data: готово\n"`. Верно: `yield "data: готово\n\n"`.
- Генератор не вызван. Неверно: `StreamingResponse(order_lines, ...)` — передана сама функция. Верно: `StreamingResponse(order_lines(), ...)`.
- Весь файл в памяти. Неверно: собрать все строки в список и вернуть `"".join(...)` для большой выгрузки. Верно: `yield` по строкам.
- Не тот тип. Неверно: `media_type="text/plain"` для событий: браузер не распознает поток. Верно: `text/event-stream`.
- Кеширование потока. Неверно: поток без `Cache-Control: no-cache` при ручной сборке. Верно: добавить заголовок в `headers`.

### Шпаргалка

- `StreamingResponse(генератор(), media_type="…", headers={…})`: ответ частями; генератор — `def` или `async def` с `yield`.
- Студия собирает поток целиком; `chunks` — число порций; время виртуальное.
- Событие SSE: строки `event:`, `data:`, `id:`, `retry:` и **пустая строка** в конце; `: текст` — комментарий.
- Ручной SSE: `media_type="text/event-stream"`, `Cache-Control: no-cache`.
- Современный способ: `response_class=EventSourceResponse`, `yield ServerSentEvent(data=…, event=…, id=…)`; `raw_data` без JSON; заголовки ставятся сами.
- Скачивание: `Content-Disposition: attachment; filename=…`.

## task fa-stream-csv

```json
{
  "type": "fastapi",
  "title": "Выгрузка бронирований в CSV",
  "xp": 15,
  "hints": [
    "Раздел «StreamingResponse: ответ частями»: генератор с `yield`, `media_type` и заголовки в `headers`.",
    "Напишите генератор строк: сначала `id,room,guest\\n`, затем по строке на бронь. Если передан `room`, оставляйте только брони этой комнаты. Отдайте его через `StreamingResponse` с типом `text/csv` и заголовком `Content-Disposition`.",
    "Шаблон: `def lines(room):` с `yield \"id,room,guest\\n\"` и циклом `for … in BOOKINGS:` с `yield f\"{…},{…},{…}\\n\"`; в обработчике — `return StreamingResponse(lines(room), media_type=\"text/csv\", headers={\"Content-Disposition\": \"attachment; filename=bookings.csv\"})`."
  ],
  "check": {
    "headers": ["content-type", "content-disposition"]
  },
  "wrong": {
    "as-json": "отдаёт список JSON вместо текстовой таблицы",
    "no-filename": "таблица верна, но нет заголовка `Content-Disposition` с именем файла"
  }
}
```

В списке `BOOKINGS` лежат брони `(id, комната, гость)`. Напишите `GET /bookings/export` с необязательным параметром запроса `room`:

- ответ `200` — текст CSV: первая строка `id,room,guest`, затем по строке `id,комната,гость` на каждую бронь в порядке списка, каждая строка заканчивается `\n`;
- если передан `room`, в таблицу попадают только брони этой комнаты;
- тип ответа `text/csv`, заголовок `Content-Disposition: attachment; filename=bookings.csv`;
- ответ отдаётся потоком, из генератора.

Идея проверки: тело сравнивается как текст, плюс заголовки `content-type` и `content-disposition`.

```python starter
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI(title="Booking")
BOOKINGS = [(1, "Alpha", "ann"), (2, "Beta", "bob"), (3, "Alpha", "cy")]


@app.get("/bookings/export")
def export_bookings(room: str | None = None):
    ...
```

```python solution
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI(title="Booking")
BOOKINGS = [(1, "Alpha", "ann"), (2, "Beta", "bob"), (3, "Alpha", "cy")]


def lines(room: str | None):
    yield "id,room,guest\n"
    for booking_id, booking_room, guest in BOOKINGS:
        if room is None or booking_room == room:
            yield f"{booking_id},{booking_room},{guest}\n"


@app.get("/bookings/export")
def export_bookings(room: str | None = None):
    return StreamingResponse(
        lines(room),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=bookings.csv"},
    )
```

```python wrong id=as-json
from fastapi import FastAPI

app = FastAPI(title="Booking")
BOOKINGS = [(1, "Alpha", "ann"), (2, "Beta", "bob"), (3, "Alpha", "cy")]


@app.get("/bookings/export")
def export_bookings(room: str | None = None):
    return [list(b) for b in BOOKINGS if room is None or b[1] == room]
```

```python wrong id=no-filename
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI(title="Booking")
BOOKINGS = [(1, "Alpha", "ann"), (2, "Beta", "bob"), (3, "Alpha", "cy")]


def lines(room: str | None):
    yield "id,room,guest\n"
    for booking_id, booking_room, guest in BOOKINGS:
        if room is None or booking_room == room:
            yield f"{booking_id},{booking_room},{guest}\n"


@app.get("/bookings/export")
def export_bookings(room: str | None = None):
    return StreamingResponse(lines(room), media_type="text/csv")
```

```http tests
GET /bookings/export
###
GET /bookings/export?room=Alpha
###
GET /bookings/export?room=Nowhere
```

## task fa-sse-feed

```json
{
  "type": "fastapi",
  "title": "Поток статусов комнаты",
  "xp": 20,
  "hints": [
    "Раздел «EventSourceResponse и ServerSentEvent»: `response_class=EventSourceResponse`, `yield ServerSentEvent(...)`, `raw_data` для маркера конца.",
    "Обработчик должен быть генератором: для каждого статуса комнаты выдайте событие `status` с `data={\"room\": room_id, \"status\": статус}` и `id` по порядку с единицы, в конце — событие `done` с `raw_data=\"[DONE]\"`. Для неизвестной комнаты статусов нет, остаётся только `done`.",
    "Шаблон: `@app.get(\"/rooms/{room_id}/events\", response_class=EventSourceResponse)`, `async def … -> AsyncIterable[ServerSentEvent]:`, цикл `for number, status in enumerate(STATUSES.get(room_id, []), start=1):` и `yield ServerSentEvent(data={…}, event=\"status\", id=str(number))`."
  ],
  "check": {
    "headers": ["content-type", "cache-control", "x-accel-buffering"]
  },
  "wrong": {
    "no-event-name": "события без имени `status`: клиент не сможет подписаться на них",
    "by-hand": "поток собран вручную через `StreamingResponse`: тело верное, но нет заголовка `X-Accel-Buffering`"
  }
}
```

В `STATUSES` лежат истории статусов комнат. Напишите `GET /rooms/{room_id}/events`, который отвечает потоком SSE:

- на каждый статус комнаты по порядку — событие с именем `status`, данными `{"room": <id>, "status": <статус>}` и номером `id` (строка `"1"`, `"2"`, …);
- в конце — событие с именем `done` и данными `[DONE]` без кодирования в JSON;
- для комнаты без истории выдаётся только событие `done`.

Используйте `EventSourceResponse` и `ServerSentEvent`. Идея проверки: сравнивается текст потока и заголовки `content-type`, `cache-control`, `x-accel-buffering`.

```python starter
import asyncio
from collections.abc import AsyncIterable

from fastapi import FastAPI
from fastapi.sse import EventSourceResponse, ServerSentEvent

app = FastAPI(title="Booking")
STATUSES = {1: ["free", "booked", "free"], 2: ["booked"]}


@app.get("/rooms/{room_id}/events")
async def room_events(room_id: int):
    ...
```

```python solution
import asyncio
from collections.abc import AsyncIterable

from fastapi import FastAPI
from fastapi.sse import EventSourceResponse, ServerSentEvent

app = FastAPI(title="Booking")
STATUSES = {1: ["free", "booked", "free"], 2: ["booked"]}


@app.get("/rooms/{room_id}/events", response_class=EventSourceResponse)
async def room_events(room_id: int) -> AsyncIterable[ServerSentEvent]:
    for number, status in enumerate(STATUSES.get(room_id, []), start=1):
        await asyncio.sleep(0.1)
        yield ServerSentEvent(data={"room": room_id, "status": status}, event="status", id=str(number))
    yield ServerSentEvent(raw_data="[DONE]", event="done")
```

```python wrong id=no-event-name
import asyncio
from collections.abc import AsyncIterable

from fastapi import FastAPI
from fastapi.sse import EventSourceResponse, ServerSentEvent

app = FastAPI(title="Booking")
STATUSES = {1: ["free", "booked", "free"], 2: ["booked"]}


@app.get("/rooms/{room_id}/events", response_class=EventSourceResponse)
async def room_events(room_id: int) -> AsyncIterable[ServerSentEvent]:
    for number, status in enumerate(STATUSES.get(room_id, []), start=1):
        await asyncio.sleep(0.1)
        yield ServerSentEvent(data={"room": room_id, "status": status}, id=str(number))
    yield ServerSentEvent(raw_data="[DONE]", event="done")
```

```python wrong id=by-hand
import asyncio
import json

from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI(title="Booking")
STATUSES = {1: ["free", "booked", "free"], 2: ["booked"]}


async def feed(room_id: int):
    for number, status in enumerate(STATUSES.get(room_id, []), start=1):
        await asyncio.sleep(0.1)
        payload = json.dumps({"room": room_id, "status": status}, separators=(",", ":"))
        yield f"event: status\ndata: {payload}\nid: {number}\n\n"
    yield "event: done\ndata: [DONE]\n\n"


@app.get("/rooms/{room_id}/events")
async def room_events(room_id: int):
    return StreamingResponse(feed(room_id), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
```

```http tests
GET /rooms/1/events
###
GET /rooms/2/events
###
GET /rooms/9/events
```

## task fa-sse-fix

```json
{
  "type": "fix-bug",
  "title": "Браузер не видит события",
  "xp": 15,
  "hints": [
    "Разделы «SSE: события от сервера» и «Заголовки потока»: событие заканчивается пустой строкой, тип ответа `text/event-stream`, поток не кешируют.",
    "В коде три ошибки: после события стоит один `\\n`, тип ответа `text/plain` и нет заголовка `Cache-Control`. Исправьте все три.",
    "Шаблон: `yield f\"id: {number}\\nevent: status\\ndata: {status}\\n\\n\"`, `media_type=\"text/event-stream\"`, `headers={\"Cache-Control\": \"no-cache\"}`."
  ],
  "check": {
    "headers": ["content-type", "cache-control"]
  },
  "wrong": {
    "only-blank-line": "пустая строка после события есть, но тип ответа и заголовок кеширования не исправлены",
    "no-cache-missing": "тип и разделитель исправлены, но поток по-прежнему без `Cache-Control`"
  }
}
```

Сервис бронирования отдаёт ленту статусов комнаты потоком событий: на каждый статус — событие `status` с номером `id` (с единицы) и данными в виде самого статуса (например, `free`). Браузерный `EventSource` ничего не получает. Найдите и исправьте ошибки: событие должно быть корректным, тип ответа — потоком событий, а кеширование потока выключено (`Cache-Control: no-cache`).

```python starter
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI(title="Booking")
STATUSES = ["free", "booked", "free"]


def feed():
    for number, status in enumerate(STATUSES, start=1):
        yield f"id: {number}\nevent: status\ndata: {status}\n"


@app.get("/status-feed")
def status_feed():
    return StreamingResponse(feed(), media_type="text/plain")
```

```python solution
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI(title="Booking")
STATUSES = ["free", "booked", "free"]


def feed():
    for number, status in enumerate(STATUSES, start=1):
        yield f"id: {number}\nevent: status\ndata: {status}\n\n"


@app.get("/status-feed")
def status_feed():
    return StreamingResponse(feed(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
```

```python wrong id=only-blank-line
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI(title="Booking")
STATUSES = ["free", "booked", "free"]


def feed():
    for number, status in enumerate(STATUSES, start=1):
        yield f"id: {number}\nevent: status\ndata: {status}\n\n"


@app.get("/status-feed")
def status_feed():
    return StreamingResponse(feed(), media_type="text/plain")
```

```python wrong id=no-cache-missing
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI(title="Booking")
STATUSES = ["free", "booked", "free"]


def feed():
    for number, status in enumerate(STATUSES, start=1):
        yield f"id: {number}\nevent: status\ndata: {status}\n\n"


@app.get("/status-feed")
def status_feed():
    return StreamingResponse(feed(), media_type="text/event-stream")
```

```http tests
GET /status-feed
```

## task fa-stream-choice

```json
{
  "type": "choice",
  "title": "Что верно про потоки и SSE",
  "hints": [
    "Весь урок; особенно «StreamingResponse: ответ частями» и «SSE: события от сервера».",
    "Проверяйте каждое утверждение отдельно: что даёт генератор, чем заканчивается событие SSE, видит ли студия время между порциями.",
    "Верны утверждения про экономию памяти, про пустую строку и про кеширование. Студия собирает поток целиком, поэтому утверждение про «вживую» неверно."
  ],
  "options": [
    "Генератор позволяет отдавать большую выгрузку частями, не собирая её целиком в памяти",
    "Событие SSE заканчивается пустой строкой; без неё клиент его не получит",
    "В студии события приходят по одному, с паузами, как на настоящем сервере",
    "Поток событий не должен кешироваться, поэтому ставят `Cache-Control: no-cache`"
  ],
  "answer": [0, 1, 3],
  "explanation": "Первое верно: генератор выдаёт строки по одной, и сервер отправляет их по мере готовности. Второе верно: пустая строка — признак конца события. Третье неверно: студия собирает все порции в одно тело, паузы виртуальные, клиент видит результат целиком. Четвёртое верно: кешированный поток означал бы устаревшие или повторные события."
}
```

Выберите все верные утверждения.
