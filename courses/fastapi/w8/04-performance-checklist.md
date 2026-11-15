# Производительность и чек-лист выпуска

Каталог интернет-магазина вырос до двухсот тысяч товаров. Мобильное приложение при открытии вызывает `GET /products` и получает их все: ответ весит сотни мегабайт, сервер занят сериализацией, телефон завис. Тот же каталог приложение запрашивает каждые пять секунд, хотя он меняется раз в час. А один из внешних сервисов иногда отвечает тридцать секунд, и все обработчики ждут его вместе с ним. Эти проблемы решаются не «ускорением кода», а четырьмя приёмами: ограничением размера ответа, кешированием, таймаутами и дисциплиной выпуска. В конце урока они собраны в чек-лист.

В студии нет настоящей нагрузки, сети и нескольких клиентов, поэтому здесь вы проверяете логику и заголовки, но не скорость. Скорость измеряют на своём сервере: догадки о производительности почти всегда ошибочны.

### Пагинация и лимиты

**Пагинация** — отдача данных порциями. Клиент просит страницу, а не всё сразу. Обычная схема: `limit` (сколько записей) и `offset` (сколько пропустить). В продакшене важны три правила:

- у `limit` есть значение по умолчанию и **верхняя граница**. Без границы клиент одним запросом `?limit=1000000` вернёт вас к исходной проблеме;
- у `offset` нижняя граница ноль: отрицательный сдвиг запрещён;
- клиенту сообщают общее число записей (в заголовке `X-Total-Count` или в теле), чтобы он знал, сколько страниц осталось.

Границы задают уже знакомым `Query(ge=..., le=...)`: `ge` — не меньше, `le` — не больше. Нарушение даёт `422`. Заголовок ответа проще всего поставить через параметр `response: Response`: FastAPI подставляет туда объект ответа, и обработчик дописывает в него заголовки, а тело берёт из `return`.

```python example
from typing import Annotated

from fastapi import FastAPI, Query, Response

app = FastAPI(title="Hotel")
ROOMS = [{"id": number, "name": f"Room {number}"} for number in range(1, 26)]


@app.get("/rooms")
def list_rooms(
    response: Response,
    limit: Annotated[int, Query(ge=1, le=10)] = 5,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    response.headers["X-Total-Count"] = str(len(ROOMS))
    return ROOMS[offset : offset + limit]
###
GET /rooms
###
GET /rooms?limit=3&offset=24
###
GET /rooms?limit=500
```

Первый запрос: `200`, номера `1`–`5` и заголовок `x-total-count: 25`. Второй: срез от `24` на три элемента даёт один оставшийся номер `[{"id": 25, "name": "Room 25"}]`, без ошибки. Третий: `422`, потому что `500` больше `le=10`; в `msg` написано `Input should be less than or equal to 10`. Срез `список[a:b]` за концом списка не падает, а возвращает столько элементов, сколько осталось.

У `offset` есть цена: база всё равно прочитает и отбросит все пропущенные строки, поэтому страница номер сто тысяч медленнее первой. Для длинных лент используют **курсор**: клиент присылает не номер страницы, а значение последней увиденной записи (`?after_id=1234`), и запрос читает записи после него. Курсорную пагинацию в этом курсе не разбирают: для небольших каталогов хватает `limit` и `offset`.

### Кеширование: Cache-Control и ETag

Самый быстрый запрос — тот, который не дошёл до сервера или не потребовал передачи тела. Кешированием управляют заголовками ответа.

**`Cache-Control`** говорит, как долго ответ можно использовать без обращения к серверу:

- `max-age=60` — ответ свежий 60 секунд, браузер и промежуточные кеши повторяют его без запроса;
- `no-store` — не сохранять ответ нигде (личные и чувствительные данные);
- `private` — сохранять можно только в кеше браузера этого пользователя, не в общих кешах;
- `no-cache` — несмотря на название, сохранять можно, но перед каждым использованием нужно спросить сервер, не изменился ли ответ.

Ответ с персональными данными (профиль, заказы пользователя) нельзя помечать как общий кеш: следующий посетитель получил бы чужие данные. Для него ставят `private` или `no-store`.

**`ETag`** — метка версии ответа: любая строка в кавычках, которая меняется, когда меняется содержимое (`"v7"`, чаще хэш тела). Работа в паре с условным запросом:

