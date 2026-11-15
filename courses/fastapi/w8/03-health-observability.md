# Проверки здоровья, request-id и журналы

В два часа ночи у сервиса бронирования пропали подтверждения. Балансировщик продолжает отправлять запросы на упавшую копию приложения, потому что не знает, что она не работает. Разработчик открывает журнал и видит тысячи строк без привязки к конкретному запросу: какая из них относится к жалобе клиента, непонятно. Продакшен-сервису нужны три вещи: адреса, по которым автоматика узнаёт его состояние, идентификатор запроса, который сквозь все строки журнала связывает события одного обращения, и журнал в формате, который читает не только человек, но и программа.

### Живость и готовность: /health и /ready

Оркестраторы и балансировщики регулярно опрашивают сервис по HTTP и решают, что с ним делать. Принято разделять два вопроса:

- **Живость** (liveness, обычно `/health`): процесс работает и отвечает. Если проверка провалена, процесс перезапускают.
- **Готовность** (readiness, обычно `/ready`): сервис может принимать рабочие запросы, то есть его зависимости доступны: база, кеш, платёжный шлюз. Если проверка провалена, копию временно убирают из балансировки, но не перезапускают: она вернётся, когда зависимость восстановится.

Имена адресов не закреплены стандартом, их записывают в настройках оркестратора. Код ответа и есть сигнал: `200` — хорошо, `503 Service Unavailable` — нет.

Почему проверки разные. Если в `/health` проверять базу, то при отказе базы оркестратор решит, что все копии приложения сломаны, и перезапустит их одновременно. Базу это не починит, а сервис получит лишний простой и шторм подключений после старта. Поэтому `/health` ничего не проверяет снаружи и отвечает сам по себе, а зависимости проверяет `/ready`.

Для ответа `503` нужен произвольный код ответа с телом. Для этого есть `JSONResponse`:

```python
from fastapi.responses import JSONResponse

return JSONResponse(status_code=503, content={"status": "unavailable"})
```

- `from fastapi.responses import JSONResponse` — класс готового ответа.
- `status_code=503` — код ответа.
- `content={...}` — тело, словарь, который станет JSON.
- Такой `return` обходит обычное оформление ответа: тип результата и `response_model` к нему не применяются. Для служебных ответов это то, что нужно.

Каждую зависимость проверяют вызовом, который падает с исключением, если ресурс недоступен, и перехватывают это исключение через `try` и `except`:

```python
try:
    ping_payments()
except ConnectionError:
    ...  # зависимость недоступна
else:
    ...  # ошибки не было
```

- `try` — блок, где может случиться ошибка.
- `except ConnectionError:` — выполняется, если внутри `try` возникло такое исключение (`except Exception:` перехватывает любое).
- `else:` — выполняется, если в `try` ошибки не было.

```python example
from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI(title="Payments gateway")
GATEWAY = {"up": True}


def ping_payments() -> None:
    if not GATEWAY["up"]:
        raise ConnectionError("payments unavailable")


@app.get("/health")
def health():
    return {"status": "alive"}


@app.get("/ready")
def ready():
    try:
        ping_payments()
    except ConnectionError:
        return JSONResponse(status_code=503, content={"status": "unavailable", "failed": ["payments"]})
    return {"status": "ready"}


@app.post("/lab/payments/down")
def lab_down():
    GATEWAY["up"] = False
    return GATEWAY
###
GET /ready
###
POST /lab/payments/down
###
GET /ready
###
GET /health
```

Результаты по порядку: `200` и `{"status": "ready"}`; `200` и `{"up": false}` (служебный маршрут лабораторного стенда, который «ломает» шлюз; в настоящем сервисе его нет); `503` и `{"status": "unavailable", "failed": ["payments"]}`; `200` и `{"status": "alive"}`. Живость осталась `200`, пока готовность уже `503`: именно так и задумано.

Правила для таких адресов:

- проверки быстрые и с ограничением времени: опрос приходит каждые несколько секунд, и медленная проверка сама станет нагрузкой;
- в ответе перечислены только имена зависимостей, без адресов серверов и текста внутренних ошибок: ответ может увидеть кто угодно, у кого есть доступ к порту;
- маршруты не требуют авторизации: оркестратор приходит без токена. Закрывают их от внешнего мира на уровне прокси.

### Request-id: нить через журнал

