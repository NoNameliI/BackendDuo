# Блокировка цикла событий

Сервис бронирования переговорных на тестовых данных работает быстро. В день запуска приходит сотня клиентов, и все начинают жаловаться: даже простой `GET /health` отвечает по пять секунд. Виноват один обработчик, который ждёт ответа внешнего сервиса вызовом, не умеющим отдавать управление. Этот урок объясняет, как так получается, что именно блокирует сервер и как этого избежать.

### Цикл событий и один поток

Сервер с `async def`-обработчиками работает так. Один поток крутит **цикл событий**: берёт готовую к работе задачу, выполняет её до первого `await`, откладывает и берёт следующую. Тысячи запросов обслуживаются одним потоком, пока каждый из них время от времени говорит «я жду, займитесь другими».

- `await` — точка, где задача отдаёт управление циклу. Пока она ждёт ответа сети или паузы, поток занят чужими запросами.
- Вызов без `await` управление не отдаёт. Если он длится три секунды, поток три секунды занят только им, и все остальные запросы стоят.
- Такая остановка называется **блокировкой цикла событий**. Она касается всего процесса сервера, а не одного запроса.

### Что блокирует

Блокирует любой вызов, который долго занимает поток и не использует `await`:

- `time.sleep(...)` — пауза, которая ничего не отдаёт;
- `requests.get(...)` и любой другой синхронный сетевой клиент: поток ждёт ответа;
- синхронный драйвер базы данных или чтение большого файла;
- тяжёлые вычисления на Python: перебор миллиона записей, сжатие, подсчёт хешей в цикле.

Первые три ждут внешний мир, а поток при этом простаивает. Последний случай другой: поток честно считает, и никто, кроме него, ничего сделать не может.

### def и async def на практике

Правило из первого мира повторим и применим.

- `def` — FastAPI отправляет такую функцию в **пул потоков**. Блокировка остановит только её поток, цикл событий свободен. Так безопасно вызывать `requests`, синхронную базу и `time.sleep`.
- `async def` — функция работает прямо в цикле. Внутри допустимы только `await` на асинхронных вызовах и быстрые вычисления.

Типичная ловушка — поставить `async def` «на всякий случай» и вызвать внутри `requests.get`. Код выглядит современным, а работает хуже обычного `def`. Выбор прост: библиотека умеет `await` (асинхронный клиент `httpx.AsyncClient`, асинхронный драйвер базы) — пишите `async def` и `await`; библиотека обычная — пишите `def`.

Блокировка бывает спрятана глубже: `async def` вызывает вспомогательную функцию, а та — `time.sleep`. Для цикла это то же самое.

```python
def render_invoice(booking_id: int) -> dict:
    time.sleep(0.2)  # блокирует
    return {"id": booking_id}


@app.get("/bookings/{booking_id}/invoice")
async def invoice(booking_id: int):
    return render_invoice(booking_id)  # блокирует цикл
```

### Вынос в поток: run_in_threadpool

Иногда блокирующий код нужен внутри `async def`: например, обработчик ждёт два асинхронных вызова и ещё одну синхронную функцию. Тогда синхронную функцию выносят в пул потоков.

```python
from fastapi.concurrency import run_in_threadpool

result = await run_in_threadpool(функция, аргумент1, аргумент2)
```

- `run_in_threadpool` — функция FastAPI (на деле из Starlette), запускает обычную функцию в потоке и возвращает результат через `await`;
- первым идёт сама функция **без скобок**, дальше её аргументы через запятую;
- вызов нужно ждать через `await`: пока поток работает, цикл обслуживает других.

Тот же приём есть в стандартной библиотеке: `await asyncio.to_thread(функция, аргументы)`. Под капотом у `run_in_threadpool` лежит `anyio.to_thread.run_sync`.

Честно о студии: потоков здесь нет. `run_in_threadpool` в студии выполняет функцию на месте, а `time.sleep` действительно ждёт. Поэтому блокировку цикла студия не покажет и приём работает как обычный вызов. Ошибки находит проверка кода (разбор файла без запуска), как в первом мире. Тяжёлые вычисления потоки не ускоряют: в обычной сборке Python (из-за GIL) в каждый момент код Python выполняет один поток. Для них нужен отдельный процесс или очередь задач (следующие уроки).