1. Сервер отвечает `200` с заголовком `ETag: "v7"`.
2. Позже клиент повторяет запрос с заголовком `If-None-Match: "v7"` («у меня версия v7, если такая же, не присылай»).
3. Если метка совпала, сервер отвечает `304 Not Modified` без тела: передача экономится. Если нет, `200` с новым телом и новой меткой.

Заголовок запроса читают через `Header`. Имя параметра с подчёркиваниями FastAPI превращает в имя заголовка с дефисами: параметр `if_none_match` — это заголовок `If-None-Match`. Ответ `304` строят классом `Response`, а ответ `200` с заголовками — через `JSONResponse(content=..., headers=...)`.

```python example
from typing import Annotated

from fastapi import FastAPI, Header, Response
from fastapi.responses import JSONResponse

app = FastAPI(title="Hotel rates")
RATES = {"version": 3, "night": 80}


@app.get("/rates")
def read_rates(if_none_match: Annotated[str | None, Header()] = None):
    version = RATES["version"]
    headers = {"ETag": f'"rates-{version}"', "Cache-Control": "max-age=60"}
    if if_none_match == headers["ETag"]:
        return Response(status_code=304, headers=headers)
    return JSONResponse(content={"night": RATES["night"]}, headers=headers)
###
GET /rates
###
GET /rates
If-None-Match: "rates-3"
###
GET /rates
If-None-Match: "rates-2"
```

- `Header()` — параметр берётся из заголовков запроса. `str | None = None` значит «заголовка может не быть».
- `Response(status_code=304, headers=headers)` — пустой ответ с заданным кодом и заголовками.
- Первый запрос: `200`, `{"night": 80}`, заголовки `etag: "rates-3"` и `cache-control: max-age=60`.
- Второй: метка совпала, `304` без тела; заголовки `ETag` и `Cache-Control` ответ `304` тоже несёт.
- Третий: клиент знает старую версию, поэтому получает `200` и актуальное тело.

Упрощения примера. Заголовок `If-None-Match` может содержать несколько меток через запятую или символ `*`; здесь сравнивается одна метка. А версию хранят отдельным числом, чтобы пример был коротким: настоящую метку чаще считают хэшем тела или берут из поля «обновлено».

### Стоимость ответа

Когда обработчик возвращает данные, FastAPI проверяет их по `response_model` (или по типу результата) и превращает в JSON. Эта работа растёт вместе с размером ответа: тысяча объектов обходится в тысячу раз дороже одного. Поэтому первое средство — **не отдавать лишнее**:

- пагинация вместо полного списка;
- отдельная модель ответа с нужными полями, а не вся запись из базы. Лишние поля не только весят, они ещё и раскрывают внутренности (хэш пароля, служебные флаги);
- не вызывать в обработчике запросы в цикле: N+1, который вы уже встречали, дороже любой сериализации;
- для списков хватает короткой записи (`id`, `name`, `price`), а полную карточку отдаёт `GET /products/{id}`.

Второе средство — сжатие ответа. Текст JSON хорошо сжимается, и middleware `GZipMiddleware` делает это для клиентов, которые прислали `Accept-Encoding: gzip`:

```python
from fastapi.middleware.gzip import GZipMiddleware

app.add_middleware(GZipMiddleware, minimum_size=1000)
```

- `app.add_middleware(Класс, параметры)` — подключает middleware-класс, ещё один способ, кроме декоратора `@app.middleware`;
- `minimum_size=1000` — ответы короче тысячи байт не сжимаются: выигрыш мал, а работа процессора та же.

Часто сжатием занимается обратный прокси, и тогда в приложении оно лишнее. Выбор между прокси и приложением — вопрос вашей инфраструктуры.

Главное правило: сначала измерьте. Время обработчика видно по `X-Process-Time` из прошлого урока, время запросов к базе — по счётчику запросов, общий профиль — по метрикам. Оптимизация без измерения чаще ускоряет не то место.

### Таймауты

**Таймаут** — предел ожидания. Без него медленный сосед (база, внешний сервис) занимает ваши обработчики, пока не закончатся рабочие ресурсы, и тормозит весь сервис. Таймауты ставят на каждом стыке:

- клиент вашего сервиса ставит предел ожидания ответа;
- прокси: nginx закрывает запрос, если приложение молчит дольше `proxy_read_timeout`;
- сервер: `uvicorn --timeout-keep-alive` ограничивает простой постоянного соединения, у gunicorn есть `--timeout` для воркеров;
- вызовы изнутри приложения: HTTP-клиент `httpx` принимает `timeout=3.0`, драйверы баз — собственные параметры.

Для собственных асинхронных вызовов есть `asyncio.wait_for`:

```python
import asyncio

try:
    price = await asyncio.wait_for(ask_supplier(sku), timeout=2)
except TimeoutError:
    raise HTTPException(status_code=504, detail="Supplier timeout")
```

- `asyncio.wait_for(корутина, timeout=секунды)` — ждёт результат не дольше указанного времени. Если время вышло, ожидание **отменяется**, а наружу вылетает `TimeoutError`.
- `except TimeoutError:` — перехватывает его, и обработчик отвечает `504 Gateway Timeout` («шлюз не дождался ответа от вышестоящего сервиса»). Другие коды для этого тоже встречаются, но `504` описывает именно такую ситуацию, а `500` говорит о собственной ошибке приложения.
- Работает только с `await`-вызовами. Блокирующий `time.sleep` отменить нельзя: он держит весь поток.

В студии часы виртуальные: `asyncio.sleep(5)` проходит мгновенно, но `wait_for` учитывает те же виртуальные секунды. Поэтому пример ниже отрабатывает честно и без реального ожидания; на обычном компьютере пятисекундная пауза заняла бы пять секунд, а таймаут сработал бы через две.

```python example
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI(title="Courier")
ETA_DELAY = {"north": 0.3, "far": 6.0}


async def ask_courier(zone: str) -> int:
    await asyncio.sleep(ETA_DELAY[zone])
    return 25


@app.get("/eta/{zone}")
async def read_eta(zone: str):
    try:
        minutes = await asyncio.wait_for(ask_courier(zone), timeout=1.5)
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Courier service timeout")
    return {"zone": zone, "minutes": minutes}
###
GET /eta/north
###
GET /eta/far
```

Первый запрос: `200` и `{"zone": "north", "minutes": 25}`: ответили за 0.3 секунды. Второй: `504` и `{"detail": "Courier service timeout"}`: шесть секунд больше предела в 1.5.

### Чек-лист выпуска

Перед каждым выпуском в продакшен пройдите список. Он собран из этого мира курса:

1. Конфигурация. Секреты приходят из окружения или хранилища секретов, в образе и репозитории их нет. `debug` выключен. Настройки проверяются при старте. Документация закрыта или защищена.
2. Запуск. Команда без `dev` и `--reload`, процесс не от администратора, число воркеров выбрано нагрузкой. Общее состояние не лежит в памяти процесса.
3. Прокси. Доверие к `X-Forwarded-*` ограничено адресом прокси, `root_path` совпадает с префиксом, HTTPS завершается на прокси, размер тела запроса ограничен.
4. Здоровье. Есть `/health` без внешних проверок и `/ready` с проверкой зависимостей, оркестратор настроен на них.
5. Наблюдаемость. Каждый ответ несёт `X-Request-ID`, журнал в JSON с этим идентификатором, секретов и персональных данных в нём нет, метрики и оповещения подключены.
6. Данные. Схема обновляется миграциями, резервные копии проверены восстановлением, размер пула соединений согласован с числом воркеров.
7. Скорость. Списки с пагинацией и верхней границей `limit`, нет запросов в цикле, у каждого внешнего вызова есть таймаут, кеш-заголовки выбраны осознанно.
8. Безопасность. Авторизация стоит на всех нужных маршрутах, ответы не раскрывают лишних полей, зависимости обновлены.
9. Откат. Известно, как вернуть предыдущую версию, и это уже пробовали.

Список не заменяет головы: он нужен, чтобы забытое пункт за пунктом попадало на глаза до выпуска, а не после жалобы клиента.

### Частые ошибки