**Идентификатор запроса** (request-id) — короткая строка, которая выдаётся каждому запросу и сопровождает его везде: в журнале, в ответе, в обращениях к другим сервисам. Клиент жалуется на ошибку, называет идентификатор из ответа, и вы за секунды находите все строки журнала именно этого запроса.

Договорённость такая:

- если клиент или прокси уже прислал заголовок `X-Request-ID`, используем его: так идентификатор проходит через цепочку сервисов;
- иначе создаём новый, обычно `uuid.uuid4()` — случайный уникальный идентификатор из стандартного модуля `uuid`;
- кладём в `request.state`, чтобы обработчики и журнал могли его прочитать;
- возвращаем в заголовке ответа `X-Request-ID`, в том числе у ответов с ошибками.

Всё это делает middleware: слой, который вы уже знаете. Заодно он измеряет время ответа секундомером `time.perf_counter()`.

```python example
import time
import uuid

from fastapi import FastAPI, Request

app = FastAPI(title="Booking")


@app.middleware("http")
async def trace(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.request_id = request_id
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Process-Time"] = f"{time.perf_counter() - started:.4f}"
    return response


@app.get("/rooms/{room_id}")
def read_room(room_id: int, request: Request):
    return {"room": room_id, "request_id": request.state.request_id}
###
GET /rooms/5
X-Request-ID: web-0042
###
GET /rooms/5
```

- `request.headers.get("x-request-id")` — читает заголовок запроса. Имена заголовков не зависят от регистра: `X-Request-ID` и `x-request-id` — один и тот же заголовок. Если заголовка нет, `get` возвращает `None`.
- `A or B` — если `A` пустое (`None` или пустая строка), берётся `B`. Так пустой заголовок тоже заменяется новым идентификатором.
- `str(uuid.uuid4())` — строка вида `3f2b8c1e-...`: 36 символов, каждый раз другая.
- `request.state.request_id` — запись в ящик запроса: обработчик прочтёт её так же.

Первый запрос: `200`, `{"room": 5, "request_id": "web-0042"}`, в ответе заголовок `x-request-id: web-0042`: пришедший идентификатор сохранён. Второй: идентификатор создан сервером, число и содержимое будут другими при каждом запуске, а `x-process-time` — число секунд вида `0.0007`.

Как это связано с журналом: каждая строка журнала должна нести `request_id`. Тогда по одному значению находятся все события запроса, в том числе из разных сервисов. В примере выше идентификатор лежит в `request.state`, оттуда его берут обработчики, чтобы записать в журнал.

### Журналы: уровни, обработчики и формат

Для журналов в Python есть стандартный модуль `logging`. Вместо `print` создают **логгер** и пишут сообщения с уровнем важности:

```python
import logging

logger = logging.getLogger("booking")
logger.info("booking created for %s", guest)
```

- `logging.getLogger("booking")` — логгер с именем. Одно и то же имя всегда возвращает один и тот же логгер. В модулях часто пишут `getLogger(__name__)`: имя модуля становится именем логгера.
- Методы по возрастанию важности: `debug`, `info`, `warning`, `error`, `critical`. Логгер пропускает сообщения не ниже заданного уровня: `logger.setLevel(logging.INFO)` отбрасывает `debug`.
- `"... %s", guest` — значения передают отдельными аргументами, а не склеивают f-строкой. Логгер подставит их сам и только если сообщение действительно будет записано, поэтому лишняя работа не выполняется.
- `logger.info("...", extra={"order_id": 5})` — `extra` добавляет к записи собственные поля. Они становятся атрибутами записи: `record.order_id`.

Куда и в каком виде попадёт сообщение, решают два объекта:

- **обработчик** (`handler`, например `logging.StreamHandler`) определяет место: консоль, файл, поток;
- **форматтер** (`logging.Formatter`) определяет вид строки. Его метод `format(record)` получает запись и возвращает строку.

Обработчик подключают методом `logger.addHandler(handler)`, форматтер — `handler.setFormatter(formatter)`. Запись `record` — объект с полями: `record.levelname` (`"INFO"`), `record.name` (имя логгера), `record.getMessage()` (готовое сообщение с подставленными значениями).

**Структурированный журнал** — каждая строка это JSON-объект с отдельными полями: `level`, `message`, `request_id`, `booking_id`. Такие строки легко искать и считать системами сбора журналов: «все `error` с `booking_id=17` за час». Чтобы получить такой формат, пишут свой форматтер:

