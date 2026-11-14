# Генераторы, yield и менеджеры контекста

Обработчику нужно соединение с базой. Его надо открыть до запроса и обязательно закрыть после, даже если обработчик упал. В FastAPI для этого пишут функцию с `yield`: код до `yield` готовит ресурс, код после него убирает за собой. Чтобы понять, как это работает, нужно знать три вещи: генераторы, оператор `with` и декоратор `contextmanager`. Урок короткий, всё нужное для заданий разобрано здесь.

### Генератор и yield

Обычная функция возвращает результат один раз и завершается. **Генератор** отдаёт значения по одному, а между ними «замирает» и помнит, где остановилась. Функция становится генератором, если в её теле есть `yield`.

```python
def имя(параметры):
    ...
    yield значение
    ...
```

- `yield значение` — отдаёт значение вызывающему и приостанавливает функцию на этой строке;
- вызов `имя(...)` ничего не выполняет, а возвращает **объект-генератор**;
- код тела работает, только когда у генератора просят следующее значение.

Значения берут тремя способами:

- `for x in генератор:` — перебирает все значения;
- `list(генератор)` — собирает все значения в список;
- `next(генератор)` — берёт одно следующее значение; `next(генератор, запасное)` вернёт запасное, если значения кончились (без запасного будет ошибка `StopIteration`).

Генератор одноразовый: когда значения кончились, он пуст, и повторный `list(...)` вернёт `[]`.

```python example
from fastapi import FastAPI

app = FastAPI()


def countdown(start: int):
    while start > 0:
        yield start
        start -= 1


@app.get("/countdown/{start}")
def read_countdown(start: int):
    return {"values": list(countdown(start))}


@app.get("/steps/{start}")
def read_steps(start: int):
    gen = countdown(start)
    first = next(gen)
    second = next(gen, None)
    return {"first": first, "second": second, "rest": list(gen)}
###
GET /countdown/3
###
GET /steps/4
###
GET /steps/1
```

Результаты:

- `/countdown/3` даёт `{"values": [3, 2, 1]}`;
- `/steps/4`: `first` равен `4`, `second` равен `3`, а в `rest` осталось `[2, 1]`: `list(gen)` забрал то, что генератор ещё не отдал;
- `/steps/1`: `first` равен `1`, второго значения нет, поэтому `second` — `null`, а `rest` — `[]`.

Здесь использованы `while условие:` (повторять, пока условие истинно) и `start -= 1` (уменьшить на единицу). Для перебора чисел удобнее `range`: `range(1, 4)` даёт `1, 2, 3` (конец не включается). Строка вида `f"INV-{n:04d}"` — f-строка: число `n` подставляется в текст и дополняется нулями слева до четырёх цифр (`7` станет `INV-0007`).

### with и менеджеры контекста

Оператор `with` гарантирует, что после блока выполнится «уборка», даже если внутри блока случилась ошибка.

```python
with выражение as имя:
    действия
```

- `выражение` — **менеджер контекста**: объект, который умеет подготовить ресурс и убрать его;
- `as имя` — то, что менеджер отдаёт внутрь блока (необязательная часть);
- когда блок кончается любым способом (нормально, через `return` или исключением), менеджер выполняет уборку.

Стандартный пример — файл: `with open(путь) as f:` закрывает файл сам.

### contextmanager: свой менеджер из генератора

Писать класс с двумя специальными методами не нужно. Декоратор `contextmanager` из модуля `contextlib` превращает генератор с одним `yield` в менеджер контекста.

```python
from contextlib import contextmanager


@contextmanager
def имя(параметры):
    подготовка
    try:
        yield ресурс
    finally:
        уборка
```

- `@contextmanager` — декоратор (подробно о декораторах — в следующем уроке): делает из функции менеджер для `with`;
- код до `yield` выполнится при входе в `with`;
- `yield ресурс` — значение, которое попадёт в `as имя`; на время блока `with` генератор стоит на этой строке;
- `try ... finally` — блок `finally` выполняется всегда, и при ошибке тоже. Без него ошибка внутри `with` оборвала бы функцию на `yield`, и уборка не произошла бы.