- Лимит без верхней границы. Неверно: `limit: int = 20`. Верно: `Annotated[int, Query(ge=1, le=100)] = 20`.
- `ETag` без кавычек. Неверно: `ETag: v7`. Верно: `ETag: "v7"`; кавычки часть значения.
- Общий кеш для личных данных. Неверно: `Cache-Control: public, max-age=3600` у `/me/orders`. Верно: `private` или `no-store`.
- Ответ `304` без заголовков. Неверно: `Response(status_code=304)` без `ETag` и `Cache-Control`. Верно: повторять заголовки, которые были бы у `200`.
- `500` вместо `504`. Неверно: пропустить `TimeoutError`, и пользователь видит внутреннюю ошибку. Верно: перехватить и ответить `504`.
- Таймаут на блокирующем вызове. Неверно: `wait_for(time.sleep(5), ...)`. Верно: `await`-вызов или клиент с собственным `timeout`.

### Шпаргалка

- `limit: Annotated[int, Query(ge=1, le=100)] = 20`, `offset: Annotated[int, Query(ge=0)] = 0`; `response: Response`, `response.headers["X-Total-Count"] = str(total)`; срез `items[offset : offset + limit]`.
- `Cache-Control`: `max-age=N`, `no-store`, `private`, `no-cache` (проверять перед использованием).
- `ETag: "метка"`; запрос с `If-None-Match`; совпало — `Response(status_code=304, headers=...)`; параметр `if_none_match: Annotated[str | None, Header()] = None`.
- `JSONResponse(content=..., headers=...)`.
- `app.add_middleware(GZipMiddleware, minimum_size=1000)`.
- `await asyncio.wait_for(корутина, timeout=сек)`, `except TimeoutError:`, ответ `504`.
- Чек-лист: конфигурация, запуск, прокси, здоровье, наблюдаемость, данные, скорость, безопасность, откат.

## task fa-prod-pagination
```json
{
  "type": "fix-bug",
  "title": "Каталог без границ",
  "xp": 15,
  "hints": [
    "Раздел «Пагинация и лимиты»: у limit нужна верхняя граница (le), у offset нижняя (ge=0); срез берут от offset до offset + limit.",
    "В обработчике три ошибки: offset не используется, у параметров нет границ, а общее число записей не сообщается. Заголовок ставится через response.headers.",
    "Шаблон: limit: Annotated[int, Query(ge=1, le=…)] = …, offset: Annotated[int, Query(ge=0)] = 0; response.headers[\"X-Total-Count\"] = str(len(PRODUCTS)); return PRODUCTS[offset : offset + limit]."
  ],
  "check": { "headers": ["x-total-count"] },
  "wrong": {
    "no-cap": "у limit нет верхней границы: запрос с огромным limit проходит",
    "no-offset": "сдвиг offset принимается, но в выборке не используется"
  }
}
```
Каталог магазина отдаёт `GET /products` целиком и без проверок. Нужно:

- `limit` — от `1` до `20`, по умолчанию `10`; `offset` — не меньше `0`, по умолчанию `0`. Значение вне границ — `422`;
- ответ — срез каталога с `offset` на `limit` записей (за концом каталога список просто короче или пуст);
- заголовок `X-Total-Count` с общим числом товаров (их `30`).

```python starter
from fastapi import FastAPI, Response

app = FastAPI(title="Catalog")
PRODUCTS = [{"id": number, "name": f"Product {number}"} for number in range(1, 31)]


@app.get("/products")
def list_products(response: Response, limit: int = 30, offset: int = 0):
    return PRODUCTS[:limit]
```

```python solution
from typing import Annotated

from fastapi import FastAPI, Query, Response

app = FastAPI(title="Catalog")
PRODUCTS = [{"id": number, "name": f"Product {number}"} for number in range(1, 31)]


@app.get("/products")
def list_products(
    response: Response,
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    response.headers["X-Total-Count"] = str(len(PRODUCTS))
    return PRODUCTS[offset : offset + limit]
```

```python wrong id=no-cap
from typing import Annotated

from fastapi import FastAPI, Query, Response

app = FastAPI(title="Catalog")
PRODUCTS = [{"id": number, "name": f"Product {number}"} for number in range(1, 31)]


@app.get("/products")
def list_products(
    response: Response,
    limit: Annotated[int, Query(ge=1)] = 10,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    response.headers["X-Total-Count"] = str(len(PRODUCTS))
    return PRODUCTS[offset : offset + limit]
```

