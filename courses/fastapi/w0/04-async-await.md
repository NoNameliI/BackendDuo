# async и await: почему нельзя блокировать цикл

Страница товара собирается из двух источников: цена лежит в одном сервисе, остаток на складе в другом, и каждый отвечает по секунде. Если спрашивать их по очереди, пользователь ждёт две секунды, а если одновременно, то одну. Для такого «ожидания в параллель» в Python есть `async` и `await`. Этот урок объясняет, как они работают, почему один неосторожный вызов в `async def` останавливает весь сервер и как запускать несколько ожиданий сразу.

### Корутина и await

Функция, объявленная через `async def`, — **корутина-функция**. Её вызов не выполняет тело, а создаёт объект-корутину («задание на выполнение»). Тело выполнится, когда это задание дождутся словом `await`.

```python
async def имя(параметры):
    результат = await другая_корутина(...)
    return результат
```

- `async def` — объявление функции, внутри которой разрешён `await`;
- `await выражение` — «запусти корутину, подожди её результат и пока жди, отдай управление другим задачам»;
- `await` можно писать только внутри `async def`.

Если написать вызов без `await`, вы получите не результат, а объект-корутину, и Python предупредит: `coroutine ... was never awaited`.

### Цикл событий

Сервер на `async` работает в **одном потоке** и обслуживает много запросов с помощью **цикла событий**. Он выбирает задачу, выполняет её до первого `await`, и пока она ждёт (сеть, пауза), берёт другую. Задачи сами добровольно отдают управление, поэтому такая схема называется кооперативной.

Из этого следует главное правило: пока одна задача выполняет обычный, не асинхронный код, остальные ждут. Пауза через `await` отдаёт управление другим, а пауза через `time.sleep` — нет: она просто замораживает единственный поток.

- `await asyncio.sleep(1)` — ждать секунду, остальные запросы продолжают работать;
- `time.sleep(1)` — ждать секунду, весь сервер стоит. Так же вредят `requests.get(...)` и другие «синхронные» сетевые вызовы, тяжёлые вычисления и чтение больших файлов.

```python example
import asyncio

from fastapi import FastAPI

app = FastAPI()
RATINGS = {1: 4.5, 2: 3.8}


async def load_rating(book_id: int) -> float:
    await asyncio.sleep(1)
    return RATINGS.get(book_id, 0.0)


@app.get("/books/{book_id}/rating")
async def read_rating(book_id: int):
    rating = await load_rating(book_id)
    return {"id": book_id, "rating": rating}
###
GET /books/1/rating
###
GET /books/7/rating
```

Ответы: `200` и `{"id": 1, "rating": 4.5}`, затем `200` и `{"id": 7, "rating": 0.0}`. Важное отличие студии от настоящего сервера: здесь часы виртуальные, и `asyncio.sleep(1)` проходит мгновенно. На вашем компьютере такой запрос займёт секунду. А блокирующий `time.sleep` и в студии ждёт по-настоящему, останавливая всё приложение, — проверка кода найдёт его в `async def`.

### def или async def в FastAPI

FastAPI принимает оба вида обработчиков:

- `async def` — выполняется прямо в цикле событий. Подходит, когда внутри вы ждёте через `await` (асинхронный клиент, `asyncio.sleep`) или не ждёте ничего;
- обычный `def` — FastAPI сам запускает его в отдельном потоке, чтобы блокирующий вызов не остановил цикл. Подходит, когда внутри блокирующая библиотека (`requests`, драйвер базы без `async`).

В студии потоков нет, и `def`-обработчики выполняются на месте, но выбор между ними делают по тем же правилам, что и на настоящем сервере.

Если в `async def` внутри вспомогательной обычной функции стоит `time.sleep`, вред тот же: блокирует цикл. Чинят двумя способами: сделать помощника `async def` и вызывать его с `await`, либо сделать сам обработчик обычным `def`.

### asyncio.gather: несколько ожиданий сразу

`asyncio.gather` запускает несколько корутин одновременно и ждёт их все. Результат — список ответов в том же порядке, в котором вы их перечислили.

```python
первый, второй = await asyncio.gather(корутина_1(...), корутина_2(...))
```