```python example
from contextlib import contextmanager

from fastapi import FastAPI

app = FastAPI()


@contextmanager
def opened(events: list[str], name: str):
    events.append("open " + name)
    try:
        yield name
    finally:
        events.append("close " + name)


@app.get("/with-demo")
def with_demo():
    events: list[str] = []
    with opened(events, "cache") as name:
        events.append("work with " + name)
    try:
        with opened(events, "disk"):
            raise ValueError("сбой внутри блока")
    except ValueError:
        events.append("error caught")
    return {"events": events}
###
GET /with-demo
```

Ответ `200`: `{"events": ["open cache", "work with cache", "close cache", "open disk", "close disk", "error caught"]}`. Обратите внимание на `close disk`: ошибка внутри `with` случилась, но `finally` всё равно выполнился, и только потом сработал `except`. Конструкция `try ... except ВидОшибки:` перехватывает исключение, `raise ВидОшибки("текст")` его создаёт.

### Зависимости с yield в FastAPI

**Зависимость** — функция, результат которой FastAPI подставляет в обработчик. Её подключают через `Depends`:

```python
from typing import Annotated
from fastapi import Depends


def получить_ресурс():
    подготовка
    try:
        yield ресурс
    finally:
        уборка


РесурсDep = Annotated[Тип, Depends(получить_ресурс)]
```

- `Depends(функция)` — «вызови эту функцию и передай результат». Передают именно функцию, без скобок;
- в обработчике пишут параметр с этим типом: `def handler(res: РесурсDep)`. Значение параметра — то, что отдал `yield`;
- `РесурсDep = Annotated[...]` — псевдоним: один раз описали, дальше подписывают им параметры;
- код после `yield` FastAPI выполнит, когда обработчик закончит работу. Если обработчик выбросил ошибку (например, `HTTPException`), исключение попадёт в зависимость на строке `yield`, поэтому уборку помещают в `finally`.

Это ровно тот же приём, что и `contextmanager`: FastAPI сам открывает и закрывает «блок `with`» вокруг вашего обработчика.

```python example
from typing import Annotated

from fastapi import Depends, FastAPI

app = FastAPI()
STATE = {"open": 0}


def get_connection():
    STATE["open"] += 1
    try:
        yield "conn"
    finally:
        STATE["open"] -= 1


ConnDep = Annotated[str, Depends(get_connection)]


@app.get("/ping")
def ping(conn: ConnDep):
    return {"conn": conn, "open_during": STATE["open"]}


@app.get("/state")
def read_state():
    return STATE
###
GET /ping
###
GET /state
```

`/ping` отвечает `{"conn": "conn", "open_during": 1}`: внутри обработчика соединение открыто. `/state` показывает `{"open": 0}`: после запроса код после `yield` выполнился. Для настоящих приложений вместо строки `"conn"` отдают сессию базы данных, а в `finally` закрывают её. В студии базы нет, поэтому ресурсами служат списки и счётчики.

### Частые ошибки

- Уборка без `finally`. Неверно: `yield x` и после него `close()`. Верно: `try: yield x` и `finally: close()`. Иначе при ошибке уборка пропадёт.
- Уборка до `yield`. Неверно: поставить закрытие выше `yield`. Верно: до `yield` только подготовка, уборка строго после.
- Забыли `Depends`. Неверно: `def handler(conn=get_connection)` — в `conn` окажется сама функция. Верно: `conn: ConnDep`, где `ConnDep = Annotated[str, Depends(get_connection)]`.
- Несколько `yield` в зависимости. Неверно: два `yield` подряд. Верно: ровно один, он делит функцию на «до» и «после».
- Повторный обход генератора. Неверно: сначала `list(gen)`, потом `list(gen)` — второй список пуст. Верно: сохраните результат в переменную.

### Шпаргалка