```python example
import asyncio
import time

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool

app = FastAPI()


def build_pdf(room: str) -> str:
    time.sleep(0.05)
    return f"{room}.pdf"


@app.get("/rooms/{room}/pdf")
async def room_pdf(room: str):
    name = await run_in_threadpool(build_pdf, room)
    return {"file": name}


async def price(room: str) -> int:
    await asyncio.sleep(1)
    return 120 if room == "alpha" else 90


async def is_free(room: str) -> bool:
    await asyncio.sleep(1)
    return room != "beta"


@app.get("/rooms/{room}/offer")
async def offer(room: str):
    loop = asyncio.get_running_loop()
    started = loop.time()
    cost = await price(room)
    free = await is_free(room)
    return {"room": room, "price": cost, "free": free, "seconds": round(loop.time() - started, 1)}
###
GET /rooms/alpha/pdf
###
GET /rooms/alpha/offer
```

Первый запрос вернул `{"file": "alpha.pdf"}`: функция выполнена через `run_in_threadpool`. Во втором `seconds` равно `2.0`: две паузы по секунде шли друг за другом. Часы цикла в студии виртуальные (`asyncio.sleep` проходит мгновенно), но их показания честные: `loop.time()` продвигается на длину пауз, и разница видна.

### asyncio.gather: независимые операции вместе

Если два ожидания не зависят друг от друга, их запускают одновременно.

```python
первый, второй = await asyncio.gather(корутина1(), корутина2())
```

- `asyncio.gather(...)` принимает вызовы асинхронных функций (корутины), запускает их одновременно и ждёт все;
- результаты приходят **кортежем в том же порядке**, что и аргументы, поэтому их можно распаковать в переменные;
- `await` перед `gather` обязателен. Время равно самой долгой операции, а не сумме.

```python example
import asyncio

from fastapi import FastAPI

app = FastAPI()


async def price(room: str) -> int:
    await asyncio.sleep(1)
    return 120 if room == "alpha" else 90


async def is_free(room: str) -> bool:
    await asyncio.sleep(1)
    return room != "beta"


@app.get("/rooms/{room}/offer")
async def offer(room: str):
    loop = asyncio.get_running_loop()
    started = loop.time()
    cost, free = await asyncio.gather(price(room), is_free(room))
    return {"room": room, "price": cost, "free": free, "seconds": round(loop.time() - started, 1)}
###
GET /rooms/alpha/offer
###
GET /rooms/beta/offer
```

Теперь `seconds` равно `1.0`: обе паузы прошли одновременно. Для `beta` цена `90`, а `free` — `false`: порядок результатов совпадает с порядком аргументов.

### Таймаут: asyncio.wait_for

Внешний сервис может не ответить вовсе. Без ограничения запрос повиснет, а вместе с ним и ресурсы сервера. `asyncio.wait_for` ставит предел ожидания.

```python
try:
    результат = await asyncio.wait_for(корутина(), timeout=секунды)
except asyncio.TimeoutError:
    raise HTTPException(status_code=504, detail="сообщение")
```

- `wait_for(корутина(), timeout=1)` ждёт не дольше одной секунды;
- по истечении времени ожидание отменяется и возникает `asyncio.TimeoutError` (в современном Python это то же самое, что встроенное `TimeoutError`);
- исключение перехватывают и отвечают `504 Gateway Timeout`: «внешний сервис не ответил вовремя». Неперехваченное исключение стало бы `500`.

```python example
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI()


async def fetch_map(room: str) -> dict:
    await asyncio.sleep(0.1 if room == "alpha" else 30)
    return {"room": room, "floor": 2}


@app.get("/rooms/{room}/map")
async def room_map(room: str):
    try:
        return await asyncio.wait_for(fetch_map(room), timeout=1)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Map service timeout")
###
GET /rooms/alpha/map
###
GET /rooms/beta/map
```

Для `alpha` пришёл ответ `200` с этажом. Для `beta` пауза тридцать секунд длиннее таймаута: ответ `504` и `{"detail": "Map service timeout"}`. Ждать тридцать секунд не пришлось, потому что часы студии виртуальные.

### Частые ошибки

- `async def` с блокирующим клиентом. Неверно: `async def f(): requests.get(url)`. Верно: обычный `def`, либо `await` и асинхронный клиент, либо `await run_in_threadpool(requests.get, url)`.
- Скобки в `run_in_threadpool`. Неверно: `await run_in_threadpool(build_pdf(room))` — функция вызывается сразу, в потоке окажется её результат. Верно: `await run_in_threadpool(build_pdf, room)`.
- Последовательные `await` для независимого. Неверно: `a = await f(); b = await g()`, если `g` не нужен результат `f`. Верно: `a, b = await asyncio.gather(f(), g())`.
- Ожидание без предела. Неверно: `await fetch()` у внешнего сервиса. Верно: `await asyncio.wait_for(fetch(), timeout=…)` и ответ `504`.