```python wrong id=no-offset
from typing import Annotated

from fastapi import FastAPI, Query, Response

app = FastAPI(title="Catalog")
PRODUCTS = [{"id": number, "name": f"Product {number}"} for number in range(1, 31)]


@app.get("/products")
def list_products(
    response: Response,
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    response.headers["X-Total-Count"] = str(len(PRODUCTS))
    return PRODUCTS[:limit]
```

```http tests
GET /products
###
GET /products?limit=5&offset=28
###
GET /products?limit=20&offset=20
###
GET /products?limit=21
###
GET /products?limit=0
###
GET /products?offset=-1
###
GET /products?offset=100
```

## task fa-prod-etag
```json
{
  "type": "fastapi",
  "title": "Условный запрос: ETag и 304",
  "xp": 20,
  "hints": [
    "Раздел «Кеширование: Cache-Control и ETag»: метку сравнивают с заголовком запроса If-None-Match; совпала — ответ 304 без тела, не совпала — 200.",
    "Метка — строка в кавычках из версии записи: \"v1\". Заголовки ETag и Cache-Control нужны и у 200, и у 304. Для несуществующей записи ответ всегда 404, даже если If-None-Match прислан.",
    "Шаблон: if_none_match: Annotated[str | None, Header()] = None; etag = f'\"v{item[\"version\"]}\"'; headers = {\"ETag\": etag, \"Cache-Control\": \"max-age=60\"}; if if_none_match == etag: return Response(status_code=…, headers=headers); return JSONResponse(content={…}, headers=headers)."
  ],
  "check": { "headers": ["etag", "cache-control"] },
  "wrong": {
    "always-200": "метки выставляются, но условный запрос не поддерживается: на совпавшую метку приходит полный ответ 200",
    "no-headers-on-304": "ответ 304 приходит без заголовков ETag и Cache-Control"
  }
}
```
Карточка товара `GET /items/{item_id}` должна поддерживать условные запросы. У каждого товара есть номер версии `version`, он растёт при смене цены. Метка ответа — версия в кавычках: `"v1"`, `"v2"` и так далее.

- Успешный ответ — `200` и `{"id": …, "name": …, "price": …}` с заголовками `ETag: "v<версия>"` и `Cache-Control: max-age=60`.
- Если запрос пришёл с `If-None-Match`, равным текущей метке, ответ — `304` без тела, с теми же двумя заголовками.
- Если метка устарела, ответ полный `200` с новой меткой.
- Несуществующий товар — `404` и `{"detail": "Item not found"}` независимо от `If-None-Match`.

Маршрут `PUT /items/{item_id}/price` уже готов: он меняет цену и увеличивает версию, чтобы вы могли проверить, что метка меняется.

```python starter
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Catalog")
ITEMS = {
    1: {"name": "Atlas", "price": 40.0, "version": 1},
    2: {"name": "Globe", "price": 25.0, "version": 1},
}


class PriceIn(BaseModel):
    price: float = Field(gt=0)


@app.get("/items/{item_id}")
def read_item(item_id: int):
    item = ITEMS.get(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"id": item_id, "name": item["name"], "price": item["price"]}


@app.put("/items/{item_id}/price")
def change_price(item_id: int, data: PriceIn):
    item = ITEMS.get(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    item["price"] = data.price
    item["version"] += 1
    return {"id": item_id, "price": item["price"], "version": item["version"]}
```

```python solution
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Catalog")
ITEMS = {
    1: {"name": "Atlas", "price": 40.0, "version": 1},
    2: {"name": "Globe", "price": 25.0, "version": 1},
}


class PriceIn(BaseModel):
    price: float = Field(gt=0)


@app.get("/items/{item_id}")
def read_item(item_id: int, if_none_match: Annotated[str | None, Header()] = None):
    item = ITEMS.get(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    headers = {"ETag": f'"v{item["version"]}"', "Cache-Control": "max-age=60"}
    if if_none_match == headers["ETag"]:
        return Response(status_code=304, headers=headers)
    return JSONResponse(content={"id": item_id, "name": item["name"], "price": item["price"]}, headers=headers)


@app.put("/items/{item_id}/price")
def change_price(item_id: int, data: PriceIn):
    item = ITEMS.get(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    item["price"] = data.price
    item["version"] += 1
    return {"id": item_id, "price": item["price"], "version": item["version"]}
```