```python
import json
import logging


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        event = {"level": record.levelname, "message": record.getMessage()}
        booking_id = getattr(record, "booking_id", None)
        if booking_id is not None:
            event["booking_id"] = booking_id
        return json.dumps(event)
```

- `class JsonFormatter(logging.Formatter)` — свой форматтер: наследник стандартного.
- `getattr(record, "booking_id", None)` — читает атрибут по имени, а если его нет, возвращает `None`. Записи без `extra` не имеют `booking_id`, и обычное `record.booking_id` упало бы с ошибкой.
- `json.dumps(event)` — превращает словарь в строку JSON. Для текста не по-английски добавляют `ensure_ascii=False`, чтобы русские буквы не превращались в последовательности вида `043f`.

Полный пример: журнал пишется в буфер памяти `io.StringIO`, а маршрут отдаёт накопленные строки. В обычном сервисе вместо буфера используют вывод в консоль, а платформа сама забирает его в хранилище журналов. Служебный маршрут в примере нужен только для демонстрации.

```python example
import io
import json
import logging

from fastapi import FastAPI

STREAM = io.StringIO()


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        event = {"level": record.levelname, "logger": record.name, "message": record.getMessage()}
        booking_id = getattr(record, "booking_id", None)
        if booking_id is not None:
            event["booking_id"] = booking_id
        return json.dumps(event)


handler = logging.StreamHandler(STREAM)
handler.setFormatter(JsonFormatter())
logger = logging.getLogger("booking")
logger.handlers.clear()
logger.addHandler(handler)
logger.setLevel(logging.INFO)
logger.propagate = False

app = FastAPI()


@app.post("/bookings", status_code=201)
def create_booking(data: dict):
    logger.info("booking created for %s", data["guest"], extra={"booking_id": 17})
    logger.debug("not recorded: level is below INFO")
    return {"id": 17}


@app.get("/lab/logs")
def lab_logs():
    return STREAM.getvalue().splitlines()
###
POST /bookings
Content-Type: application/json

{"guest": "Ann"}
###
GET /lab/logs
```

Первый запрос: `201` и `{"id": 17}`. Второй: `200` и список из одной строки: `{"level": "INFO", "logger": "booking", "message": "booking created for Ann", "booking_id": 17}`. Сообщение `debug` не попало в журнал: уровень логгера `INFO` его отбросил. Строка `logger.handlers.clear()` и `logger.propagate = False` защищают от двойной записи при повторной загрузке модуля: `propagate = False` не пускает сообщения дальше к общему логгеру, который мог бы вывести их вторым способом.

Что нельзя писать в журнал: пароли, токены, ключи, номера карт, содержимое запросов целиком. Журнал читают многие люди и системы, а хранится он долго. Пишите идентификаторы (`booking_id`), а не содержимое. Ошибки, перехваченные в `except`, записывайте через `logger.exception("...")`: он добавляет трассировку, и это единственный случай, когда трассировке место в журнале, а не в ответе клиенту.

### Метрики: идея

Журнал отвечает на вопрос «что случилось с этим запросом». **Метрики** отвечают на вопрос «как работает сервис в целом»: числа, которые собираются постоянно и рисуются на графиках. Основные виды:

- **счётчик** (counter) только растёт: число запросов, число ошибок `5xx`;
- **измеритель** (gauge) растёт и убывает: число открытых соединений, длина очереди;
- **гистограмма** (histogram) распределяет значения по корзинам: время ответа, из неё считают, например, 95-й перцентиль (время, за которое отвечают 95% запросов).

Минимальный набор для сервиса: число запросов, доля ошибок, время ответа и загруженность (память, соединения, очередь). Обычно сервис отдаёт их по адресу `/metrics`, и внешняя система периодически забирает значения, считает по ним скорость и рисует графики. Адрес закрывают от внешнего мира, как и `/ready`. Для этого пишут middleware, который считает запросы и измеряет время, либо подключают готовую библиотеку метрик. В студии библиотек метрик нет, поэтому этот раздел остаётся описанием идеи: вы уже умеете писать middleware со счётчиком и секундомером, и именно из таких частей метрики состоят.

### Частые ошибки