### Шпаргалка

- Цикл событий — один поток; `await` отдаёт ему управление.
- Блокируют: `time.sleep`, `requests`, синхронная база, файлы, тяжёлые вычисления.
- Библиотека обычная — `def`; умеет `await` — `async def`.
- `await run_in_threadpool(функция, аргументы)` — обычная функция в потоке; в студии выполняется на месте.
- `a, b = await asyncio.gather(f(), g())` — одновременно, порядок результатов как у аргументов.
- `await asyncio.wait_for(корутина(), timeout=N)` и `except asyncio.TimeoutError` → `504`.
- Тяжёлые вычисления потоки не ускоряют: нужен процесс или очередь.

## task fa-gather-guest

```json
{
  "type": "fastapi",
  "title": "Сводка по гостю одним ожиданием",
  "xp": 15,
  "hints": [
    "Раздел «asyncio.gather: независимые операции вместе»: `await asyncio.gather(...)` запускает операции одновременно и возвращает результаты в порядке аргументов.",
    "Профиль и список бронирований не зависят друг от друга. Вызовите `load_profile(guest_id)` и `load_bookings(guest_id)` внутри одного `asyncio.gather`, результат распакуйте в две переменные.",
    "Шаблон: `profile, booking_ids = await asyncio.gather(load_profile(guest_id), …)`, затем `return {\"profile\": profile, \"booking_ids\": booking_ids}`."
  ],
  "check": {
    "code": [
      { "pattern": "asyncio\\.gather\\(", "message": "Две независимые загрузки нужно ждать вместе через asyncio.gather: последовательные await удвоят время ответа." }
    ]
  },
  "wrong": {
    "sequential": "две загрузки ждут по очереди двумя `await`: ответ верный, но время вдвое больше",
    "no-await": "`asyncio.gather` вызван без `await`: вместо результатов приходит объект ожидания"
  }
}
```

Сервис показывает сводку по гостю. Функции `load_profile` и `load_bookings` уже написаны и обе тратят секунду. Напишите обработчик `GET /guests/{guest_id}/summary`, который отвечает `200` и `{"profile": <словарь профиля>, "booking_ids": <список номеров>}`. Обе загрузки должны идти одновременно: проверка смотрит на ответы и требует `asyncio.gather` в коде.

```python starter
import asyncio

from fastapi import FastAPI

app = FastAPI(title="Booking")


async def load_profile(guest_id: int) -> dict:
    await asyncio.sleep(1)
    return {"id": guest_id, "name": f"Guest {guest_id}"}


async def load_bookings(guest_id: int) -> list[int]:
    await asyncio.sleep(1)
    return [guest_id * 10, guest_id * 10 + 1]


@app.get("/guests/{guest_id}/summary")
async def summary(guest_id: int):
    ...
```

```python solution
import asyncio

from fastapi import FastAPI

app = FastAPI(title="Booking")


async def load_profile(guest_id: int) -> dict:
    await asyncio.sleep(1)
    return {"id": guest_id, "name": f"Guest {guest_id}"}


async def load_bookings(guest_id: int) -> list[int]:
    await asyncio.sleep(1)
    return [guest_id * 10, guest_id * 10 + 1]


@app.get("/guests/{guest_id}/summary")
async def summary(guest_id: int):
    profile, booking_ids = await asyncio.gather(load_profile(guest_id), load_bookings(guest_id))
    return {"profile": profile, "booking_ids": booking_ids}
```

```python wrong id=sequential
import asyncio

from fastapi import FastAPI

app = FastAPI(title="Booking")


async def load_profile(guest_id: int) -> dict:
    await asyncio.sleep(1)
    return {"id": guest_id, "name": f"Guest {guest_id}"}


async def load_bookings(guest_id: int) -> list[int]:
    await asyncio.sleep(1)
    return [guest_id * 10, guest_id * 10 + 1]


@app.get("/guests/{guest_id}/summary")
async def summary(guest_id: int):
    profile = await load_profile(guest_id)
    booking_ids = await load_bookings(guest_id)
    return {"profile": profile, "booking_ids": booking_ids}