- `yield значение` делает функцию генератором; `next(gen)`, `next(gen, запасное)`, `list(gen)`, `for x in gen`.
- `with менеджер as имя:` — уборка выполнится всегда.
- `@contextmanager` + `try: yield ресурс` + `finally: уборка` — свой менеджер.
- `Depends(функция)`; `Тип = Annotated[Результат, Depends(функция)]`.
- Зависимость с `yield`: подготовка, `try: yield`, `finally: уборка`.
- `range(1, n + 1)` — числа от 1 до `n`; `f"{n:04d}"` — число с нулями слева до четырёх цифр.

## task fa-py-gen-numbers

```json
{
  "type": "fastapi",
  "title": "Номера счетов из генератора",
  "xp": 10,
  "hints": [
    "Раздел «Генератор и yield»: функция с yield отдаёт значения по одному, а list(...) собирает их.",
    "Переберите числа `range(1, count + 1)` циклом for и для каждого сделайте yield строки по шаблону f-строки с `:04d`.",
    "Шаблон: for number in range(1, count + 1): yield f\"INV-{number:04d}\"."
  ],
  "check": {
    "static": [
      { "rule": "pattern", "regex": "\\byield\\b", "message": "Функция invoice_numbers должна быть генератором: отдавайте номера через yield." }
    ]
  },
  "wrong": {
    "zero-based": "нумерация начинается с INV-0000 вместо INV-0001",
    "no-yield": "функция собирает список и возвращает его, а не отдаёт значения через yield"
  }
}
```
Магазин выпускает счета с номерами `INV-0001`, `INV-0002` и так далее. Обработчик `GET /invoices/{count}` должен вернуть `{"numbers": [...]}` с `count` номерами. Список строит `list(invoice_numbers(count))`, а сама `invoice_numbers` пока пустая.

Допишите функцию-**генератор** `invoice_numbers(count)`: она должна по одному отдавать `count` строк вида `INV-0001`, `INV-0002`, ... (число дополнено нулями слева до четырёх цифр, нумерация с единицы). Для `count`, равного `0`, список пуст. Проверка требует, чтобы в коде был `yield`.

```python starter
from fastapi import FastAPI

app = FastAPI()


def invoice_numbers(count: int):
    ...


@app.get("/invoices/{count}")
def list_invoices(count: int):
    return {"numbers": list(invoice_numbers(count))}
```

```python solution
from fastapi import FastAPI

app = FastAPI()


def invoice_numbers(count: int):
    for number in range(1, count + 1):
        yield f"INV-{number:04d}"


@app.get("/invoices/{count}")
def list_invoices(count: int):
    return {"numbers": list(invoice_numbers(count))}
```

```python wrong id=zero-based
from fastapi import FastAPI

app = FastAPI()


def invoice_numbers(count: int):
    for number in range(count):
        yield f"INV-{number:04d}"


@app.get("/invoices/{count}")
def list_invoices(count: int):
    return {"numbers": list(invoice_numbers(count))}
```

```python wrong id=no-yield
from fastapi import FastAPI

app = FastAPI()


def invoice_numbers(count: int):
    return [f"INV-{number:04d}" for number in range(1, count + 1)]


@app.get("/invoices/{count}")
def list_invoices(count: int):
    return {"numbers": list(invoice_numbers(count))}
```

```http tests
GET /invoices/3
###
GET /invoices/0
###
GET /invoices/12
###
GET /invoices/abc
```

## task fa-py-gen-session

```json
{
  "type": "fastapi",
  "title": "Сессия, которая закрывается всегда",
  "xp": 15,
  "hints": [
    "Раздел «Зависимости с yield в FastAPI»: код после yield выполняется, когда обработчик закончил, а finally срабатывает и при ошибке.",
    "Замените return на try: yield EVENTS и в finally добавьте в EVENTS строку \"close\".",
    "Шаблон: EVENTS.append(\"open\"); try: yield EVENTS; finally: EVENTS.append(\"close\")."
  ],
  "wrong": {
    "close-first": "строка close добавляется до yield, поэтому в журнале она оказывается раньше работы обработчика",
    "no-finally": "после yield нет finally, и при ошибке 404 строка close не записывается"
  }
}
```
В блоге каждый запрос на чтение поста работает внутри «сессии». Зависимость `open_session` записывает в журнал `EVENTS` строку `open`, обработчик `GET /posts/{post_id}` дописывает `read`, а `GET /events` показывает журнал. Пост существует только с номером `1`, для остальных обработчик отвечает `404`.