- Проверка базы в `/health`. Неверно: `/health` ходит в базу и отвечает `503`, когда она недоступна. Верно: `/health` отвечает сам, зависимости проверяет `/ready`.
- Идентификатор только в журнале. Неверно: клиент не знает идентификатора своего запроса. Верно: возвращайте `X-Request-ID` в каждом ответе, в том числе с ошибкой.
- Атрибут `extra` без защиты. Неверно: `record.booking_id` в форматтере падает на записях без этого поля. Верно: `getattr(record, "booking_id", None)`.
- Склейка строки в вызове журнала. Неверно: `logger.info(f"booking {booking_id}")`. Верно: `logger.info("booking %s", booking_id)` или поле через `extra`.
- Секреты в журнале. Неверно: `logger.info("login %s %s", email, password)`. Верно: пишите идентификатор пользователя, пароль не пишите никогда.

### Шпаргалка

- `/health` — процесс жив, `200`, без внешних проверок; `/ready` — зависимости доступны, иначе `503`.
- `JSONResponse(status_code=503, content={...})`; `try:` / `except Тип:` / `else:`.
- Request-id: `request.headers.get("x-request-id") or str(uuid.uuid4())`, `request.state.request_id`, `response.headers["X-Request-ID"]`.
- Время: `time.perf_counter()` до и после `await call_next(request)`.
- `logging.getLogger(имя)`, `logger.info("текст %s", значение, extra={...})`, уровни `debug` < `info` < `warning` < `error` < `critical`.
- Свой форматтер: `class JsonFormatter(logging.Formatter)`, метод `format(self, record)`, `record.levelname`, `record.getMessage()`, `getattr(record, "поле", None)`, `json.dumps(...)`.
- Метрики: счётчик, измеритель, гистограмма; адрес `/metrics` закрыт снаружи.

## task fa-prod-health
```json
{
  "type": "fastapi",
  "title": "Живость и готовность сервиса бронирования",
  "xp": 20,
  "readonly": ["main.py", "state.py", "routers/lab.py"],
  "hints": [
    "Раздел «Живость и готовность: /health и /ready»: живость не проверяет зависимости, готовность проверяет каждую и отвечает 503, если хоть одна недоступна.",
    "В state.py есть ping_database и ping_cache: они падают с ConnectionError, если зависимость «выключена». Вызовите обе внутри try/except, соберите словарь результатов и верните JSONResponse со статусом 503, если есть недоступные.",
    "Шаблон: results = {}; for name, ping in CHECKS.items(): try: ping() except …: results[name] = \"down\" else: results[name] = \"ok\"; затем if \"down\" in results.values(): return JSONResponse(status_code=…, content={…})."
  ],
  "wrong": {
    "ready-always-ok": "готовность отвечает 200, даже если зависимость недоступна: зависимости не проверяются",
    "health-checks-deps": "живость тоже зависит от кеша и отвечает 503: при сбое кеша оркестратор перезапустит работающий процесс"
  }
}
```
У сервиса бронирования две зависимости: база и кеш. Состояние зависимостей симулирует файл `state.py`: функции `ping_database()` и `ping_cache()` вызывают `ConnectionError`, если зависимость «выключена». Служебный роутер `routers/lab.py` переключает их запросами `POST /_lab/down/{имя}` и `POST /_lab/up/{имя}`. Эти файлы и `main.py` закрыты для правки: вы пишете `routers/health.py`.

Нужно:

- `GET /health` — всегда `200` и `{"status": "alive"}`, независимо от зависимостей;
- `GET /ready` — проверяет `database` и `cache`. Если обе доступны: `200` и `{"status": "ready", "checks": {"database": "ok", "cache": "ok"}}`. Если хотя бы одна нет: `503` и `{"status": "unavailable", "checks": {...}}`, где у недоступной значение `"down"`, а у остальных `"ok"`. Ключи `checks` идут в порядке `database`, `cache`.

```python starter path=main.py
from fastapi import FastAPI

from routers.health import router as health_router
from routers.lab import router as lab_router

app = FastAPI(title="Booking")
app.include_router(health_router)
app.include_router(lab_router)
```

```python starter path=state.py
LAB = {"database": True, "cache": True}


def ping_database() -> None:
    if not LAB["database"]:
        raise ConnectionError("database is down")


def ping_cache() -> None:
    if not LAB["cache"]:
        raise ConnectionError("cache is down")
```

```python starter path=routers/lab.py
from fastapi import APIRouter

from state import LAB

router = APIRouter(prefix="/_lab", tags=["lab"])


@router.post("/down/{name}")
def down(name: str):
    LAB[name] = False
    return LAB


@router.post("/up/{name}")
def up(name: str):
    LAB[name] = True
    return LAB
```