```

```python wrong id=no-await
import asyncio

from fastapi import FastAPI

app = FastAPI(title="Booking")


async def load_profile(guest_id: int) -> dict:
    await asyncio.sleep(1)
    return {"id": guest_id, "name": f"Guest {guest_id}"}


async def load_bookings(guest_id: int) -> list[int]:
    await asyncio.sleep(1)
    return [guest_id * 10, guest_id * 10 + 1]


@app.get("/guests/{guest_id}/summary")
async def summary(guest_id: int):
    profile, booking_ids = asyncio.gather(load_profile(guest_id), load_bookings(guest_id))
    return {"profile": profile, "booking_ids": booking_ids}
```

```http tests
GET /guests/1/summary
###
GET /guests/7/summary
```

## task fa-provider-timeout

```json
{
  "type": "fastapi",
  "title": "Таймаут ответа поставщика",
  "xp": 15,
  "hints": [
    "Раздел «Таймаут: asyncio.wait_for»: ожидание оборачивают в `asyncio.wait_for(..., timeout=...)`, а `asyncio.TimeoutError` превращают в `HTTPException`.",
    "Ждите `fetch_availability(provider)` не дольше одной секунды. При истечении времени отвечайте кодом `504` и `detail` `Provider timeout`. Медленный поставщик отвечает за пять секунд, быстрый — за доли секунды.",
    "Шаблон: `try: return await asyncio.wait_for(fetch_availability(provider), timeout=1)`, ниже `except asyncio.TimeoutError: raise HTTPException(status_code=504, detail=\"Provider timeout\")`."
  ],
  "wrong": {
    "no-catch": "таймаут есть, но исключение не перехвачено: клиент получает 500 вместо 504",
    "too-long": "предел ожидания десять секунд: медленный поставщик успевает ответить, а 504 не наступает"
  }
}
```

Сервис запрашивает свободные места у поставщика. Функция `fetch_availability(provider)` уже есть: быстрый поставщик (`fast`) отвечает за 0,2 секунды, медленный (`slow`) — за 5 секунд. Напишите обработчик `GET /availability/{provider}`:

- если ответ пришёл не позже чем через секунду, вернуть его как есть, код `200`;
- иначе ответить `504` и `{"detail": "Provider timeout"}`.

Идея проверки: запросы к быстрому и медленному поставщику уходят в ваш код и в эталон, сравниваются коды и тела.

```python starter
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI(title="Booking")


async def fetch_availability(provider: str) -> dict:
    await asyncio.sleep(0.2 if provider == "fast" else 5)
    return {"provider": provider, "free": 3}


@app.get("/availability/{provider}")
async def availability(provider: str):
    ...
```

```python solution
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI(title="Booking")


async def fetch_availability(provider: str) -> dict:
    await asyncio.sleep(0.2 if provider == "fast" else 5)
    return {"provider": provider, "free": 3}


@app.get("/availability/{provider}")
async def availability(provider: str):
    try:
        return await asyncio.wait_for(fetch_availability(provider), timeout=1)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Provider timeout")
```

```python wrong id=no-catch
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI(title="Booking")


async def fetch_availability(provider: str) -> dict:
    await asyncio.sleep(0.2 if provider == "fast" else 5)
    return {"provider": provider, "free": 3}


@app.get("/availability/{provider}")
async def availability(provider: str):
    return await asyncio.wait_for(fetch_availability(provider), timeout=1)
```

```python wrong id=too-long
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI(title="Booking")


async def fetch_availability(provider: str) -> dict:
    await asyncio.sleep(0.2 if provider == "fast" else 5)
    return {"provider": provider, "free": 3}


@app.get("/availability/{provider}")
async def availability(provider: str):
    try:
        return await asyncio.wait_for(fetch_availability(provider), timeout=10)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Provider timeout")