- `import asyncio` — модуль асинхронности;
- аргументы `gather` — вызовы корутин, **без** `await` внутри: `await` ставится один раз перед всем `gather`;
- слева от `=` распаковка списка по именам в порядке аргументов;
- для списка корутин используют звёздочку: `asyncio.gather(*[корутина(i) for i in ...])` — она разворачивает список в отдельные аргументы.

Общее время равно самому долгому ожиданию, а не сумме: две паузы по секунде при `gather` занимают секунду.

```python example
import asyncio

from fastapi import FastAPI

app = FastAPI()
TITLES = {1: "Dune", 2: "Emma", 3: "Ubik"}


async def load_title(book_id: int) -> str:
    await asyncio.sleep(1)
    return TITLES.get(book_id, "unknown")


@app.get("/titles/{count}")
async def read_titles(count: int):
    titles = await asyncio.gather(*[load_title(i) for i in range(1, count + 1)])
    return {"titles": titles}
###
GET /titles/3
###
GET /titles/5
```

`/titles/3` даёт `{"titles": ["Dune", "Emma", "Ubik"]}`, а `/titles/5` — `{"titles": ["Dune", "Emma", "Ubik", "unknown", "unknown"]}`. Порядок совпадает с порядком запуска. Если забыть `await` перед `gather`, вместо списка получится объект «будущего результата», и ответ не сформируется.

### Окружение и пакеты: venv и pip

Сторонние библиотеки (`fastapi`, `httpx`) на своём компьютере ставят в отдельное **виртуальное окружение**, чтобы проекты не мешали друг другу. Это команды терминала, в студии их выполнить нельзя: нужные пакеты уже подключены, а лишние поставить нельзя.

```sh
python -m venv .venv
source .venv/bin/activate
pip install "fastapi[standard]"
fastapi dev main.py
```

- `python -m venv .venv` — создать окружение в папке `.venv`;
- `source .venv/bin/activate` — включить его (в Windows: `.venv\Scripts\activate`);
- `pip install ...` — поставить пакет в это окружение;
- `fastapi dev main.py` — запустить приложение с автоперезапуском.

Задания курса работают только с тем, что уже есть в студии. Если задание требует дополнительный пакет (например, для форм), это указано в его условии.

### Частые ошибки

- Блокирующая пауза. Неверно: `time.sleep(2)` в `async def`. Верно: `await asyncio.sleep(2)` или обычный `def`.
- Забыт `await`. Неверно: `rating = load_rating(1)` — в `rating` лежит корутина. Верно: `rating = await load_rating(1)`.
- `await` внутри `gather`. Неверно: `asyncio.gather(await a(), await b())` — всё выполняется по очереди. Верно: `await asyncio.gather(a(), b())`.
- Забыт `await` перед `gather`. Неверно: `r = asyncio.gather(a(), b())`. Верно: `r = await asyncio.gather(a(), b())`.
- Помощник блокирует. Неверно: `async def` обработчик вызывает обычную функцию с `time.sleep`. Верно: сделайте помощника `async def` с `await asyncio.sleep(...)`.

### Шпаргалка

- `async def f(): ...` создаёт корутину; `await f()` выполняет её и возвращает результат.
- `await` — только внутри `async def`; без него корутина не запускается.
- Один поток, цикл событий; блокирующий вызов останавливает всех.
- `await asyncio.sleep(n)` вместо `time.sleep(n)`; в студии `sleep` мгновенный.
- Блокирующая библиотека — обычный `def` (FastAPI запустит его в потоке).
- `a, b = await asyncio.gather(f(), g())`; для списка `asyncio.gather(*[f(i) for i in ...])`.
- venv и pip: `python -m venv .venv`, `pip install ...`; в студии не нужны.

## task fa-py-async-gather