```python starter path=routers/health.py
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from state import ping_cache, ping_database

router = APIRouter(tags=["ops"])
CHECKS = {"database": ping_database, "cache": ping_cache}


@router.get("/health")
def health():
    return {"status": "alive"}


…
```

```python solution path=main.py
from fastapi import FastAPI

from routers.health import router as health_router
from routers.lab import router as lab_router

app = FastAPI(title="Booking")
app.include_router(health_router)
app.include_router(lab_router)
```

```python solution path=state.py
LAB = {"database": True, "cache": True}


def ping_database() -> None:
    if not LAB["database"]:
        raise ConnectionError("database is down")


def ping_cache() -> None:
    if not LAB["cache"]:
        raise ConnectionError("cache is down")
```

```python solution path=routers/lab.py
from fastapi import APIRouter

from state import LAB

router = APIRouter(prefix="/_lab", tags=["lab"])


@router.post("/down/{name}")
def down(name: str):
    LAB[name] = False
    return LAB


@router.post("/up/{name}")
def up(name: str):
    LAB[name] = True
    return LAB
```

```python solution path=routers/health.py
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from state import ping_cache, ping_database

router = APIRouter(tags=["ops"])
CHECKS = {"database": ping_database, "cache": ping_cache}


@router.get("/health")
def health():
    return {"status": "alive"}


@router.get("/ready")
def ready():
    results = {}
    for name, ping in CHECKS.items():
        try:
            ping()
        except ConnectionError:
            results[name] = "down"
        else:
            results[name] = "ok"
    if "down" in results.values():
        return JSONResponse(status_code=503, content={"status": "unavailable", "checks": results})
    return {"status": "ready", "checks": results}
```

```python wrong id=ready-always-ok path=routers/health.py
from fastapi import APIRouter

from state import ping_cache, ping_database

router = APIRouter(tags=["ops"])
CHECKS = {"database": ping_database, "cache": ping_cache}


@router.get("/health")
def health():
    return {"status": "alive"}


@router.get("/ready")
def ready():
    return {"status": "ready", "checks": {"database": "ok", "cache": "ok"}}
```

```python wrong id=health-checks-deps path=routers/health.py
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from state import ping_cache, ping_database

router = APIRouter(tags=["ops"])
CHECKS = {"database": ping_database, "cache": ping_cache}


def run_checks():
    results = {}
    for name, ping in CHECKS.items():
        try:
            ping()
        except ConnectionError:
            results[name] = "down"
        else:
            results[name] = "ok"
    return results


@router.get("/health")
def health():
    results = run_checks()
    if "down" in results.values():
        return JSONResponse(status_code=503, content={"status": "unavailable", "checks": results})
    return {"status": "alive"}


@router.get("/ready")
def ready():
    results = run_checks()
    if "down" in results.values():
        return JSONResponse(status_code=503, content={"status": "unavailable", "checks": results})
    return {"status": "ready", "checks": results}
```

```http tests
GET /health
###
GET /ready
###
POST /_lab/down/cache
###
GET /ready
###
GET /health
###
POST /_lab/down/database
###
GET /ready
###
POST /_lab/up/cache
###
GET /ready
###
POST /_lab/up/database
###
GET /ready
```

## task fa-prod-request-id
```json
{
  "type": "fastapi",
  "title": "Идентификатор запроса в каждом ответе",
  "xp": 15,
  "hints": [
    "Раздел «Request-id: нить через журнал»: идентификатор берут из заголовка запроса, а если его нет, создают; затем кладут в request.state и в заголовок ответа.",
    "Счётчик SEQ уже есть. Увеличивайте его только когда заголовка x-request-id нет. Запись в заголовок ответа делайте после await call_next(request): тогда она попадёт и в ответы с ошибками.",
    "Шаблон: request_id = request.headers.get(\"x-request-id\"); if request_id is None: SEQ[\"n\"] += 1; request_id = f\"req-{SEQ['n']}\"; request.state.request_id = request_id; response = await call_next(request); response.headers[\"X-Request-ID\"] = …; return response."
  ],
  "check": { "headers": ["x-request-id"] },
  "wrong": {
    "ignores-incoming": "идентификатор создаётся всегда, пришедший в заголовке игнорируется",
    "ok-only": "заголовок добавляется только к успешным ответам, у ответов с ошибками его нет"
  }
}
```
В сервис бронирования нужно добавить middleware с идентификатором запроса:

- если запрос пришёл с заголовком `X-Request-ID`, используется его значение;
- иначе сервис создаёт идентификатор вида `req-1`, `req-2`, … (нумерует только запросы без заголовка, счётчик — словарь `SEQ`);
- идентификатор доступен обработчикам в `request.state.request_id`;
- он возвращается в заголовке `X-Request-ID` каждого ответа, включая `404` и `422`.

Обработчик `GET /rooms/{room_id}` уже готов и возвращает `{"id": …, "request_id": …}` или `404` с `{"detail": "Room not found"}`.

```python starter
from fastapi import FastAPI, HTTPException, Request

app = FastAPI(title="Booking")
SEQ = {"n": 0}
ROOMS = {1: "Sea view", 2: "Garden"}


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    …


@app.get("/rooms/{room_id}")
def read_room(room_id: int, request: Request):
    if room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"id": room_id, "request_id": request.state.request_id}
```

```python solution
from fastapi import FastAPI, HTTPException, Request

app = FastAPI(title="Booking")
SEQ = {"n": 0}
ROOMS = {1: "Sea view", 2: "Garden"}


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id")
    if request_id is None:
        SEQ["n"] += 1
        request_id = f"req-{SEQ['n']}"
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.get("/rooms/{room_id}")
def read_room(room_id: int, request: Request):
    if room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"id": room_id, "request_id": request.state.request_id}
```

```python wrong id=ignores-incoming
from fastapi import FastAPI, HTTPException, Request

app = FastAPI(title="Booking")
SEQ = {"n": 0}
ROOMS = {1: "Sea view", 2: "Garden"}


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    SEQ["n"] += 1
    request_id = f"req-{SEQ['n']}"
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.get("/rooms/{room_id}")
def read_room(room_id: int, request: Request):
    if room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"id": room_id, "request_id": request.state.request_id}
```

```python wrong id=ok-only
from fastapi import FastAPI, HTTPException, Request

app = FastAPI(title="Booking")
SEQ = {"n": 0}
ROOMS = {1: "Sea view", 2: "Garden"}


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id")
    if request_id is None:
        SEQ["n"] += 1
        request_id = f"req-{SEQ['n']}"
    request.state.request_id = request_id
    response = await call_next(request)
    if response.status_code < 400:
        response.headers["X-Request-ID"] = request_id
    return response


@app.get("/rooms/{room_id}")
def read_room(room_id: int, request: Request):
    if room_id not in ROOMS:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"id": room_id, "request_id": request.state.request_id}
```

```http tests
GET /rooms/1
###
GET /rooms/2
X-Request-ID: web-0042
###
GET /rooms/9
###
GET /rooms/abc
###
GET /rooms/1
```

## task fa-prod-json-logs
```json
{
  "type": "fastapi",
  "title": "Журнал заказов в формате JSON",
  "xp": 20,
  "readonly": ["main.py", "capture.py"],
  "hints": [
    "Раздел «Журналы: уровни, обработчики и формат»: формат строки задаёт метод format(self, record) в наследнике logging.Formatter.",
    "В словарь положите level (record.levelname) и message (record.getMessage()). Поле order_id приходит через extra и читается через getattr(record, \"order_id\", None); добавляйте его только если оно есть. Верните json.dumps(словарь).",
    "Шаблон: event = {\"level\": …, \"message\": …}; order_id = getattr(record, \"order_id\", None); if order_id is not None: event[\"order_id\"] = order_id; return json.dumps(event)."
  ],
  "wrong": {
    "plain-text": "форматтер возвращает обычный текст вместо JSON",
    "no-order-id": "в строки журнала не попадает поле order_id, переданное через extra"
  }
}
```
Сервис заказов пишет события в журнал, но формат строки пока не настроен. Файлы `main.py` (маршруты и вызовы `logger`) и `capture.py` (подключает ваш форматтер и собирает строки в память) закрыты для правки. Вы пишете `logs.py`: класс `JsonFormatter`.

Каждая строка журнала должна быть JSON-объектом, который собирается из ключей по порядку:

- `level` — уровень записи, например `INFO`;
- `message` — готовое сообщение;
- `order_id` — номер заказа; ключ нужен только у записей, которые передали `extra={"order_id": …}`, у остальных его быть не должно.