```python wrong id=always-200
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Catalog")
ITEMS = {
    1: {"name": "Atlas", "price": 40.0, "version": 1},
    2: {"name": "Globe", "price": 25.0, "version": 1},
}


class PriceIn(BaseModel):
    price: float = Field(gt=0)


@app.get("/items/{item_id}")
def read_item(item_id: int, if_none_match: Annotated[str | None, Header()] = None):
    item = ITEMS.get(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    headers = {"ETag": f'"v{item["version"]}"', "Cache-Control": "max-age=60"}
    return JSONResponse(content={"id": item_id, "name": item["name"], "price": item["price"]}, headers=headers)


@app.put("/items/{item_id}/price")
def change_price(item_id: int, data: PriceIn):
    item = ITEMS.get(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    item["price"] = data.price
    item["version"] += 1
    return {"id": item_id, "price": item["price"], "version": item["version"]}
```

```python wrong id=no-headers-on-304
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Catalog")
ITEMS = {
    1: {"name": "Atlas", "price": 40.0, "version": 1},
    2: {"name": "Globe", "price": 25.0, "version": 1},
}


class PriceIn(BaseModel):
    price: float = Field(gt=0)


@app.get("/items/{item_id}")
def read_item(item_id: int, if_none_match: Annotated[str | None, Header()] = None):
    item = ITEMS.get(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    headers = {"ETag": f'"v{item["version"]}"', "Cache-Control": "max-age=60"}
    if if_none_match == headers["ETag"]:
        return Response(status_code=304)
    return JSONResponse(content={"id": item_id, "name": item["name"], "price": item["price"]}, headers=headers)


@app.put("/items/{item_id}/price")
def change_price(item_id: int, data: PriceIn):
    item = ITEMS.get(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    item["price"] = data.price
    item["version"] += 1
    return {"id": item_id, "price": item["price"], "version": item["version"]}
```

```http tests
GET /items/1
###
GET /items/1
If-None-Match: "v1"
###
GET /items/1
If-None-Match: "v0"
###
PUT /items/1/price
Content-Type: application/json

{"price": 45.5}
###
GET /items/1
If-None-Match: "v1"
###
GET /items/1
If-None-Match: "v2"
###
GET /items/2
If-None-Match: "v1"
###
GET /items/9
If-None-Match: "v1"
```

## task fa-prod-timeout
```json
{
  "type": "fastapi",
  "title": "Таймаут на запрос к поставщику",
  "xp": 15,
  "hints": [
    "Раздел «Таймауты»: asyncio.wait_for(корутина, timeout=секунды) отменяет ожидание и поднимает TimeoutError, когда время вышло.",
    "Оберните вызов ask_supplier(sku) в wait_for с пределом в 2 секунды и перехватите TimeoutError: в этом случае ответ 504 и {\"detail\": \"Supplier timeout\"}.",
    "Шаблон: try: available = await asyncio.wait_for(ask_supplier(sku), timeout=…) except TimeoutError: raise HTTPException(status_code=…, detail=…)."
  ],
  "check": {
    "code": [
      { "pattern": "wait_for\\(", "message": "Ограничьте ожидание через asyncio.wait_for(…, timeout=…)." }
    ]
  },
  "wrong": {
    "no-timeout": "ответ поставщика ждётся сколько угодно: медленный поставщик задерживает ответ магазина",
    "too-patient": "предел ожидания слишком велик: поставщик, который отвечает за 5 секунд, всё ещё успевает"
  }
}
```
Магазин спрашивает у поставщика остаток товара. Обычно поставщик отвечает быстро, но по товару `globe` задерживается на 5 секунд, и обработчик ждёт вместе с ним. Функция `ask_supplier` имитирует ответ с задержкой.

Нужно ограничить ожидание двумя секундами. Если поставщик успел, ответ `200` и `{"sku": …, "available": …}`. Если нет, ответ `504` и `{"detail": "Supplier timeout"}`. В студии часы виртуальные: пятисекундная пауза проходит мгновенно, а таймаут срабатывает по тем же виртуальным секундам.

```python starter
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI(title="Stock")
SUPPLIER_DELAY = {"atlas": 0.5, "globe": 5.0}


async def ask_supplier(sku: str) -> int:
    await asyncio.sleep(SUPPLIER_DELAY.get(sku, 0.1))
    return 7


@app.get("/stock/{sku}")
async def read_stock(sku: str):
    available = await ask_supplier(sku)
    return {"sku": sku, "available": available}
```