Сейчас сессия никогда не закрывается: в журнале нет строки `close`. Исправьте зависимость, чтобы после каждого запроса в журнал добавлялось `close`: и после успешного `GET /posts/1`, и после запроса, закончившегося `404`. Правильный журнал после этих двух запросов: `["open", "read", "close", "open", "close"]`.

```python starter
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException

app = FastAPI()
EVENTS: list[str] = []


def open_session():
    EVENTS.append("open")
    return EVENTS


SessionDep = Annotated[list[str], Depends(open_session)]


@app.get("/posts/{post_id}")
def read_post(post_id: int, session: SessionDep):
    if post_id != 1:
        raise HTTPException(status_code=404, detail="Post not found")
    session.append("read")
    return {"id": post_id}


@app.get("/events")
def read_events():
    return EVENTS
```

```python solution
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException

app = FastAPI()
EVENTS: list[str] = []


def open_session():
    EVENTS.append("open")
    try:
        yield EVENTS
    finally:
        EVENTS.append("close")


SessionDep = Annotated[list[str], Depends(open_session)]


@app.get("/posts/{post_id}")
def read_post(post_id: int, session: SessionDep):
    if post_id != 1:
        raise HTTPException(status_code=404, detail="Post not found")
    session.append("read")
    return {"id": post_id}


@app.get("/events")
def read_events():
    return EVENTS
```

```python wrong id=close-first
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException

app = FastAPI()
EVENTS: list[str] = []


def open_session():
    EVENTS.append("open")
    EVENTS.append("close")
    yield EVENTS


SessionDep = Annotated[list[str], Depends(open_session)]


@app.get("/posts/{post_id}")
def read_post(post_id: int, session: SessionDep):
    if post_id != 1:
        raise HTTPException(status_code=404, detail="Post not found")
    session.append("read")
    return {"id": post_id}


@app.get("/events")
def read_events():
    return EVENTS
```

```python wrong id=no-finally
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException

app = FastAPI()
EVENTS: list[str] = []


def open_session():
    EVENTS.append("open")
    yield EVENTS
    EVENTS.append("close")


SessionDep = Annotated[list[str], Depends(open_session)]


@app.get("/posts/{post_id}")
def read_post(post_id: int, session: SessionDep):
    if post_id != 1:
        raise HTTPException(status_code=404, detail="Post not found")
    session.append("read")
    return {"id": post_id}


@app.get("/events")
def read_events():
    return EVENTS
```

```http tests
GET /posts/1
###
GET /posts/2
###
GET /events
```

## task fa-py-gen-audit

```json
{
  "type": "refactor",
  "title": "Журнал открытия и закрытия в зависимость",
  "xp": 20,
  "hints": [
    "Разделы «Зависимости с yield в FastAPI» и «contextmanager»: повторяющийся try/finally выносят в одну функцию с yield.",
    "Создайте функцию audit с записью open, try: yield LOG и finally с записью close, оберните её в Annotated[list[str], Depends(audit)] и уберите try/finally из обоих обработчиков.",
    "Шаблон: def audit(): LOG.append(\"open\"); try: yield LOG; finally: LOG.append(\"close\"); AuditDep = Annotated[list[str], Depends(audit)]; в обработчике: def f(audit: AuditDep): audit.append(...)."
  ],
  "check": {
    "static": [
      { "rule": "uses", "name": "Depends", "message": "Вынесите открытие и закрытие в зависимость и подключите её через Depends." },
      { "rule": "pattern", "regex": "^\\s+yield\\b", "message": "Зависимость должна использовать yield: до него открытие, после — закрытие." }
    ]
  },
  "wrong": {
    "still-copied": "открытие и закрытие по-прежнему записаны в каждом обработчике, зависимости нет"
  }
}
```
В магазине два обработчика работают с журналом `LOG`: оба в начале пишут `open`, в конце (даже при ошибке) `close`, а между ними свою запись. Один и тот же `try/finally` скопирован дважды, и при третьем обработчике придётся копировать снова.