Строку получайте обычным `json.dumps(словарь)` без дополнительных аргументов. Маршрут `GET /_lab/logs` покажет накопленные строки: так вы видите результат своего форматтера.

```python starter path=main.py
from fastapi import FastAPI, HTTPException

from capture import STREAM, setup

logger = setup()
app = FastAPI(title="Orders")
ORDERS = {1: "Dune"}


@app.get("/orders")
def list_orders():
    logger.info("orders listed")
    return list(ORDERS.values())


@app.post("/orders", status_code=201)
def create_order(data: dict):
    order_id = max(ORDERS) + 1
    ORDERS[order_id] = data["item"]
    logger.info("order created", extra={"order_id": order_id})
    return {"id": order_id}


@app.get("/orders/{order_id}")
def read_order(order_id: int):
    if order_id not in ORDERS:
        logger.warning("order not found", extra={"order_id": order_id})
        raise HTTPException(status_code=404, detail="Order not found")
    return {"id": order_id, "item": ORDERS[order_id]}


@app.get("/_lab/logs")
def lab_logs():
    return STREAM.getvalue().splitlines()
```

```python starter path=capture.py
import io
import logging

from logs import JsonFormatter

STREAM = io.StringIO()


def setup() -> logging.Logger:
    handler = logging.StreamHandler(STREAM)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("orders")
    logger.handlers.clear()
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger
```

```python starter path=logs.py
import json
import logging


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        …
```

```python solution path=main.py
from fastapi import FastAPI, HTTPException

from capture import STREAM, setup

logger = setup()
app = FastAPI(title="Orders")
ORDERS = {1: "Dune"}


@app.get("/orders")
def list_orders():
    logger.info("orders listed")
    return list(ORDERS.values())


@app.post("/orders", status_code=201)
def create_order(data: dict):
    order_id = max(ORDERS) + 1
    ORDERS[order_id] = data["item"]
    logger.info("order created", extra={"order_id": order_id})
    return {"id": order_id}


@app.get("/orders/{order_id}")
def read_order(order_id: int):
    if order_id not in ORDERS:
        logger.warning("order not found", extra={"order_id": order_id})
        raise HTTPException(status_code=404, detail="Order not found")
    return {"id": order_id, "item": ORDERS[order_id]}


@app.get("/_lab/logs")
def lab_logs():
    return STREAM.getvalue().splitlines()
```

```python solution path=capture.py
import io
import logging

from logs import JsonFormatter

STREAM = io.StringIO()


def setup() -> logging.Logger:
    handler = logging.StreamHandler(STREAM)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("orders")
    logger.handlers.clear()
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger
```

```python solution path=logs.py
import json
import logging


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        event = {"level": record.levelname, "message": record.getMessage()}
        order_id = getattr(record, "order_id", None)
        if order_id is not None:
            event["order_id"] = order_id
        return json.dumps(event)
```

```python wrong id=plain-text path=logs.py
import json
import logging


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return f"{record.levelname}: {record.getMessage()}"
```

```python wrong id=no-order-id path=logs.py
import json
import logging


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps({"level": record.levelname, "message": record.getMessage()})
```

```http tests
GET /orders
###
POST /orders
Content-Type: application/json

{"item": "Emma"}
###
GET /orders/9
###
GET /orders/1
###
GET /_lab/logs
```

## task fa-prod-print-to-log
```json
{
  "type": "refactor",
  "title": "От print к журналу",
  "xp": 15,
  "hints": [
    "Раздел «Журналы: уровни, обработчики и формат»: логгер создают через logging.getLogger(__name__), а значения передают аргументами: logger.info(\"текст %s\", значение).",
    "Замените оба print на вызовы logger: создание бронирования — info, отказ из-за занятой комнаты — warning. Не используйте f-строки в вызовах logger. Ответы менять нельзя.",
    "Шаблон: import logging; logger = logging.getLogger(__name__); logger.info(\"booking for %s in room %s\", guest, room); logger.warning(\"room %s is busy\", room)."
  ],
  "check": {
    "static": [
      { "rule": "pattern", "regex": "\\bprint\\(", "forbid": true, "message": "Уберите print: сообщения пишутся через logger, у которого есть уровень и формат." },
      { "rule": "uses", "name": "getLogger", "message": "Создайте логгер: logging.getLogger(__name__)." },
      { "rule": "pattern", "regex": "\\.(debug|info|warning|error)\\(\\s*f[\"']", "forbid": true, "message": "Не склеивайте сообщение f-строкой: передавайте значения аргументами, logger.info(\"текст %s\", значение)." }
    ]
  },
  "wrong": {
    "still-print": "print остался рядом с вызовами логгера",
    "f-string": "сообщения собираются f-строкой, значения не передаются аргументами"
  }
}
```
В обработчиках бронирования сообщения о ходе работы печатаются через `print`: у них нет уровня, времени и формата, а в продакшене их приходится отделять от остального вывода вручную. Замените `print` на логгер модуля, поведение сервиса менять нельзя.