```python solution
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI(title="Stock")
SUPPLIER_DELAY = {"atlas": 0.5, "globe": 5.0}


async def ask_supplier(sku: str) -> int:
    await asyncio.sleep(SUPPLIER_DELAY.get(sku, 0.1))
    return 7


@app.get("/stock/{sku}")
async def read_stock(sku: str):
    try:
        available = await asyncio.wait_for(ask_supplier(sku), timeout=2)
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Supplier timeout")
    return {"sku": sku, "available": available}
```

```python wrong id=no-timeout
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI(title="Stock")
SUPPLIER_DELAY = {"atlas": 0.5, "globe": 5.0}


async def ask_supplier(sku: str) -> int:
    await asyncio.sleep(SUPPLIER_DELAY.get(sku, 0.1))
    return 7


@app.get("/stock/{sku}")
async def read_stock(sku: str):
    available = await ask_supplier(sku)
    return {"sku": sku, "available": available}
```

```python wrong id=too-patient
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI(title="Stock")
SUPPLIER_DELAY = {"atlas": 0.5, "globe": 5.0}


async def ask_supplier(sku: str) -> int:
    await asyncio.sleep(SUPPLIER_DELAY.get(sku, 0.1))
    return 7


@app.get("/stock/{sku}")
async def read_stock(sku: str):
    try:
        available = await asyncio.wait_for(ask_supplier(sku), timeout=10)
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Supplier timeout")
    return {"sku": sku, "available": available}
```

```http tests
GET /stock/atlas
###
GET /stock/globe
###
GET /stock/pen
```

## task fa-prod-release-review
```json
{
  "type": "review",
  "title": "Чек-лист выпуска: что не пройдёт",
  "xp": 15,
  "lines": [12, 17, 23],
  "hints": [
    "Разделы «Пагинация и лимиты», «Таймауты» и «Журналы» из прошлого урока: список без границ, блокирующий вызов без таймаута, секреты в журнале.",
    "В коде три настоящие проблемы: одна в первом маршруте, одна во втором и одна в третьем. Остальные замечания придуманы.",
    "Верные варианты: возврат всего списка, requests.get в async def без timeout и запись всего тела запроса в журнал."
  ],
  "options": [
    "Строка 12: маршрут возвращает все заказы без пагинации и верхней границы: с ростом данных ответ станет огромным",
    "Строка 17: блокирующий `requests.get` внутри `async def` без `timeout` останавливает цикл событий и может ждать бесконечно",
    "Строка 23: в журнал попадает всё тело запроса, а в нём пароль: в журнал пишут идентификатор пользователя, а не тело",
    "Строка 5: имя логгера нужно заменить на `__name__`, иначе записи не будут выводиться никогда",
    "Строка 6: без явного `debug=False` приложение работает в режиме отладки"
  ],
  "answer": [0, 1, 2],
  "explanation": "Первые три замечания верны. Без пагинации ответ растёт вместе с данными, и клиент рано или поздно получит всё сразу. Блокирующий вызов в async def останавливает весь сервер, а отсутствие timeout позволяет ждать бесконечно: нужен асинхронный клиент или обычный def, и всегда timeout. Тело запроса /login содержит пароль, и он окажется в журнале на долгие месяцы. Имя логгера может быть любым: от строки в getLogger зависит лишь место записи в иерархии логгеров, а вывод определяют обработчики. Режим отладки выключен по умолчанию: debug=True нужно включать явно, поэтому отдельная запись debug=False необязательна."
}
```
Ниже фрагмент сервиса, который готовят к выпуску. Какие замечания верны? Выберите все.

```python code
import logging
import requests
from fastapi import FastAPI

logger = logging.getLogger("shop")
app = FastAPI()
ORDERS = [{"id": number, "total": number * 10} for number in range(100000)]


@app.get("/orders")
async def list_orders():
    return ORDERS


@app.get("/rates")
async def read_rates():
    response = requests.get("https://rates.example/api")
    return response.json()


@app.post("/login")
async def login(data: dict):
    logger.info("login attempt %s", data)
    return {"ok": True}
```