```json
{
  "type": "fastapi",
  "title": "Цена и остаток одновременно",
  "xp": 15,
  "hints": [
    "Раздел «asyncio.gather»: два ожидания запускают вместе, и await ставится один раз перед gather.",
    "Подключите asyncio.gather и распакуйте результат: price, stock = await asyncio.gather(load_price(...), load_stock(...)). Порядок слева совпадает с порядком аргументов.",
    "Шаблон: price, stock = await asyncio.gather(load_price(product_id), load_stock(product_id))."
  ],
  "check": {
    "static": [
      { "rule": "uses", "name": "gather", "message": "Запустите оба ожидания вместе через asyncio.gather." }
    ]
  },
  "wrong": {
    "no-await": "gather вызван без await, вместо чисел в ответ попадает объект ожидания",
    "swapped": "результаты gather записаны в обратном порядке, и цена с остатком перепутаны"
  }
}
```
Сводка по товару собирается из двух источников: цену отдаёт `load_price`, остаток на складе — `load_stock`, каждый ждёт по полсекунды. Сейчас обработчик `GET /products/{product_id}` ждёт их по очереди. Ответ: `{"id": номер, "price": цена, "stock": остаток}`; неизвестный товар даёт `404` и `{"detail": "Product not found"}`.

Перепишите так, чтобы оба источника опрашивались одновременно через `asyncio.gather`. Формат ответов менять нельзя. Проверка требует использования `gather` и сверяет ответы.

```python starter
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI()
PRICES = {1: 120.0, 2: 340.0}
STOCK = {1: 8, 2: 0}


async def load_price(product_id: int) -> float:
    await asyncio.sleep(0.5)
    return PRICES[product_id]


async def load_stock(product_id: int) -> int:
    await asyncio.sleep(0.5)
    return STOCK[product_id]


@app.get("/products/{product_id}")
async def read_product(product_id: int):
    if product_id not in PRICES:
        raise HTTPException(status_code=404, detail="Product not found")
    price = await load_price(product_id)
    stock = await load_stock(product_id)
    return {"id": product_id, "price": price, "stock": stock}
```

```python solution
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI()
PRICES = {1: 120.0, 2: 340.0}
STOCK = {1: 8, 2: 0}


async def load_price(product_id: int) -> float:
    await asyncio.sleep(0.5)
    return PRICES[product_id]


async def load_stock(product_id: int) -> int:
    await asyncio.sleep(0.5)
    return STOCK[product_id]


@app.get("/products/{product_id}")
async def read_product(product_id: int):
    if product_id not in PRICES:
        raise HTTPException(status_code=404, detail="Product not found")
    price, stock = await asyncio.gather(load_price(product_id), load_stock(product_id))
    return {"id": product_id, "price": price, "stock": stock}
```

```python wrong id=no-await
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI()
PRICES = {1: 120.0, 2: 340.0}
STOCK = {1: 8, 2: 0}


async def load_price(product_id: int) -> float:
    await asyncio.sleep(0.5)
    return PRICES[product_id]


async def load_stock(product_id: int) -> int:
    await asyncio.sleep(0.5)
    return STOCK[product_id]


@app.get("/products/{product_id}")
async def read_product(product_id: int):
    if product_id not in PRICES:
        raise HTTPException(status_code=404, detail="Product not found")
    result = asyncio.gather(load_price(product_id), load_stock(product_id))
    return {"id": product_id, "price": result, "stock": result}
```

```python wrong id=swapped
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI()
PRICES = {1: 120.0, 2: 340.0}
STOCK = {1: 8, 2: 0}


async def load_price(product_id: int) -> float:
    await asyncio.sleep(0.5)
    return PRICES[product_id]


async def load_stock(product_id: int) -> int:
    await asyncio.sleep(0.5)
    return STOCK[product_id]


@app.get("/products/{product_id}")
async def read_product(product_id: int):
    if product_id not in PRICES:
        raise HTTPException(status_code=404, detail="Product not found")
    stock, price = await asyncio.gather(load_price(product_id), load_stock(product_id))
    return {"id": product_id, "price": price, "stock": stock}
```

```http tests
GET /products/1
###
GET /products/2
###
GET /products/9
```

## task fa-py-async-shipping