```

```http tests
GET /availability/fast
###
GET /availability/slow
```

## task fa-hidden-block

```json
{
  "type": "static",
  "title": "Блокировка в вспомогательной функции",
  "xp": 15,
  "hints": [
    "Раздел «def и async def на практике»: блокировка может быть спрятана в функции, которую вызывает `async def`.",
    "Обработчик `invoice` вызывает `render_invoice`, где стоит `time.sleep`. Либо сделайте обработчик обычным `def`, либо вынесите вызов в поток через `run_in_threadpool`. Пауза в `render_invoice` должна остаться.",
    "Шаблон: `def invoice(booking_id: int):` и `return render_invoice(booking_id)`; либо `async def invoice(...)` с `return await run_in_threadpool(render_invoice, booking_id)` и `from fastapi.concurrency import run_in_threadpool`."
  ],
  "check": {
    "static": [
      { "rule": "no-blocking-in-async", "message": "Обработчик async def вызывает функцию с блокирующим time.sleep: цикл событий остановится. Сделайте обработчик обычным def или вынесите вызов в поток." }
    ],
    "code": [
      { "pattern": "sleep\\(", "message": "Пауза в render_invoice изображает тяжёлую работу и должна остаться: измените способ вызова, а не удаляйте её." }
    ]
  },
  "wrong": {
    "alias": "обработчик остался `async def`, а пауза в помощнике подключена под другим именем (`from time import sleep as pause`)",
    "removed": "блокирующая пауза удалена вместе с работой помощника"
  }
}
```

Обработчик `GET /bookings/{booking_id}/invoice` готовит счёт: тяжёлая часть вынесена в функцию `render_invoice`, где `time.sleep` изображает работу. Из-за `async def` на настоящем сервере каждая выдача счёта остановит все запросы. Исправьте код, не убирая паузу. Проверка разбирает файл без запуска и ищет блокирующие вызовы в `async def` и в функциях, которые они вызывают.

```python starter
import time

from fastapi import FastAPI

app = FastAPI(title="Booking")


def render_invoice(booking_id: int) -> dict:
    time.sleep(0.2)
    return {"booking_id": booking_id, "total": 240}


@app.get("/bookings/{booking_id}/invoice")
async def invoice(booking_id: int):
    return render_invoice(booking_id)
```

```python solution
import time

from fastapi import FastAPI

app = FastAPI(title="Booking")


def render_invoice(booking_id: int) -> dict:
    time.sleep(0.2)
    return {"booking_id": booking_id, "total": 240}


@app.get("/bookings/{booking_id}/invoice")
def invoice(booking_id: int):
    return render_invoice(booking_id)
```

```python wrong id=alias
from time import sleep as pause

from fastapi import FastAPI

app = FastAPI(title="Booking")


def render_invoice(booking_id: int) -> dict:
    pause(0.2)
    return {"booking_id": booking_id, "total": 240}


@app.get("/bookings/{booking_id}/invoice")
async def invoice(booking_id: int):
    return render_invoice(booking_id)
```

```python wrong id=removed
from fastapi import FastAPI

app = FastAPI(title="Booking")


@app.get("/bookings/{booking_id}/invoice")
async def invoice(booking_id: int):
    return {"booking_id": booking_id, "total": 240}
```

## task fa-blocking-fix

```json
{
  "type": "choice",
  "title": "Как исправить блокирующий запрос",
  "hints": [
    "Разделы «Что блокирует» и «def и async def на практике».",
    "Верное исправление либо убирает обработчик из цикла событий (обычный `def` отправляется в пул потоков), либо заменяет вызов на асинхронный с `await`.",
    "Выбирайте варианты, где поток цикла перестаёт ждать сеть: обычный `def` и асинхронный клиент. `await` перед блокирующей функцией ничего не меняет, а `asyncio.sleep(0)` отдаёт управление один раз и не сокращает ожидание."
  ],
  "options": [
    "Переписать обработчик на обычный `def`: FastAPI запустит его в пуле потоков",
    "Заменить `requests.get` на асинхронный клиент (`httpx.AsyncClient`) и поставить `await`",
    "Поставить `await` перед `requests.get(...)`: так вызов станет асинхронным",
    "Добавить перед вызовом `await asyncio.sleep(0)`: цикл успеет обслужить других"
  ],
  "answer": [0, 1],
  "explanation": "Первые два варианта работают. Обычный `def` уходит в пул потоков: блокируется поток обработчика, а не цикл. Асинхронный клиент с `await` отдаёт управление на время ожидания. Третий вариант неверен: `await` можно ставить только перед асинхронным вызовом, а `requests.get` вернёт обычный ответ, и Python сообщит, что его нельзя ждать. Четвёртый тоже не помогает: `sleep(0)` отдаёт управление на мгновение, после чего `requests.get` снова держит поток до конца ответа."
}
```

Обработчик `async def` вызывает `requests.get(...)` для проверки стороннего сервиса. На настоящем сервере при нагрузке все запросы начинают тормозить. Какие исправления решают проблему? Выберите все верные.