Перепишите код, не меняя поведения: вынесите открытие и закрытие в зависимость `audit` с `yield` и подключите её через `Depends` в обоих обработчиках. Ответы, коды и содержимое журнала должны остаться такими же. Маршруты сохраните: `GET /products`, `GET /products/{name}`, `GET /log`.

```python starter
from fastapi import FastAPI, HTTPException

app = FastAPI()
LOG: list[str] = []
PRODUCTS = {"tea": 120, "coffee": 340}


@app.get("/products")
def list_products():
    LOG.append("open")
    try:
        LOG.append("list")
        return list(PRODUCTS)
    finally:
        LOG.append("close")


@app.get("/products/{name}")
def read_product(name: str):
    LOG.append("open")
    try:
        if name not in PRODUCTS:
            raise HTTPException(status_code=404, detail="Product not found")
        LOG.append("read " + name)
        return {"name": name, "price": PRODUCTS[name]}
    finally:
        LOG.append("close")


@app.get("/log")
def read_log():
    return LOG
```

```python solution
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException

app = FastAPI()
LOG: list[str] = []
PRODUCTS = {"tea": 120, "coffee": 340}


def audit():
    LOG.append("open")
    try:
        yield LOG
    finally:
        LOG.append("close")


AuditDep = Annotated[list[str], Depends(audit)]


@app.get("/products")
def list_products(audit: AuditDep):
    audit.append("list")
    return list(PRODUCTS)


@app.get("/products/{name}")
def read_product(name: str, audit: AuditDep):
    if name not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not found")
    audit.append("read " + name)
    return {"name": name, "price": PRODUCTS[name]}


@app.get("/log")
def read_log():
    return LOG
```

```python wrong id=still-copied
from fastapi import FastAPI, HTTPException

app = FastAPI()
LOG: list[str] = []
PRODUCTS = {"tea": 120, "coffee": 340}


@app.get("/products")
def list_products():
    LOG.append("open")
    try:
        LOG.append("list")
        return list(PRODUCTS)
    finally:
        LOG.append("close")


@app.get("/products/{name}")
def read_product(name: str):
    LOG.append("open")
    try:
        if name not in PRODUCTS:
            raise HTTPException(status_code=404, detail="Product not found")
        LOG.append("read " + name)
        return {"name": name, "price": PRODUCTS[name]}
    finally:
        LOG.append("close")


@app.get("/log")
def read_log():
    return LOG
```

```http tests
GET /products
###
GET /products/tea
###
GET /products/milk
###
GET /log
```

## task fa-py-gen-review

```json
{
  "type": "review",
  "title": "Менеджер, который не всегда убирает",
  "hints": [
    "Раздел «contextmanager: свой менеджер из генератора»: что происходит с кодом после yield, если внутри with случилась ошибка.",
    "Сравните этот код с шаблоном: в шаблоне вокруг yield есть try и finally.",
    "Строки 4 и 5: без try/finally ошибка внутри with прервёт генератор на yield, и строка 5 с закрытием не выполнится."
  ],
  "code": "@contextmanager\ndef opened(log, name):\n    log.append(\"open \" + name)\n    yield name\n    log.append(\"close \" + name)",
  "codeLanguage": "python",
  "lines": [4, 5],
  "options": [
    "Менеджер нельзя писать через yield, нужен класс",
    "После yield нет finally: если внутри with произойдёт ошибка, строка close не выполнится",
    "Параметр log нельзя передавать в менеджер контекста",
    "Метод append нельзя вызывать до yield"
  ],
  "answer": [1],
  "explanation": "Ошибка внутри блока with выбрасывается в генератор на строке yield. Без try/finally выполнение прерывается там, и строка с закрытием пропускается: ресурс остаётся открытым. Правильно: try: yield name, а закрытие в finally. Генератор с contextmanager допустим, параметры можно передавать, а вызывать append до yield нормально: это подготовка."
}
```
Менеджер контекста должен записывать `open` при входе и `close` при выходе. На практике после ошибок внутри блока `with` в журнале иногда не хватает строки `close`. Найдите причину.