```json
{
  "type": "fastapi",
  "title": "Доставка без блокировки",
  "xp": 20,
  "hints": [
    "Разделы «Цикл событий» и «def или async def в FastAPI»: time.sleep в вспомогательной функции блокирует цикл, даже если обработчик объявлен через async def.",
    "Сделайте load_rate асинхронной (async def, await asyncio.sleep(1)) и вызывайте её с await. Пауза должна остаться.",
    "Шаблон: import asyncio; async def load_rate(kind): await asyncio.sleep(1); return RATES[kind]; в обработчике rate = await load_rate(kind)."
  ],
  "check": {
    "static": [
      { "rule": "no-blocking-in-async", "message": "В async def (и в функциях, которые он вызывает) нельзя использовать time.sleep: это блокирует весь сервер." }
    ],
    "code": [
      { "pattern": "sleep\\(", "message": "Пауза «расчёта тарифа» должна остаться: замените способ ожидания, а не удаляйте его." }
    ]
  },
  "wrong": {
    "helper-blocks": "вспомогательная функция по-прежнему блокирует цикл через time.sleep",
    "no-await": "помощник стал async def, но вызывается без await, и в ответе вместо тарифа корутина"
  }
}
```
Обработчик `GET /shipping/{kind}` считает стоимость доставки: `{"kind": вид, "price": тариф}`. Тарифы лежат в словаре `RATES` (`standard` и `express`). Неизвестный вид даёт `404` и `{"detail": "Unknown shipping kind"}`. Тариф «рассчитывается» секунду внутри `load_rate`, но использует блокирующий `time.sleep`, и из-за него встаёт весь сервер.

Исправьте код так, чтобы он не блокировал цикл событий, а секундная пауза осталась. Результаты ответов менять нельзя. Проверка сначала разбирает код, потом сверяет ответы.

```python starter
import time

from fastapi import FastAPI, HTTPException

app = FastAPI()
RATES = {"standard": 5.0, "express": 12.5}


def load_rate(kind: str) -> float:
    time.sleep(1)
    return RATES[kind]


@app.get("/shipping/{kind}")
async def read_shipping(kind: str):
    if kind not in RATES:
        raise HTTPException(status_code=404, detail="Unknown shipping kind")
    return {"kind": kind, "price": load_rate(kind)}
```

```python solution
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI()
RATES = {"standard": 5.0, "express": 12.5}


async def load_rate(kind: str) -> float:
    await asyncio.sleep(1)
    return RATES[kind]


@app.get("/shipping/{kind}")
async def read_shipping(kind: str):
    if kind not in RATES:
        raise HTTPException(status_code=404, detail="Unknown shipping kind")
    return {"kind": kind, "price": await load_rate(kind)}
```

```python wrong id=helper-blocks
import time

from fastapi import FastAPI, HTTPException

app = FastAPI()
RATES = {"standard": 5.0, "express": 12.5}


def load_rate(kind: str) -> float:
    time.sleep(1)
    return RATES[kind]


@app.get("/shipping/{kind}")
async def read_shipping(kind: str):
    if kind not in RATES:
        raise HTTPException(status_code=404, detail="Unknown shipping kind")
    rate = load_rate(kind)
    return {"kind": kind, "price": rate}
```

```python wrong id=no-await
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI()
RATES = {"standard": 5.0, "express": 12.5}


async def load_rate(kind: str) -> float:
    await asyncio.sleep(1)
    return RATES[kind]


@app.get("/shipping/{kind}")
async def read_shipping(kind: str):
    if kind not in RATES:
        raise HTTPException(status_code=404, detail="Unknown shipping kind")
    return {"kind": kind, "price": load_rate(kind)}
```

```http tests
GET /shipping/standard
###
GET /shipping/express
###
GET /shipping/air
```

## task fa-py-async-fixbug

```json
{
  "type": "fix-bug",
  "title": "В заказе вместо данных корутины",
  "xp": 15,
  "hints": [
    "Раздел «Корутина и await»: вызов async-функции без await даёт объект-корутину, а не результат.",
    "Ответ GET /orders/1 завершается ошибкой сервера. Посмотрите, как обработчик вызывает load_customer и load_delivery.",
    "Шаблон: customer = await load_customer(order_id); delivery = await load_delivery(order_id)."
  ],
  "wrong": {
    "one-await": "await добавлен только для клиента, а доставка по-прежнему приходит как корутина"
  }
}
```
Обработчик `GET /orders/{order_id}` собирает заказ из двух асинхронных источников. Ожидаемый ответ для заказа `1`: `{"id": 1, "customer": "Анна", "delivery": "courier"}`. Для несуществующего заказа: `404` и `{"detail": "Order not found"}`. Сейчас запрос заканчивается ошибкой сервера. Найдите две ошибки и исправьте их.