Поведение:

- `POST /bookings` с телом `{"guest": "...", "room": число}` создаёт бронирование и отвечает `201`;
- если комната уже занята, ответ `409` и `{"detail": "Room is busy"}`;
- `GET /bookings` возвращает список бронирований.

Проверка разбирает код: не должно остаться `print`, нужен `logging.getLogger`, а сообщения не должны собираться f-строкой. Ответы и список маршрутов должны совпасть с исходными.

```python starter
from fastapi import FastAPI, HTTPException

app = FastAPI(title="Booking")
BOOKINGS: list[dict] = []


@app.post("/bookings", status_code=201)
def create_booking(data: dict):
    if any(item["room"] == data["room"] for item in BOOKINGS):
        print("room", data["room"], "is busy")
        raise HTTPException(status_code=409, detail="Room is busy")
    print("booking for", data["guest"], "in room", data["room"])
    booking = {"id": len(BOOKINGS) + 1, "guest": data["guest"], "room": data["room"]}
    BOOKINGS.append(booking)
    return booking


@app.get("/bookings")
def list_bookings():
    return BOOKINGS
```

```python solution
import logging

from fastapi import FastAPI, HTTPException

logger = logging.getLogger(__name__)
app = FastAPI(title="Booking")
BOOKINGS: list[dict] = []


@app.post("/bookings", status_code=201)
def create_booking(data: dict):
    if any(item["room"] == data["room"] for item in BOOKINGS):
        logger.warning("room %s is busy", data["room"])
        raise HTTPException(status_code=409, detail="Room is busy")
    logger.info("booking for %s in room %s", data["guest"], data["room"])
    booking = {"id": len(BOOKINGS) + 1, "guest": data["guest"], "room": data["room"]}
    BOOKINGS.append(booking)
    return booking


@app.get("/bookings")
def list_bookings():
    return BOOKINGS
```

```python wrong id=still-print
import logging

from fastapi import FastAPI, HTTPException

logger = logging.getLogger(__name__)
app = FastAPI(title="Booking")
BOOKINGS: list[dict] = []


@app.post("/bookings", status_code=201)
def create_booking(data: dict):
    if any(item["room"] == data["room"] for item in BOOKINGS):
        logger.warning("room %s is busy", data["room"])
        raise HTTPException(status_code=409, detail="Room is busy")
    print("booking for", data["guest"], "in room", data["room"])
    logger.info("booking for %s in room %s", data["guest"], data["room"])
    booking = {"id": len(BOOKINGS) + 1, "guest": data["guest"], "room": data["room"]}
    BOOKINGS.append(booking)
    return booking


@app.get("/bookings")
def list_bookings():
    return BOOKINGS
```

```python wrong id=f-string
import logging

from fastapi import FastAPI, HTTPException

logger = logging.getLogger(__name__)
app = FastAPI(title="Booking")
BOOKINGS: list[dict] = []


@app.post("/bookings", status_code=201)
def create_booking(data: dict):
    if any(item["room"] == data["room"] for item in BOOKINGS):
        logger.warning(f"room {data['room']} is busy")
        raise HTTPException(status_code=409, detail="Room is busy")
    logger.info(f"booking for {data['guest']} in room {data['room']}")
    booking = {"id": len(BOOKINGS) + 1, "guest": data["guest"], "room": data["room"]}
    BOOKINGS.append(booking)
    return booking


@app.get("/bookings")
def list_bookings():
    return BOOKINGS
```

```http tests
POST /bookings
Content-Type: application/json

{"guest": "Ann", "room": 12}
###
POST /bookings
Content-Type: application/json

{"guest": "Bob", "room": 12}
###
POST /bookings
Content-Type: application/json

{"guest": "Bob", "room": 14}
###
GET /bookings
```