```python starter
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI()
ORDERS = {1: {"customer": "Анна", "delivery": "courier"}, 2: {"customer": "Борис", "delivery": "pickup"}}


async def load_customer(order_id: int) -> str:
    await asyncio.sleep(0.2)
    return ORDERS[order_id]["customer"]


async def load_delivery(order_id: int) -> str:
    await asyncio.sleep(0.2)
    return ORDERS[order_id]["delivery"]


@app.get("/orders/{order_id}")
async def read_order(order_id: int):
    if order_id not in ORDERS:
        raise HTTPException(status_code=404, detail="Order not found")
    customer = load_customer(order_id)
    delivery = load_delivery(order_id)
    return {"id": order_id, "customer": customer, "delivery": delivery}
```

```python solution
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI()
ORDERS = {1: {"customer": "Анна", "delivery": "courier"}, 2: {"customer": "Борис", "delivery": "pickup"}}


async def load_customer(order_id: int) -> str:
    await asyncio.sleep(0.2)
    return ORDERS[order_id]["customer"]


async def load_delivery(order_id: int) -> str:
    await asyncio.sleep(0.2)
    return ORDERS[order_id]["delivery"]


@app.get("/orders/{order_id}")
async def read_order(order_id: int):
    if order_id not in ORDERS:
        raise HTTPException(status_code=404, detail="Order not found")
    customer = await load_customer(order_id)
    delivery = await load_delivery(order_id)
    return {"id": order_id, "customer": customer, "delivery": delivery}
```

```python wrong id=one-await
import asyncio

from fastapi import FastAPI, HTTPException

app = FastAPI()
ORDERS = {1: {"customer": "Анна", "delivery": "courier"}, 2: {"customer": "Борис", "delivery": "pickup"}}


async def load_customer(order_id: int) -> str:
    await asyncio.sleep(0.2)
    return ORDERS[order_id]["customer"]


async def load_delivery(order_id: int) -> str:
    await asyncio.sleep(0.2)
    return ORDERS[order_id]["delivery"]


@app.get("/orders/{order_id}")
async def read_order(order_id: int):
    if order_id not in ORDERS:
        raise HTTPException(status_code=404, detail="Order not found")
    customer = await load_customer(order_id)
    delivery = load_delivery(order_id)
    return {"id": order_id, "customer": customer, "delivery": delivery}
```

```http tests
GET /orders/1
###
GET /orders/2
###
GET /orders/9
```

## task fa-py-async-choice

```json
{
  "type": "choice",
  "title": "Блокирующая библиотека в обработчике",
  "hints": [
    "Раздел «def или async def в FastAPI»: обычный def FastAPI запускает в отдельном потоке.",
    "Библиотека `legacy_client` не умеет работать через await, а вызов в `async def` остановит цикл событий.",
    "Подходит вариант, где блокирующий код не выполняется прямо в цикле событий."
  ],
  "options": [
    "Оставить `async def` и вызывать библиотеку как есть: «async» сам всё ускорит",
    "Добавить `await` перед вызовом блокирующей функции",
    "Объявить обработчик обычным `def`: FastAPI запустит его в отдельном потоке, и цикл событий не остановится",
    "Заменить `time.sleep` внутри библиотеки на `asyncio.sleep`"
  ],
  "answer": [2],
  "explanation": "Обычный `def` FastAPI выполняет в потоке из пула, и блокирующий вызов задерживает только его. `async def` с блокирующим вызовом замораживает все запросы. `await` перед обычной функцией не помогает: ждать можно только корутину, а запись `await` перед не-корутиной вызывает ошибку. Править код чужой библиотеки не нужно и обычно нельзя."
}
```
В обработчике нужно вызвать функцию `legacy_client.fetch()` из старой библиотеки. Она блокирующая: внутри она ждёт ответ сети обычным способом и не умеет работать с `await`. Как правильно подключить её в приложении FastAPI?
